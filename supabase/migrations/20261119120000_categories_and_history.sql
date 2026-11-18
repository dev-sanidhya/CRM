-- 1. Lead categories (campaigns being dialled). A table, so a third one is
--    a row insert, not a code change.
-- 2. Lead version history: every change to a lead is recorded by a trigger
--    (who, when, from where, old -> new), plus a full snapshot per version.
-- 3. get_day_log: everything that happened on one day, grouped by lead.

-- 1. Categories ---------------------------------------------------------------

create table if not exists public.lead_categories (
  key text primary key,
  label text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.lead_categories enable row level security;
drop policy if exists lead_categories_read on public.lead_categories;
create policy lead_categories_read on public.lead_categories for select to authenticated using (true);
drop policy if exists lead_categories_founder_write on public.lead_categories;
create policy lead_categories_founder_write on public.lead_categories for all to authenticated
  using (is_founder()) with check (is_founder());

insert into public.lead_categories (key, label, sort) values
  ('influencer', 'Influencer management', 1),
  ('partnership', 'Partnership calls', 2)
on conflict (key) do nothing;

alter table public.leads add column if not exists category text not null default 'influencer'
  references public.lead_categories (key) on update cascade;
create index if not exists leads_category_idx on public.leads (assigned_to, category);
alter table public.sheet_imports add column if not exists category text references public.lead_categories (key);
update public.sheet_imports set category = 'influencer' where category is null;

-- 2. Version history ------------------------------------------------------

create table if not exists public.lead_history (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  version int not null,
  changed_at timestamptz not null default now(),
  actor uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('created', 'updated', 'baseline')),
  source text not null default 'edit',
  changes jsonb not null default '{}'::jsonb,
  snapshot jsonb not null
);
create index if not exists lead_history_lead_idx on public.lead_history (lead_id, version desc);
create index if not exists lead_history_day_idx on public.lead_history (changed_at);
alter table public.lead_history enable row level security;
drop policy if exists lead_history_read on public.lead_history;
create policy lead_history_read on public.lead_history for select to authenticated
  using (is_founder() or exists (select 1 from public.leads l where l.id = lead_history.lead_id and l.assigned_to = (select auth.uid())));

-- Fields that change on every dial and are already shown as calls; they are
-- kept in the snapshot but do not make a new version on their own.
create or replace function public.lead_history_ignored()
returns text[] language sql immutable set search_path = public as $$
  select array['updated_at', 'attempt_count', 'last_called_at', 'last_note', 'retry_at', 'last_outcome'];
$$;

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
  v_actor uuid := auth.uid();
  v_version int;
begin
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.lead_history (lead_id, version, actor, action, source, changes, snapshot)
    values (new.id, 1, v_actor, 'created', v_source, '{}'::jsonb, v_new);
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
  insert into public.lead_history (lead_id, version, actor, action, source, changes, snapshot)
  values (new.id, v_version, v_actor, 'updated', v_source, v_changes, v_new);
  return new;
end;
$$;

drop trigger if exists leads_history on public.leads;
create trigger leads_history after insert or update on public.leads
  for each row execute function public.record_lead_history();

-- Version 1 for leads that existed before history started.
insert into public.lead_history (lead_id, version, changed_at, actor, action, source, changes, snapshot)
select l.id, 1, l.created_at, null, 'baseline', 'import', '{}'::jsonb, to_jsonb(l)
from public.leads l
where not exists (select 1 from public.lead_history h where h.lead_id = l.id);

-- Tag where a change came from: calls, imports and quick adds.
-- (log_call and import_leads/quick_add_lead are redefined below to set it.)

-- 3. Category-aware functions ---------------------------------------------

