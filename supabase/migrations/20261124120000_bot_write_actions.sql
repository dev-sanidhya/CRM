-- Let the Telegram bot change the CRM when a founder asks, through a small set of functions only.
-- The bot's role (crm_bot) still has SELECT only on CRM tables; it can write solely by calling the
-- functions in the private schema `botw` below. Every change is tagged source 'telegram' with the
-- founder who asked (requested_by), so the CRM shows it in its own colour. No deletes, no calls.

-- 1. Tag columns ----------------------------------------------------------

alter table public.activities add column if not exists requested_by text;
alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check
  check (source in ('typed', 'voice', 'telegram'));

alter table public.reminders add column if not exists requested_by text;
alter table public.reminders drop constraint if exists reminders_source_check;
alter table public.reminders add constraint reminders_source_check
  check (source in ('manual', 'rule', 'sheet_import', 'voice_extracted', 'call', 'telegram'));

alter table public.lead_history add column if not exists requested_by text;

-- 2. Version history also records Telegram changes (actor + who asked) ----

create or replace function public.record_lead_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_source text := coalesce(nullif(current_setting('crm.source', true), ''), 'edit');
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('crm.actor', true), '')::uuid);
  v_by text := nullif(current_setting('crm.requested_by', true), '');
  v_version int;
begin
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.lead_history (lead_id, version, actor, action, source, changes, snapshot, requested_by)
    values (new.id, 1, v_actor, 'created', v_source, '{}'::jsonb, v_new, v_by);
    return new;
  end if;

  v_old := to_jsonb(old);
  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any (lead_history_ignored()) then continue; end if;
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.lead_history where lead_id = new.id;
  insert into public.lead_history (lead_id, version, actor, action, source, changes, snapshot, requested_by)
  values (new.id, v_version, v_actor, 'updated', v_source, v_changes, v_new, v_by);
  return new;
end;
$$;

-- 3. The bot's write functions (private schema, not exposed through the web API) --

create schema if not exists botw;
revoke all on schema botw from public, anon, authenticated;
grant usage on schema botw to crm_bot;

-- Sets the "who and from where" for the rest of the transaction and checks the actor is a founder.
create or replace function botw._begin(p_actor uuid, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and role = 'founder') then
    raise exception 'Only a founder can change the CRM through Telegram';
  end if;
  perform set_config('crm.source', 'telegram', true);
  perform set_config('crm.actor', p_actor::text, true);
  perform set_config('crm.requested_by', coalesce(p_by, ''), true);
end;
$$;

create or replace function botw._lead(p_lead uuid)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare v public.leads%rowtype;
begin
  select * into v from public.leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  return v;
end;
$$;

