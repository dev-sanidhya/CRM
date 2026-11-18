-- Activity feed, like a browser/search history: every event (calls, notes,
-- lead changes, imports) newest first, grouped by IST day, loaded a few
-- days at a time. Optional filters: caller, list (category), text search.

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
    -- calls and notes
    select a.id::text as id, a.created_at as at, a.lead_id, 'activity' as kind, a.type, a.outcome,
           a.summary, a.next_at, null::jsonb as changes, null::text as source, a.actor,
           null::text as import_label, null::int as import_count
    from public.activities a
    where a.type <> 'status_change'
      and (p_caller is null or a.actor = p_caller)
    union all
    -- lead versions (created / edited / changed by a call)
    select 'h' || h.id, h.changed_at, h.lead_id, 'version', h.action, null, null, null,
           h.changes, h.source, h.actor, null, null
    from public.lead_history h
    where h.action <> 'baseline'
      and not (h.action = 'created' and h.source = 'import')
      and (p_caller is null or h.actor = p_caller or h.actor is null)
    union all
    -- imports, one line each instead of one per lead
    select 'i' || s.id, s.imported_at, null, 'import', 'import', null, null, null,
           null, null, s.imported_by,
           case when s.sheet_url like 'file:%' then substr(s.sheet_url, 6) else 'Google Sheet' end,
           s.new_lead_count + s.updated_lead_count
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
            'category', e.category, 'actor', e.actor_name,
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

revoke execute on function public.get_activity_feed(date, int, uuid, text, text) from anon, public;
grant execute on function public.get_activity_feed(date, int, uuid, text, text) to authenticated;
