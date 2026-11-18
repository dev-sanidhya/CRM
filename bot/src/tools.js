// The agent's tools. All of them only read the CRM.
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { sql, readOnlyQuery } from './db.js';
import { clockBlock, istParts } from './time.js';

const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });
const err = (m) => ({ content: [{ type: 'text', text: `ERROR: ${m}` }], isError: true });
const safe = (fn) => async (args) => {
  try { return await fn(args); } catch (e) { return err(e.message); }
};
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('IST date YYYY-MM-DD. Default: today.');
const today = () => istParts().date;

// ---- day overview: the numbers behind the daily update ----
async function overview(day) {
  const [head] = await sql`
    with d as (select ${day}::date as day),
    calls as (
      select a.*, (a.created_at at time zone 'Asia/Kolkata')::date as ist_day, l.category
      from activities a join leads l on l.id = a.lead_id
      where a.type = 'call' and a.created_at >= ((select day from d) - 8)::timestamp at time zone 'Asia/Kolkata'
    ),
    per_day as (
      select ist_day, count(*) dials, count(*) filter (where is_first_attempt) new_dials,
             count(*) filter (where answered) conversations,
             count(*) filter (where outcome = 'details_sent') decks,
             count(*) filter (where outcome = 'demo_booked') demos,
             count(*) filter (where outcome in ('not_interested','dnc')) lost,
             count(*) filter (where outcome = 'wrong_number') wrong_numbers
      from calls group by ist_day
    )
    select
      (select row_to_json(p) from per_day p where ist_day = (select day from d)) as day,
      (select row_to_json(p) from per_day p where ist_day = (select day from d) - 1) as previous_day,
      (select json_build_object('days_with_calls', count(*), 'avg_dials', round(avg(dials), 1), 'avg_conversations', round(avg(conversations), 1))
         from per_day where ist_day between (select day from d) - 7 and (select day from d) - 1) as last_7_days,
      (select json_agg(json_build_object('list', category, 'dials', n, 'conversations', c, 'decks', k, 'demos', m))
         from (select category, count(*) n, count(*) filter (where answered) c, count(*) filter (where outcome='details_sent') k, count(*) filter (where outcome='demo_booked') m
               from calls where ist_day = (select day from d) group by category) x) as by_list,
      (select count(*) from activities a
         where a.type = 'call' and a.created_at >= date_trunc('week', (select day from d)::timestamp) at time zone 'Asia/Kolkata'
           and a.created_at < ((select day from d) + 1)::timestamp at time zone 'Asia/Kolkata') as week_dials_to_date,
      (select string_agg(distinct p.name, ', ') from calls c join profiles p on p.id = c.actor where c.ist_day = (select day from d)) as callers
  `;
  const demosBooked = await sql`
    select l.business_name, l.city, l.category, a.next_at at time zone 'Asia/Kolkata' as demo_at_ist, a.summary
    from activities a join leads l on l.id = a.lead_id
    where a.type = 'call' and a.outcome = 'demo_booked' and (a.created_at at time zone 'Asia/Kolkata')::date = ${day}::date
    order by a.created_at`;
  const upcomingDemos = await sql`
    select l.business_name, l.city, l.category, r.due_at at time zone 'Asia/Kolkata' as demo_at_ist, r.note
    from reminders r join leads l on l.id = r.lead_id
    where r.kind = 'demo' and r.status <> 'done' and r.due_at >= now() and r.due_at < now() + interval '4 days'
    order by r.due_at limit 15`;
  const attention = await sql`
    select
      (select count(*) from reminders r where r.status <> 'done' and r.kind <> 'demo' and r.due_at < now()) as overdue_follow_ups,
      (select json_agg(x) from (select l.business_name, r.due_at at time zone 'Asia/Kolkata' as was_due_ist, r.note
         from reminders r join leads l on l.id = r.lead_id
         where r.status <> 'done' and r.kind <> 'demo' and r.due_at < now() order by r.due_at limit 10) x) as overdue_list,
      (select count(*) from reminders r
         where r.status <> 'done' and r.kind <> 'demo'
           and (r.due_at at time zone 'Asia/Kolkata')::date = ${day}::date + 1) as due_next_day,
      (select json_agg(x) from (select l.business_name, l.details_sent_at at time zone 'Asia/Kolkata' as deck_sent_ist, l.last_note
         from leads l
         where l.details_sent_at is not null and l.closed_at is null and l.stage not in ('won','lost','meeting_booked')
           and not exists (select 1 from reminders r where r.lead_id = l.id and r.status <> 'done')
         order by l.details_sent_at limit 10) x) as deck_leads_without_follow_up,
      (select count(*) from leads where closed_at is null and stage not in ('won','lost') and attempt_count = 0) as never_called_open_leads
  `;
  return { date: day, ...head, demos_booked_that_day: demosBooked, upcoming_demos_next_4_days: upcomingDemos, attention: attention[0] };
}

