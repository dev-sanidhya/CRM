// Tools that change the CRM. Only given to the agent when a founder is talking to it (never for the
// automatic daily update). They call the botw.* database functions, which tag every change as
// coming from Telegram with the founder who asked, so the CRM shows it in its own colour.
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { sql } from './db.js';

const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });
const err = (m) => ({ content: [{ type: 'text', text: `ERROR: ${m}` }], isError: true });

/** The founder's CRM profile: their own if it exists, else the shared founder account. */
async function founderProfile(name) {
  const rows = await sql`select id, name from profiles where role = 'founder' order by name`;
  const n = String(name || '').toLowerCase();
  const exact = rows.find((r) => r.name.toLowerCase() === n);
  const shared = rows.find((r) => r.name.toLowerCase().includes(n));
  return exact || shared || null;
}

/** Run one botw.* function in a read-write transaction (the bot's default is read only). */
async function call(fn, args) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await sql.begin('read write', (tx) => tx.unsafe(`select botw.${fn}(${placeholders}) as r`, args));
  return rows[0].r;
}

const leadId = z.string().uuid().describe('The lead id from find_lead (never guess it).');

export function writeTools(speaker) {
  const run = (fn, build) => async (a) => {
    try {
      const p = await founderProfile(speaker);
      if (!p) return err(`No founder profile found for ${speaker}.`);
      const result = await call(fn, build(a, p.id, speaker));
      return ok({ done: true, ...result, crm_link: a.lead_id ? `https://aperturecrm.vercel.app/leads/${a.lead_id}` : undefined });
    } catch (e) {
      return err(e.message);
    }
  };

  return [
    tool('crm_add_note', 'Add a note to a lead (shows in its history, tagged as from Telegram).',
      { lead_id: leadId, text: z.string().min(1) },
      run('add_note', (a, actor, by) => [a.lead_id, a.text, actor, by])),

    tool('crm_set_stage', 'Change a lead\'s stage. Stages: new, attempted, contacted, qualified, meeting_booked, proposal_sent, won, lost. won/lost close the lead; others reopen it.',
      { lead_id: leadId, stage: z.enum(['new', 'attempted', 'contacted', 'qualified', 'meeting_booked', 'proposal_sent', 'won', 'lost']), note: z.string().optional() },
      run('set_stage', (a, actor, by) => [a.lead_id, a.stage, a.note || null, actor, by])),

    tool('crm_schedule', 'Schedule a follow-up, callback or demo for a lead at a date and time. Give the time as ISO 8601 with the +05:30 offset (IST). A demo also sets the stage to Demo booked. Scheduling reopens a closed lead.',
      { lead_id: leadId, kind: z.enum(['follow_up', 'callback', 'demo']), at: z.string().describe('e.g. 2026-11-25T16:00:00+05:30'), note: z.string().optional() },
      run('schedule', (a, actor, by) => {
        const at = new Date(a.at);
        if (isNaN(at.getTime())) throw new Error('Could not read that date and time');
        if (at.getTime() < Date.now() - 5 * 60000) throw new Error('That time is in the past');
        return [a.lead_id, a.kind, at.toISOString(), a.note || null, actor, by];
      })),

    tool('crm_complete_follow_ups', 'Mark a lead\'s open follow-ups and callbacks as done (and demos too if include_demos).',
      { lead_id: leadId, include_demos: z.boolean().optional(), note: z.string().optional() },
      run('complete_follow_ups', (a, actor, by) => [a.lead_id, !!a.include_demos, a.note || null, actor, by])),

    tool('crm_set_deck_sent', 'Mark (or unmark) that the deck / details were sent to a lead.',
      { lead_id: leadId, sent: z.boolean() },
      run('set_deck_sent', (a, actor, by) => [a.lead_id, a.sent, actor, by])),

    tool('crm_move_list', 'Move a lead to another list: influencer (Influencer management) or partnership (Partnership calls).',
      { lead_id: leadId, list: z.enum(['influencer', 'partnership']) },
      run('set_list', (a, actor, by) => [a.lead_id, a.list, actor, by])),

    tool('crm_update_details', 'Correct a lead\'s business name, phone (E.164, e.g. +919876543210), city or website. Only pass the fields to change.',
      { lead_id: leadId, name: z.string().optional(), phone: z.string().optional(), city: z.string().optional(), website: z.string().optional() },
      run('update_details', (a, actor, by) => [a.lead_id, a.name || null, a.phone || null, a.city || null, a.website || null, actor, by])),

    tool('crm_close_lead', 'Close a lead as lost, with the reason. Also clears its open follow-ups.',
      { lead_id: leadId, reason: z.string().min(1) },
      run('close_lead', (a, actor, by) => [a.lead_id, a.reason, actor, by])),

    tool('crm_reopen_lead', 'Reopen a closed lead; it goes back into the caller\'s "Try again" list.',
      { lead_id: leadId, note: z.string().optional() },
      run('reopen_lead', (a, actor, by) => [a.lead_id, a.note || null, actor, by])),
  ];
}