drop function if exists public.import_leads(uuid, jsonb, text, text);
create or replace function public.import_leads(
  p_layout_id uuid,
  p_rows jsonb,
  p_sheet_url text,
  p_sheet_tab text,
  p_category text default 'influencer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_new_count int := 0;
  v_updated_count int := 0;
  v_lead_id uuid;
  v_existing_assigned uuid;
  v_import_id uuid;
  v_puller_role text;
  v_new_lead_assignee uuid;
  v_category text := coalesce(nullif(p_category, ''), 'influencer');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from public.lead_categories where key = v_category) then
    raise exception 'Unknown category: %', v_category;
  end if;
  perform set_config('crm.source', 'import', true);

  select role into v_puller_role from profiles where id = auth.uid();
  v_new_lead_assignee := case when v_puller_role = 'caller' then auth.uid() else null end;

  insert into sheet_imports (sheet_url, sheet_tab, layout_id, imported_by, row_count, new_lead_count, updated_lead_count, category)
  values (p_sheet_url, p_sheet_tab, p_layout_id, auth.uid(), jsonb_array_length(p_rows), 0, 0, v_category)
  returning id into v_import_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    select id, assigned_to into v_lead_id, v_existing_assigned
    from leads where phone = (v_row->>'phone');

    if v_lead_id is not null then
      if v_existing_assigned is null and v_puller_role = 'caller' then
        v_existing_assigned := auth.uid();
      end if;

      update leads set
        business_name = v_row->>'business_name',
        city = v_row->>'city',
        website = v_row->>'website',
        score = nullif(v_row->>'score', '')::numeric,
        extra_fields = coalesce(v_row->'extra_fields', '{}'::jsonb),
        sheet_import_id = v_import_id,
        assigned_to = v_existing_assigned,
        category = v_category
      where id = v_lead_id;
      v_updated_count := v_updated_count + 1;
    else
      insert into leads (business_name, phone, city, website, stage, score, extra_fields, sheet_import_id, assigned_to, category)
      values (
        v_row->>'business_name',
        v_row->>'phone',
        v_row->>'city',
        v_row->>'website',
        coalesce(v_row->>'stage', 'new')::lead_stage,
        nullif(v_row->>'score', '')::numeric,
        coalesce(v_row->'extra_fields', '{}'::jsonb),
        v_import_id,
        v_new_lead_assignee,
        v_category
      )
      returning id into v_lead_id;
      v_existing_assigned := v_new_lead_assignee;
      v_new_count := v_new_count + 1;
    end if;

    if (v_row->>'follow_up_date') is not null then
      insert into reminders (lead_id, assigned_to, due_at, note, source)
      values (v_lead_id, v_existing_assigned, (v_row->>'follow_up_date')::timestamptz, v_row->>'follow_up_note', 'sheet_import');
    end if;
  end loop;

  update sheet_imports set new_lead_count = v_new_count, updated_lead_count = v_updated_count
  where id = v_import_id;

  return jsonb_build_object('import_id', v_import_id, 'new_count', v_new_count, 'updated_count', v_updated_count);
end;
$$;
revoke execute on function public.import_leads(uuid, jsonb, text, text, text) from anon, public;
grant execute on function public.import_leads(uuid, jsonb, text, text, text) to authenticated;