// ---- conversion signals ----
async function signals(category, limit) {
  return sql`
    with talk as (
      select lead_id,
             count(*) as calls,
             count(*) filter (where answered) as conversations,
             max(created_at) filter (where answered) as last_conversation,
             string_agg(summary, ' | ' order by created_at desc) filter (where answered and summary is not null) as notes
      from activities where type = 'call' group by lead_id
    ),
    nxt as (
      select distinct on (lead_id) lead_id, due_at, kind from reminders where status <> 'done' order by lead_id, due_at
    ),
    scored as (
      select l.id, l.business_name, l.city, l.category, l.stage::text as stage, l.last_outcome,
             coalesce(t.calls, 0) as calls, coalesce(t.conversations, 0) as conversations,
             t.last_conversation at time zone 'Asia/Kolkata' as last_conversation_ist,
             l.details_sent_at is not null as deck_sent,
             coalesce(l.extra_fields->>'Role', l.extra_fields->>'Ask for', l.extra_fields->>'Ask For') as contact_role,
             n.kind as next_kind, n.due_at at time zone 'Asia/Kolkata' as next_due_ist,
             left(t.notes, 500) as recent_notes,
             (case l.stage when 'meeting_booked' then 50 when 'proposal_sent' then 55 when 'qualified' then 30 when 'contacted' then 15 when 'attempted' then 2 else 0 end)
             + least(coalesce(t.conversations, 0), 4) * 7
             + (case when l.details_sent_at is not null then 12 else 0 end)
             + (case when l.last_outcome = 'callback' then 8 when l.last_outcome = 'interested' then 12 else 0 end)
             + (case when t.notes ~* '(pric|budget|proposal|demo|interested|send (the )?(details|deck)|next week|meeting|requirement|need|timeline)' then 10 else 0 end)
             - (case when t.notes ~* '(not interested|already (have|has)|no budget|not now|not relevant|no need)' then 10 else 0 end)
             + (case when t.last_conversation > now() - interval '3 days' then 10
                     when t.last_conversation > now() - interval '7 days' then 5
                     when t.last_conversation < now() - interval '14 days' then -10 else 0 end)
             + (case when coalesce(l.extra_fields->>'Role', '') ~* '(founder|ceo|director|owner|head|partner)' then 5 else 0 end)
             - (case when coalesce(t.conversations, 0) = 0 and coalesce(t.calls, 0) >= 5 then 10 else 0 end)
             as signal_score
      from leads l
      left join talk t on t.lead_id = l.id
      left join nxt n on n.lead_id = l.id
      where l.closed_at is null and l.stage not in ('won', 'lost')
        and (${category}::text is null or l.category = ${category})
    )
    select * from scored where signal_score > 0 order by signal_score desc, last_conversation_ist desc nulls last limit ${limit}`;
}

