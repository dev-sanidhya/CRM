-- "Deck / details sent": a call result of its own plus a permanent stamp on
-- the lead (details_sent_at), so deck requests can be sorted, filtered and
-- followed up instead of being logged as Callback or Not interested.

alter table public.leads add column if not exists details_sent_at timestamptz;
create index if not exists leads_details_sent_idx on public.leads (assigned_to, details_sent_at desc)
  where details_sent_at is not null;

alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (
  outcome is null or outcome in (
    'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback',
    'interested', 'details_sent', 'demo_booked', 'not_interested', 'dnc', 'connected'
  )
);

create or replace function public.outcome_label(p text)
returns text
language sql immutable
set search_path = public
as $$
  select case p
    when 'no_answer' then 'No answer'
    when 'busy' then 'Busy / cut'
    when 'switched_off' then 'Switched off'
    when 'wrong_number' then 'Wrong number'
    when 'callback' then 'Call back'
    when 'interested' then 'Interested'
    when 'details_sent' then 'Deck / details sent'
    when 'demo_booked' then 'Demo booked'
    when 'not_interested' then 'Not interested'
    when 'dnc' then 'Do not call'
    when 'connected' then 'Spoke'
    else p
  end;
$$;

-- Stamp the leads whose notes already say they asked for details or a deck.
update public.leads l
set details_sent_at = x.first_ask
from (
  select lead_id, min(created_at) as first_ask
  from public.activities
  where type = 'call'
    and summary ~* '(asked for (the )?(details|deck|brochure|portfolio)|send (the )?(details|deck|brochure|portfolio)|\mdeck\M|brochure)'
  group by lead_id
) x
where l.id = x.lead_id and l.details_sent_at is null;