create or replace function botw._note(p_lead uuid, p_actor uuid, p_by text, p_text text, p_type text default 'note', p_to_stage public.lead_stage default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.activities (lead_id, actor, type, summary, source, to_stage, requested_by)
  values (p_lead, p_actor, p_type, p_text, 'telegram', p_to_stage, p_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- Add a note to a lead.
create or replace function botw.add_note(p_lead uuid, p_text text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  if coalesce(btrim(p_text), '') = '' then raise exception 'The note is empty'; end if;
  perform botw._note(p_lead, p_actor, p_by, btrim(p_text));
  return jsonb_build_object('lead', v.business_name, 'done', 'note added');
end;
$$;

-- Change the stage. won/lost close the lead; any other stage reopens it.
create or replace function botw.set_stage(p_lead uuid, p_stage text, p_note text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype; v_stage public.lead_stage;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  begin v_stage := p_stage::public.lead_stage;
  exception when others then raise exception 'Unknown stage %', p_stage; end;
  update public.leads set
    stage = v_stage,
    closed_at = case when v_stage in ('won', 'lost') then coalesce(closed_at, now()) else null end,
    closed_reason = case when v_stage in ('won', 'lost') then coalesce(closed_reason, v_stage::text) else null end
  where id = p_lead;
  perform botw._note(p_lead, p_actor, p_by,
    'Stage set to ' || replace(v_stage::text, '_', ' ') || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    'status_change', v_stage);
  return jsonb_build_object('lead', v.business_name, 'from', v.stage, 'to', v_stage);
end;
$$;

-- Schedule a follow-up, callback or demo. A demo also moves the stage to meeting_booked.
-- Scheduling on a closed lead reopens it.
create or replace function botw.schedule(p_lead uuid, p_kind text, p_at timestamptz, p_note text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype; v_label text; v_new_stage public.lead_stage;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  if p_kind not in ('follow_up', 'callback', 'demo') then raise exception 'Kind must be follow_up, callback or demo'; end if;
  if p_at is null then raise exception 'A date and time is required'; end if;
  v_label := case p_kind when 'demo' then 'Demo' when 'callback' then 'Callback' else 'Follow-up' end;

  insert into public.reminders (lead_id, assigned_to, due_at, note, source, kind, requested_by)
  values (p_lead, coalesce(v.assigned_to, p_actor), p_at, coalesce(nullif(btrim(p_note), ''), v_label || ' (set from Telegram)'), 'telegram', p_kind, p_by);

  v_new_stage := case
    when p_kind = 'demo' then greatest(case when v.stage = 'lost' then 'new'::public.lead_stage else v.stage end, 'meeting_booked')
    when v.stage = 'lost' then 'contacted'
    else v.stage end;
  update public.leads set stage = v_new_stage, closed_at = null, closed_reason = null, retry_at = null where id = p_lead;

  perform botw._note(p_lead, p_actor, p_by,
    v_label || ' scheduled for ' || to_char(p_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI am') || ' IST' || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  if v_new_stage <> v.stage then
    perform botw._note(p_lead, p_actor, p_by, 'Stage set to ' || replace(v_new_stage::text, '_', ' '), 'status_change', v_new_stage);
  end if;
  return jsonb_build_object('lead', v.business_name, 'scheduled', v_label, 'at_ist', to_char(p_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'stage', v_new_stage);
end;
$$;

-- Mark the lead's open follow-ups / callbacks (and optionally demos) as done.
create or replace function botw.complete_follow_ups(p_lead uuid, p_include_demos boolean, p_note text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype; n int;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  update public.reminders set status = 'done', completed_at = now(),
    resolution_note = 'Done (Telegram, ' || coalesce(p_by, 'founder') || ')' || coalesce(': ' || nullif(btrim(p_note), ''), '')
  where lead_id = p_lead and status <> 'done' and (p_include_demos or kind <> 'demo');
  get diagnostics n = row_count;
  if n > 0 then
    perform botw._note(p_lead, p_actor, p_by, 'Marked ' || n || ' follow-up' || case when n = 1 then '' else 's' end || ' done' || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  end if;
  return jsonb_build_object('lead', v.business_name, 'completed', n);
end;
$$;

-- Mark or unmark "deck / details sent".
create or replace function botw.set_deck_sent(p_lead uuid, p_sent boolean, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  update public.leads set details_sent_at = case when p_sent then coalesce(details_sent_at, now()) else null end where id = p_lead;
  perform botw._note(p_lead, p_actor, p_by, case when p_sent then 'Deck / details marked as sent' else 'Deck sent mark removed' end);
  return jsonb_build_object('lead', v.business_name, 'deck_sent', p_sent);
end;
$$;

-- Move the lead to another list.
create or replace function botw.set_list(p_lead uuid, p_category text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype; v_label text;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  select label into v_label from public.lead_categories where key = p_category;
  if v_label is null then raise exception 'Unknown list %', p_category; end if;
  update public.leads set category = p_category where id = p_lead;
  perform botw._note(p_lead, p_actor, p_by, 'Moved to ' || v_label);
  return jsonb_build_object('lead', v.business_name, 'list', v_label);
end;
$$;

-- Correct contact details. Only the fields passed (non-null) change.
create or replace function botw.update_details(p_lead uuid, p_name text, p_phone text, p_city text, p_website text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype; v_changed text[] := '{}';
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  if nullif(btrim(p_phone), '') is not null and exists (select 1 from public.leads where phone = btrim(p_phone) and id <> p_lead) then
    raise exception 'Another lead already has that phone number';
  end if;
  update public.leads set
    business_name = coalesce(nullif(btrim(p_name), ''), business_name),
    phone = coalesce(nullif(btrim(p_phone), ''), phone),
    city = coalesce(nullif(btrim(p_city), ''), city),
    website = coalesce(nullif(btrim(p_website), ''), website)
  where id = p_lead;
  if nullif(btrim(p_name), '') is not null then v_changed := v_changed || 'name'; end if;
  if nullif(btrim(p_phone), '') is not null then v_changed := v_changed || 'phone'; end if;
  if nullif(btrim(p_city), '') is not null then v_changed := v_changed || 'city'; end if;
  if nullif(btrim(p_website), '') is not null then v_changed := v_changed || 'website'; end if;
  if array_length(v_changed, 1) is null then raise exception 'Nothing to change'; end if;
  perform botw._note(p_lead, p_actor, p_by, 'Updated ' || array_to_string(v_changed, ', '));
  return jsonb_build_object('lead', v.business_name, 'updated', v_changed);
end;
$$;

-- Close a lead as lost (with a reason), or reopen it (back into the caller's "Try again" list).
create or replace function botw.close_lead(p_lead uuid, p_reason text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  update public.leads set stage = 'lost', closed_at = now(), closed_reason = 'closed_by_founder', retry_at = null where id = p_lead;
  update public.reminders set status = 'done', completed_at = now(), resolution_note = 'Lead closed (Telegram)'
  where lead_id = p_lead and status <> 'done';
  perform botw._note(p_lead, p_actor, p_by, 'Lead closed' || coalesce(': ' || nullif(btrim(p_reason), ''), ''), 'status_change', 'lost');
  return jsonb_build_object('lead', v.business_name, 'closed', true);
end;
$$;

create or replace function botw.reopen_lead(p_lead uuid, p_note text, p_actor uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.leads%rowtype;
begin
  perform botw._begin(p_actor, p_by);
  v := botw._lead(p_lead);
  update public.leads set
    stage = case when stage in ('lost', 'won') then 'contacted'::public.lead_stage else stage end,
    closed_at = null, closed_reason = null, retry_at = now()
  where id = p_lead;
  perform botw._note(p_lead, p_actor, p_by, 'Lead reopened' || coalesce(': ' || nullif(btrim(p_note), ''), ''), 'status_change', 'contacted');
  return jsonb_build_object('lead', v.business_name, 'reopened', true);
end;
$$;

revoke all on all functions in schema botw from public, anon, authenticated;
grant execute on function
  botw.add_note(uuid, text, uuid, text),
  botw.set_stage(uuid, text, text, uuid, text),
  botw.schedule(uuid, text, timestamptz, text, uuid, text),
  botw.complete_follow_ups(uuid, boolean, text, uuid, text),
  botw.set_deck_sent(uuid, boolean, uuid, text),
  botw.set_list(uuid, text, uuid, text),
  botw.update_details(uuid, text, text, text, text, uuid, text),
  botw.close_lead(uuid, text, uuid, text),
  botw.reopen_lead(uuid, text, uuid, text)
to crm_bot;

-- 4. The Activity feed carries the tag too ---------------------------------

create or replace function public.get_activity_feed(
  p_before date default null,
  p_days int default 3,
  p_caller uuid default null,
  p_category text default null,
  p_query text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as term
  ),
  events as (
    select a.id::text as id, a.created_at as at, a.lead_id, 'activity' as kind, a.type, a.outcome,
           a.summary, a.next_at, null::jsonb as changes, a.source as source, a.actor,
           null::text as import_label, null::int as import_count, a.requested_by
    from public.activities a
    where (a.type <> 'status_change' or a.source = 'telegram')
      and (p_caller is null or a.actor = p_caller)
    union all
    select 'h' || h.id, h.changed_at, h.lead_id, 'version', h.action, null, null, null,
           h.changes, h.source, h.actor, null, null, h.requested_by
    from public.lead_history h
    where h.action <> 'baseline'
      and not (h.action = 'created' and h.source = 'import')
      and (p_caller is null or h.actor = p_caller or h.actor is null)
    union all
    select 'i' || s.id, s.imported_at, null, 'import', 'import', null, null, null,
           null, null, s.imported_by,
           case when s.sheet_url like 'file:%' then substr(s.sheet_url, 6) else 'Google Sheet' end,
           s.new_lead_count + s.updated_lead_count, null
    from public.sheet_imports s
    where (p_caller is null or s.imported_by = p_caller)
      and (p_category is null or s.category = p_category)
  ),
  enriched as (
    select e.*, (e.at at time zone 'Asia/Kolkata')::date as day,
           l.business_name, l.city, l.phone, l.category, l.stage,
           p.name as actor_name
    from events e
    left join public.leads l on l.id = e.lead_id
    left join public.profiles p on p.id = e.actor
    cross join q
    where (e.lead_id is null or l.id is not null)
      and (p_category is null or e.kind = 'import' or l.category = p_category)
      and (q.term is null
           or l.business_name ilike '%' || q.term || '%'
           or l.phone like '%' || regexp_replace(q.term, '\D', '', 'g') || '%' and length(regexp_replace(q.term, '\D', '', 'g')) >= 3
           or e.summary ilike '%' || q.term || '%'
           or e.import_label ilike '%' || q.term || '%')
  ),
  days as (
    select distinct day from enriched
    where p_before is null or day < p_before
    order by day desc
    limit greatest(1, least(p_days, 14))
  )
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'summary', (
          select jsonb_build_object(
            'dials', count(*) filter (where e.kind = 'activity' and e.type = 'call'),
            'connected', count(*) filter (where e.kind = 'activity' and e.type = 'call'
                                          and e.outcome not in ('no_answer', 'busy', 'switched_off', 'wrong_number')),
            'decks', count(*) filter (where e.outcome = 'details_sent'),
            'demos', count(*) filter (where e.outcome = 'demo_booked'),
            'leads', count(distinct e.lead_id)
          ) from enriched e where e.day = d.day
        ),
        'events', (
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'at', e.at, 'kind', e.kind, 'type', e.type, 'outcome', e.outcome,
            'summary', e.summary, 'next_at', e.next_at, 'changes', e.changes, 'source', e.source,
            'lead_id', e.lead_id, 'business_name', e.business_name, 'city', e.city,
            'category', e.category, 'actor', e.actor_name, 'requested_by', e.requested_by,
            'import_label', e.import_label, 'import_count', e.import_count
          ) order by e.at desc)
          from enriched e where e.day = d.day
        )
      ) order by d.day desc)
      from days d
    ), '[]'::jsonb),
    'has_more', exists (
      select 1 from enriched e
      where e.day < coalesce((select min(day) from days), p_before, '9999-12-31'::date)
    )
  );
$$;