// ---- one lead, everything ----
async function leadDossier(q) {
  const digits = q.replace(/\D/g, '');
  const leads = await sql`
    select * from leads
    where business_name ilike ${'%' + q + '%'} or (${digits.length >= 4} and phone like ${'%' + digits + '%'})
    order by updated_at desc limit 5`;
  if (!leads.length) return { found: 0 };
  const lead = leads[0];
  const [calls, reminders, versions] = await Promise.all([
    sql`select a.created_at at time zone 'Asia/Kolkata' as at_ist, a.type, a.outcome, a.summary, a.next_at at time zone 'Asia/Kolkata' as next_ist, p.name as by
        from activities a left join profiles p on p.id = a.actor where a.lead_id = ${lead.id} order by a.created_at desc limit 30`,
    sql`select kind, status, due_at at time zone 'Asia/Kolkata' as due_ist, note, resolution_note from reminders where lead_id = ${lead.id} order by due_at desc limit 15`,
    sql`select version, action, source, changed_at at time zone 'Asia/Kolkata' as at_ist, changes from lead_history where lead_id = ${lead.id} order by version desc limit 20`,
  ]);
  return {
    found: leads.length,
    other_matches: leads.slice(1).map((l) => l.business_name),
    lead: { ...lead, crm_link: `https://aperturecrm.vercel.app/leads/${lead.id}` },
    activity: calls,
    reminders,
    versions,
  };
}

export function crmTools() {
  return [
    tool('get_time', 'Current date and time in IST (today, yesterday).', {}, async () => ok(clockBlock())),

    tool('day_overview',
      'All the numbers for one IST day: dials (new vs follow-up), conversations, decks, demos, lost, by list, vs previous day and 7-day average, week to date, demos booked with times, upcoming demos, overdue follow-ups, follow-ups due next day, deck leads with no follow-up. Use for the daily update and "how did today/yesterday go".',
      { date: dateArg },
      safe(async ({ date }) => ok(await overview(date || today())))),

    tool('day_activity',
      'Every event on one IST day, newest first: each call with its outcome and note, notes, leads added or edited, imports. Optional list filter ("influencer" or "partnership") and text search.',
      { date: dateArg, list: z.enum(['influencer', 'partnership']).optional(), search: z.string().optional() },
      safe(async ({ date, list, search }) => {
        const d = date || today();
        const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        const [r] = await sql`select get_activity_feed(${next.toISOString().slice(0, 10)}::date, 1, null, ${list || null}, ${search || null}) as feed`;
        const day = (r.feed.days || []).find((x) => x.day === d);
        if (!day) return ok({ date: d, events: [], note: 'No activity that day.' });
        const events = day.events.map((e) => ({
          at: new Date(e.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }),
          lead: e.business_name, list: e.category, kind: e.kind, type: e.type, outcome: e.outcome, note: e.summary,
          next: e.next_at, changes: e.changes, by: e.actor, import: e.import_label ? `${e.import_count} leads from ${e.import_label}` : undefined,
        }));
        return ok({ date: d, summary: day.summary, events });
      })),

    tool('lead_signals',
      'Open leads ranked by how likely they are to convert (demo booked, interest, deck sent, conversations, positive notes, recency, decision maker). Returns the evidence per lead. Use for "who is hot", "who will convert", "who should we push".',
      { list: z.enum(['influencer', 'partnership']).optional(), limit: z.number().int().min(1).max(40).optional() },
      safe(async ({ list, limit }) => ok(await signals(list || null, limit || 15)))),

    tool('find_lead',
      'Everything about one lead by company name or phone digits: details, sheet fields, full call history with notes, follow-ups, version history, CRM link.',
      { query: z.string().min(2) },
      safe(async ({ query }) => ok(await leadDossier(query.trim())))),

    tool('run_sql',
      'Run one read-only SELECT (or WITH ... SELECT) on the CRM database for anything the other tools do not cover. Use IST conversions. Returns at most `limit` rows (default 200).',
      { query: z.string(), limit: z.number().int().min(1).max(500).optional() },
      safe(async ({ query, limit }) => {
        const rows = await readOnlyQuery(query, limit);
        return ok({ rows: rows.length, data: rows });
      })),
  ];
}