create or replace function public.log_call(
  p_lead_id uuid,
  p_outcome text,
  p_note text default null,
  p_next_at timestamptz default null,
  p_call_started_at timestamptz default null,
  p_away_seconds int default null,
  p_source text default 'typed',
  p_transcript text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_eod timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata';
  v_is_miss boolean := p_outcome in ('no_answer', 'busy', 'switched_off');
  v_is_close boolean := p_outcome in ('wrong_number', 'not_interested', 'dnc');
  v_base public.lead_stage;
  v_stage public.lead_stage;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_summary text;
  v_activity_id uuid;
  v_stage_activity_id uuid;
  v_reminder_id uuid;
  v_closed uuid[];
  v_retry timestamptz;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_outcome not in ('no_answer', 'busy', 'switched_off', 'wrong_number', 'callback',
                       'interested', 'details_sent', 'demo_booked', 'not_interested', 'dnc') then
    raise exception 'Unknown outcome: %', p_outcome;
  end if;
  if p_outcome in ('callback', 'interested', 'details_sent', 'demo_booked') and p_next_at is null then
    raise exception 'Pick a time for %', outcome_label(p_outcome);
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  v_base := case when v_lead.stage = 'lost' and not v_is_miss and not v_is_close then 'new' else v_lead.stage end;
  v_stage := case p_outcome
    when 'wrong_number' then 'lost'
    when 'not_interested' then 'lost'
    when 'dnc' then 'lost'
    when 'demo_booked' then greatest(v_base, 'meeting_booked')
    when 'interested' then greatest(v_base, 'qualified')
    when 'details_sent' then greatest(v_base, 'contacted')
    when 'callback' then greatest(v_base, 'contacted')
    else greatest(v_base, 'attempted')
  end;

  v_summary := coalesce(v_note, outcome_label(p_outcome));
  v_retry := case when v_is_miss then next_workday_ist(now()) end;

  with closed as (
    update public.reminders
    set status = 'done',
        completed_at = now(),
        resolution_note = outcome_label(p_outcome) || coalesce(': ' || v_note, '')
    where lead_id = p_lead_id
      and status <> 'done'
      and kind <> 'demo'
      and (due_at < v_eod or p_next_at is not null or v_is_close)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_closed from closed;

  insert into public.activities (
    lead_id, actor, type, summary, source, raw_transcript, answered, outcome,
    call_started_at, away_seconds, is_first_attempt, next_at
  ) values (
    p_lead_id, v_uid, 'call', v_summary,
    case when p_source = 'voice' then 'voice' else 'typed' end,
    p_transcript, not v_is_miss and p_outcome <> 'wrong_number', p_outcome,
    p_call_started_at, p_away_seconds, v_lead.attempt_count = 0, p_next_at
  ) returning id into v_activity_id;

  if v_stage <> v_lead.stage then
    insert into public.activities (lead_id, actor, type, summary, source, to_stage)
    values (p_lead_id, v_uid, 'status_change', 'Stage changed to ' || replace(v_stage::text, '_', ' '), 'typed', v_stage)
    returning id into v_stage_activity_id;
  end if;

  if p_next_at is not null then
    insert into public.reminders (lead_id, assigned_to, due_at, note, source, kind)
    values (
      p_lead_id,
      coalesce(v_lead.assigned_to, v_uid),
      p_next_at,
      coalesce(v_note, case when p_outcome = 'details_sent' then 'Deck sent, follow up' else outcome_label(p_outcome) end),
      'call',
      case p_outcome when 'callback' then 'callback' when 'demo_booked' then 'demo' else 'follow_up' end
    ) returning id into v_reminder_id;
  end if;

  update public.leads set
    stage = v_stage,
    attempt_count = v_lead.attempt_count + 1,
    last_called_at = now(),
    last_outcome = p_outcome,
    last_note = v_summary,
    retry_at = v_retry,
    closed_at = case when v_is_close then now() end,
    closed_reason = case when v_is_close then p_outcome end,
    details_sent_at = case when p_outcome = 'details_sent' then coalesce(v_lead.details_sent_at, now()) else v_lead.details_sent_at end
  where id = p_lead_id;

  update public.activities set undo = jsonb_build_object(
    'lead', jsonb_build_object(
      'stage', v_lead.stage,
      'attempt_count', v_lead.attempt_count,
      'last_called_at', v_lead.last_called_at,
      'last_outcome', v_lead.last_outcome,
      'last_note', v_lead.last_note,
      'retry_at', v_lead.retry_at,
      'closed_at', v_lead.closed_at,
      'closed_reason', v_lead.closed_reason,
      'details_sent_at', v_lead.details_sent_at
    ),
    'closed_reminders', to_jsonb(v_closed),
    'reminder_id', v_reminder_id,
    'stage_activity_id', v_stage_activity_id
  ) where id = v_activity_id;

  return jsonb_build_object(
    'activity_id', v_activity_id,
    'stage', v_stage,
    'retry_at', v_retry,
    'reminder_id', v_reminder_id
  );
end;
$$;

create or replace function public.delete_call(p_activity_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_act public.activities%rowtype;
  v_is_latest boolean;
  v_lead jsonb;
begin
  select * into v_act from public.activities where id = p_activity_id and type = 'call';
  if not found then
    raise exception 'Call not found';
  end if;

  select not exists (
    select 1 from public.activities
    where lead_id = v_act.lead_id and type = 'call' and created_at > v_act.created_at
  ) into v_is_latest;

  if v_is_latest and v_act.undo is not null then
    v_lead := v_act.undo -> 'lead';
    update public.leads set
      stage = (v_lead ->> 'stage')::public.lead_stage,
      attempt_count = (v_lead ->> 'attempt_count')::int,
      last_called_at = (v_lead ->> 'last_called_at')::timestamptz,
      last_outcome = v_lead ->> 'last_outcome',
      last_note = v_lead ->> 'last_note',
      retry_at = (v_lead ->> 'retry_at')::timestamptz,
      closed_at = (v_lead ->> 'closed_at')::timestamptz,
      closed_reason = v_lead ->> 'closed_reason',
      details_sent_at = case when v_lead ? 'details_sent_at'
                             then (v_lead ->> 'details_sent_at')::timestamptz
                             else details_sent_at end
    where id = v_act.lead_id;

    update public.reminders
    set status = 'pending', completed_at = null, resolution_note = null
    where id in (select jsonb_array_elements_text(coalesce(v_act.undo -> 'closed_reminders', '[]'))::uuid);

    delete from public.reminders where id = (v_act.undo ->> 'reminder_id')::uuid;
    delete from public.activities where id = (v_act.undo ->> 'stage_activity_id')::uuid;
    delete from public.activities where id = v_act.id;
  else
    delete from public.activities where id = v_act.id;
    update public.leads l set
      attempt_count = s.n,
      last_called_at = s.last,
      last_outcome = s.outcome,
      last_note = s.summary
    from (
      select count(*)::int as n,
             max(created_at) as last,
             (array_agg(outcome order by created_at desc))[1] as outcome,
             (array_agg(summary order by created_at desc))[1] as summary
      from public.activities where lead_id = v_act.lead_id and type = 'call'
    ) s
    where l.id = v_act.lead_id;
  end if;

  return jsonb_build_object('lead_id', v_act.lead_id, 'restored', v_is_latest and v_act.undo is not null);
end;
$$;

create or replace function public.get_queue(p_caller uuid default null, p_new_limit int default 60)
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
      m.details_sent_at,
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
           l.business_name, l.city, l.phone
    from public.activities a
    join public.leads l on l.id = a.lead_id
    cross join b
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
    order by r.due_at
    limit 20
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
    'called', coalesce((select jsonb_agg(to_jsonb(c)) from called c), '[]'::jsonb),
    'demos', coalesce((select jsonb_agg(to_jsonb(d)) from demos d), '[]'::jsonb)
  );
$$;

create or replace function public.get_day_stats(p_caller uuid default null)
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
      ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '2 day') at time zone 'Asia/Kolkata') as eod2,
      (date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as sow,
      coalesce(p_caller, auth.uid()) as who
  ),
  wk as (
    select a.* from public.activities a, b
    where a.actor = b.who and a.type = 'call' and a.created_at >= b.sow
  )
  select jsonb_build_object(
    'dials', (select count(*) from wk, b where wk.created_at >= b.sod),
    'new_dials', (select count(*) from wk, b where wk.created_at >= b.sod and wk.is_first_attempt),
    'connected', (select count(*) from wk, b where wk.created_at >= b.sod and wk.answered),
    'decks', (select count(*) from wk, b where wk.created_at >= b.sod and wk.outcome = 'details_sent'),
    'demos', (
      select count(*) from public.activities a, b
      where a.actor = b.who and a.type = 'status_change' and a.to_stage = 'meeting_booked' and a.created_at >= b.sod
    ),
    'week_dials', (select count(*) from wk),
    'week_connected', (select count(*) from wk where wk.answered),
    'week_decks', (select count(*) from wk where wk.outcome = 'details_sent'),
    'follow_ups_done', (
      select count(*) from public.reminders r, b
      where r.assigned_to = b.who and r.status = 'done' and r.completed_at >= b.sod
    ),
    'overdue', (
      select count(*) from public.reminders r, b
      where r.assigned_to = b.who and r.status <> 'done' and r.kind <> 'demo' and r.due_at < b.sod
    ),
    'due_tomorrow', (
      select count(*) from public.reminders r, b
      where r.assigned_to = b.who and r.status <> 'done' and r.due_at >= b.eod and r.due_at < b.eod2
    ) + (
      select count(*) from public.leads l, b
      where l.assigned_to = b.who and l.closed_at is null and l.retry_at >= b.eod and l.retry_at < b.eod2
    ),
    'decks_open', (
      select count(*) from public.leads l, b
      where l.assigned_to = b.who and l.details_sent_at is not null
        and l.closed_at is null and l.stage not in ('won', 'lost', 'meeting_booked', 'proposal_sent')
    ),
    'all_time_dials', (select count(*) from public.activities a, b where a.actor = b.who and a.type = 'call'),
    'all_time_demos', (
      select count(*) from public.activities a, b
      where a.actor = b.who and a.type = 'status_change' and a.to_stage = 'meeting_booked'
    )
  );
$$;