drop function if exists public.quick_add_lead(text, text, text, uuid);
create or replace function public.quick_add_lead(
  p_name text,
  p_phone text,
  p_city text default null,
  p_assign uuid default null,
  p_category text default 'influencer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_assignee uuid;
  v_existing public.leads%rowtype;
  v_id uuid;
  v_existing_flag boolean := false;
  v_category text := coalesce(nullif(p_category, ''), 'influencer');
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' then
    raise exception 'Name and phone are required';
  end if;
  if not exists (select 1 from public.lead_categories where key = v_category) then
    raise exception 'Unknown category: %', v_category;
  end if;
  perform set_config('crm.source', 'added_by_hand', true);

  select role into v_role from public.profiles where id = v_uid;
  v_assignee := case when v_role = 'caller' then v_uid else p_assign end;

  select * into v_existing from public.leads where phone = p_phone;
  if found then
    if not (v_existing.assigned_to is null or v_existing.assigned_to = v_assignee or v_role = 'founder') then
      raise exception 'This number is already with another caller';
    end if;
    update public.leads
    set assigned_to = coalesce(v_existing.assigned_to, v_assignee),
        closed_at = null, closed_reason = null,
        stage = case when stage = 'lost' then 'contacted'::lead_stage else stage end
    where id = v_existing.id;
    v_id := v_existing.id;
    v_existing_flag := true;
  else
    insert into public.leads (business_name, phone, city, assigned_to, category)
    values (btrim(p_name), p_phone, nullif(btrim(coalesce(p_city, '')), ''), v_assignee, v_category)
    returning id into v_id;
  end if;

  if not exists (select 1 from public.reminders where lead_id = v_id and status <> 'done' and kind <> 'demo') then
    insert into public.reminders (lead_id, assigned_to, due_at, note, source, kind)
    select v_id, l.assigned_to, now(), 'Added by hand', 'manual', 'follow_up'
    from public.leads l where l.id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'existing', v_existing_flag);
end;
$$;
revoke execute on function public.quick_add_lead(text, text, text, uuid, text) from anon, public;
grant execute on function public.quick_add_lead(text, text, text, uuid, text) to authenticated;

-- log_call only gains "this change came from a call" for the history.
create or replace function public.mark_source_call()
returns trigger language plpgsql set search_path = public as $$
begin
  perform set_config('crm.source', 'call', true);
  return new;
end;
$$;
drop trigger if exists activities_mark_call_source on public.activities;
create trigger activities_mark_call_source before insert on public.activities
  for each row when (new.type = 'call') execute function public.mark_source_call();

drop function if exists public.get_queue(uuid, int);
create or replace function public.get_queue(p_caller uuid default null, p_new_limit int default 60, p_category text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as sod,
      ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata') as eod,
      coalesce(p_caller, auth.uid()) as who
  ),
  mine as (
    select l.*
    from public.leads l, b
    where l.assigned_to = b.who and l.closed_at is null and l.stage not in ('won', 'lost')
      and (p_category is null or l.category = p_category)
  ),
  rem as (
    select distinct on (r.lead_id) r.lead_id, r.id as reminder_id, r.due_at, r.note, r.kind
    from public.reminders r
    join mine m on m.id = r.lead_id
    where r.status <> 'done' and r.kind <> 'demo'
    order by r.lead_id, r.due_at
  ),
  classified as (
    select
      m.id, m.business_name, m.city, m.phone, m.stage, m.score, m.attempt_count,
      m.last_called_at, m.last_outcome, m.last_note, m.extra_fields, m.created_at,
      m.details_sent_at, m.category,
      rem.reminder_id, rem.due_at, rem.note as due_note, rem.kind as due_kind, m.retry_at,
      case
        when rem.due_at is not null and rem.due_at < b.eod and m.details_sent_at is not null then 'deck'
        when rem.due_at is not null and rem.due_at < b.eod then 'due'
        when rem.due_at is null and m.retry_at is not null and m.retry_at < b.eod
             and m.stage not in ('meeting_booked', 'proposal_sent') then 'retry'
        when rem.due_at is null and m.retry_at is null and m.attempt_count = 0
             and m.stage in ('new', 'attempted', 'contacted', 'qualified') then 'new'
        when rem.due_at is not null or m.retry_at is not null then 'later'
      end as section
    from mine m
    cross join b
    left join rem on rem.lead_id = m.id
  ),
  ranked as (
    select c.*,
      row_number() over (
        partition by c.section
        order by
          case when c.section in ('due', 'deck') then c.due_at end,
          case when c.section = 'retry' then c.retry_at end,
          case when c.section = 'new' then c.score end desc nulls last,
          c.created_at
      ) as rn
    from classified c
    where c.section in ('due', 'deck', 'retry', 'new')
  ),
  called as (
    select a.id, a.lead_id, a.outcome, a.summary, a.created_at, a.next_at, a.is_first_attempt,
           l.business_name, l.city, l.phone, l.category
    from public.activities a
    join public.leads l on l.id = a.lead_id
    cross join b
    -- Not filtered by category: the dial meter counts the whole day.
    where a.type = 'call' and a.actor = b.who and a.created_at >= b.sod
    order by a.created_at desc
  ),
  demos as (
    select r.id, r.lead_id, r.due_at, r.note, l.business_name, l.city, l.phone
    from public.reminders r
    join public.leads l on l.id = r.lead_id
    cross join b
    where r.kind = 'demo' and r.status <> 'done' and r.due_at >= b.sod
      and (l.assigned_to = b.who or r.assigned_to = b.who)
      and (p_category is null or l.category = p_category)
    order by r.due_at
    limit 20
  ),
  cat_counts as (
    select l.category, count(*) as n
    from public.leads l, b
    where l.assigned_to = b.who and l.closed_at is null and l.stage not in ('won', 'lost')
    group by l.category
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) - 'rn' - 'created_at' order by
        case r.section when 'due' then 0 when 'deck' then 1 when 'retry' then 2 else 3 end, r.rn)
      from ranked r
      where r.section <> 'new' or r.rn <= p_new_limit
    ), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'due', count(*) filter (where section = 'due'),
        'deck', count(*) filter (where section = 'deck'),
        'retry', count(*) filter (where section = 'retry'),
        'new', count(*) filter (where section = 'new'),
        'later', count(*) filter (where section = 'later')
      ) from classified
    ),
    'category_counts', coalesce((select jsonb_object_agg(category, n) from cat_counts), '{}'::jsonb),
    'called', coalesce((select jsonb_agg(to_jsonb(c)) from called c), '[]'::jsonb),
    'demos', coalesce((select jsonb_agg(to_jsonb(d)) from demos d), '[]'::jsonb)
  );
$$;
revoke execute on function public.get_queue(uuid, int, text) from anon, public;
grant execute on function public.get_queue(uuid, int, text) to authenticated;

-- Per-category numbers for the meter tooltip, EOD report and Team page.
create or replace function public.get_category_stats(p_caller uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as sod,
      (date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as sow,
      coalesce(p_caller, auth.uid()) as who
  )
  select coalesce(jsonb_object_agg(c.key, jsonb_build_object(
    'label', c.label,
    'dials', (select count(*) from activities a join leads l on l.id = a.lead_id, b
              where a.actor = b.who and a.type = 'call' and a.created_at >= b.sod and l.category = c.key),
    'connected', (select count(*) from activities a join leads l on l.id = a.lead_id, b
              where a.actor = b.who and a.type = 'call' and a.answered and a.created_at >= b.sod and l.category = c.key),
    'decks', (select count(*) from activities a join leads l on l.id = a.lead_id, b
              where a.actor = b.who and a.type = 'call' and a.outcome = 'details_sent' and a.created_at >= b.sod and l.category = c.key),
    'demos', (select count(*) from activities a join leads l on l.id = a.lead_id, b
              where a.actor = b.who and a.type = 'call' and a.outcome = 'demo_booked' and a.created_at >= b.sod and l.category = c.key),
    'week_dials', (select count(*) from activities a join leads l on l.id = a.lead_id, b
              where a.actor = b.who and a.type = 'call' and a.created_at >= b.sow and l.category = c.key),
    'open_leads', (select count(*) from leads l, b
              where l.assigned_to = b.who and l.category = c.key and l.closed_at is null and l.stage not in ('won', 'lost'))
  ) order by c.sort), '{}'::jsonb)
  from lead_categories c;
$$;
revoke execute on function public.get_category_stats(uuid) from anon, public;
grant execute on function public.get_category_stats(uuid) to authenticated;

-- 4. Daily log -------------------------------------------------------------

create or replace function public.get_day_log(p_day date default null, p_caller uuid default null, p_category text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      d as day,
      (d::timestamp at time zone 'Asia/Kolkata') as sod,
      ((d + 1)::timestamp at time zone 'Asia/Kolkata') as eod
    from (select coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date) as d) x
  ),
  acts as (
    select a.lead_id, a.created_at as at, 'activity' as kind, a.type, a.outcome, a.summary,
           a.next_at, a.to_stage::text as to_stage, null::jsonb as changes, null::text as source,
           null::int as version, a.actor
    from public.activities a, b
    where a.created_at >= b.sod and a.created_at < b.eod
      and a.type <> 'status_change'
      and (p_caller is null or a.actor = p_caller)
  ),
  hist as (
    select h.lead_id, h.changed_at as at, 'version' as kind, h.action as type, null::text as outcome,
           null::text as summary, null::timestamptz as next_at, null::text as to_stage,
           h.changes, h.source, h.version, h.actor
    from public.lead_history h, b
    where h.changed_at >= b.sod and h.changed_at < b.eod
      and h.action <> 'baseline'
      and (p_caller is null or h.actor = p_caller or h.actor is null)
  ),
  ev as (
    select e.*, p.name as actor_name
    from (select * from acts union all select * from hist) e
    left join public.profiles p on p.id = e.actor
  ),
  touched as (
    select l.id, l.business_name, l.city, l.phone, l.stage, l.category, l.details_sent_at,
           l.last_outcome, l.closed_at,
           max(ev.at) as last_at,
           jsonb_agg(jsonb_build_object(
             'at', ev.at, 'kind', ev.kind, 'type', ev.type, 'outcome', ev.outcome,
             'summary', ev.summary, 'next_at', ev.next_at, 'changes', ev.changes,
             'source', ev.source, 'version', ev.version, 'actor', ev.actor_name
           ) order by ev.at) as events
    from ev
    join public.leads l on l.id = ev.lead_id
    where (p_category is null or l.category = p_category)
    group by l.id
  )
  select jsonb_build_object(
    'day', (select day from b),
    'summary', jsonb_build_object(
      'leads_touched', (select count(*) from touched),
      'dials', (select count(*) from ev join public.leads l on l.id = ev.lead_id
                where ev.kind = 'activity' and ev.type = 'call' and (p_category is null or l.category = p_category)),
      'connected', (select count(*) from acts a join public.leads l on l.id = a.lead_id
                where a.type = 'call' and a.outcome not in ('no_answer', 'busy', 'switched_off', 'wrong_number')
                  and (p_category is null or l.category = p_category)),
      'decks', (select count(*) from acts a join public.leads l on l.id = a.lead_id
                where a.outcome = 'details_sent' and (p_category is null or l.category = p_category)),
      'demos', (select count(*) from acts a join public.leads l on l.id = a.lead_id
                where a.outcome = 'demo_booked' and (p_category is null or l.category = p_category)),
      'added', (select count(*) from hist h join public.leads l on l.id = h.lead_id
                where h.type = 'created' and (p_category is null or l.category = p_category)),
      'edited', (select count(distinct h.lead_id) from hist h join public.leads l on l.id = h.lead_id
                where h.type = 'updated' and h.source <> 'call' and (p_category is null or l.category = p_category))
    ),
    'leads', coalesce((select jsonb_agg(to_jsonb(t) order by t.last_at desc) from touched t), '[]'::jsonb)
  );
$$;
revoke execute on function public.get_day_log(date, uuid, text) from anon, public;
grant execute on function public.get_day_log(date, uuid, text) to authenticated;

-- Days that had any activity, for the day picker (last 60).
create or replace function public.get_active_days(p_caller uuid default null)
returns table (day date, events bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select (a.created_at at time zone 'Asia/Kolkata')::date as day, count(*)
  from public.activities a
  where p_caller is null or a.actor = p_caller
  group by 1
  order by 1 desc
  limit 60;
$$;
revoke execute on function public.get_active_days(uuid) from anon, public;
grant execute on function public.get_active_days(uuid) to authenticated;
