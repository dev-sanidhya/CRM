// Google Calendar tools: the agent books calls on the agency calendar (aperturecmservices) and
// invites the founders as guests. Talks to the Calendar API directly with an OAuth refresh token
// (bot/scripts/google-auth.js makes it). Only given to the agent when a founder is speaking.
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { sql } from './db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REFRESH = process.env.GOOGLE_REFRESH_TOKEN || '';
const CAL = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || 'primary');
const TZ = 'Asia/Kolkata';
const API = `https://www.googleapis.com/calendar/v3/calendars/${CAL}/events`;

/** Founders invited by default. Format: Name:email,Name:email */
export const guestBook = () => (process.env.CALENDAR_GUESTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const i = s.indexOf(':'); return { name: s.slice(0, i).trim(), email: s.slice(i + 1).trim() }; })
  .filter((g) => g.name && g.email.includes('@'));

export const calendarEnabled = () => Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH);

const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });
const err = (m) => ({ content: [{ type: 'text', text: `ERROR: ${m}` }], isError: true });
const safe = (fn) => async (a) => { try { return ok(await fn(a)); } catch (e) { return err(e.message); } };

let cached = { token: '', until: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed (${data.error || res.status}). The calendar may need to be connected again.`);
  cached = { token: data.access_token, until: Date.now() + (data.expires_in - 120) * 1000 };
  return cached.token;
}

async function gcal(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar: ${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

function when(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error('Could not read that date and time');
  return d;
}

/** Turn founder names or emails into attendee emails. Empty = all founders. */
function attendees(guests, extra) {
  const book = guestBook();
  const list = guests?.length ? guests : book.map((g) => g.name);
  const out = new Map();
  for (const g of list) {
    if (g.includes('@')) { out.set(g.toLowerCase(), { email: g }); continue; }
    const hit = book.find((b) => b.name.toLowerCase() === g.toLowerCase());
    if (!hit) throw new Error(`No email known for "${g}". Known guests: ${book.map((b) => b.name).join(', ') || 'none'}`);
    out.set(hit.email.toLowerCase(), { email: hit.email, displayName: hit.name });
  }
  for (const e of extra || []) out.set(e.toLowerCase(), { email: e });
  return [...out.values()];
}

const brief = (e) => ({
  event_id: e.id, title: e.summary,
  start_ist: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString('en-IN', { timeZone: TZ }) : e.start?.date,
  end_ist: e.end?.dateTime ? new Date(e.end.dateTime).toLocaleString('en-IN', { timeZone: TZ }) : e.end?.date,
  guests: (e.attendees || []).map((a) => `${a.email} (${a.responseStatus})`),
  meet: e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri,
  link: e.htmlLink,
});

const isoArg = z.string().describe('ISO 8601 with the +05:30 offset, e.g. 2026-11-28T16:00:00+05:30');

export function calendarTools() {
  return [
    tool('calendar_schedule_call',
      'Book a call or meeting on the Aperture Google Calendar and email invites to the guests. By default the guests are both founders; pass guests (founder names or emails) to invite only some. Adds a Google Meet link unless meet is false.',
      {
        title: z.string().min(3).describe('Clear title, e.g. "Demo: StoryBizz x Aperture" or "Callback: Acme Media"'),
        start: isoArg,
        duration_minutes: z.number().int().min(5).max(480).optional().describe('Default 30'),
        guests: z.array(z.string()).optional().describe('Founder names (e.g. ["Sanidhya"]) or emails. Omit for both founders.'),
        extra_emails: z.array(z.string().email()).optional().describe('Anyone else to invite (e.g. the prospect). Only if a founder asked for it.'),
        lead_id: z.string().uuid().optional().describe('CRM lead this call is about (from find_lead); adds its details and CRM link to the invite.'),
        notes: z.string().optional().describe('Agenda or context for the description'),
        meet: z.boolean().optional(),
      },
      safe(async (a) => {
        const start = when(a.start);
        if (start.getTime() < Date.now() - 5 * 60000) throw new Error('That time is in the past');
        const end = new Date(start.getTime() + (a.duration_minutes || 30) * 60000);
        const lines = [];
        if (a.notes) lines.push(a.notes);
        if (a.lead_id) {
          const [l] = await sql`select business_name, phone, city, website, stage, last_note from leads where id = ${a.lead_id}`;
          if (!l) throw new Error('Lead not found');
          lines.push('', `Lead: ${l.business_name}${l.city ? `, ${l.city}` : ''}`, `Phone: ${l.phone}`);
          if (l.website) lines.push(`Website: ${l.website}`);
          if (l.last_note) lines.push(`Last call note: ${l.last_note}`);
          lines.push(`CRM: https://aperturecrm.vercel.app/leads/${a.lead_id}`);
        }
        lines.push('', 'Booked by Jas (Aperture CRM bot) on Telegram.');
        const body = {
          summary: a.title,
          description: lines.join('\n').trim(),
          start: { dateTime: start.toISOString(), timeZone: TZ },
          end: { dateTime: end.toISOString(), timeZone: TZ },
          attendees: attendees(a.guests, a.extra_emails),
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }, { method: 'email', minutes: 60 }] },
        };
        if (a.meet !== false) body.conferenceData = { createRequest: { requestId: `jas-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
        const e = await gcal('POST', `${API}?sendUpdates=all&conferenceDataVersion=1`, body);
        return { done: true, invites_sent: true, ...brief(e) };
      })),

    tool('calendar_list_calls', 'List calls and meetings on the Aperture Google Calendar in a date range (IST). Use it to check for clashes before booking and to find an event_id.',
      {
        from: isoArg.optional().describe('Default now'),
        to: isoArg.optional().describe('Default 7 days after from'),
        search: z.string().optional().describe('Text to match, e.g. a company name'),
      },
      safe(async (a) => {
        const from = a.from ? when(a.from) : new Date();
        const to = a.to ? when(a.to) : new Date(from.getTime() + 7 * 86400000);
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50', timeZone: TZ });
        if (a.search) q.set('q', a.search);
        const data = await gcal('GET', `${API}?${q}`);
        return { count: data.items?.length || 0, events: (data.items || []).map(brief) };
      })),

    tool('calendar_update_call', 'Move or rename a booked call, or change its guests. Guests get the updated invite. Get event_id from calendar_list_calls.',
      {
        event_id: z.string(),
        title: z.string().optional(),
        start: isoArg.optional(),
        duration_minutes: z.number().int().min(5).max(480).optional(),
        guests: z.array(z.string()).optional().describe('Full new guest list (founder names or emails)'),
      },
      safe(async (a) => {
        const cur = await gcal('GET', `${API}/${encodeURIComponent(a.event_id)}`);
        const patch = {};
        if (a.title) patch.summary = a.title;
        if (a.start || a.duration_minutes) {
          const s = a.start ? when(a.start) : new Date(cur.start.dateTime);
          const len = a.duration_minutes || (new Date(cur.end.dateTime) - new Date(cur.start.dateTime)) / 60000;
          patch.start = { dateTime: s.toISOString(), timeZone: TZ };
          patch.end = { dateTime: new Date(s.getTime() + len * 60000).toISOString(), timeZone: TZ };
        }
        if (a.guests) patch.attendees = attendees(a.guests);
        const e = await gcal('PATCH', `${API}/${encodeURIComponent(a.event_id)}?sendUpdates=all&conferenceDataVersion=1`, patch);
        return { done: true, ...brief(e) };
      })),

    tool('calendar_cancel_call', 'Cancel a booked call (only when a founder asks). Guests get a cancellation email. Get event_id from calendar_list_calls.',
      { event_id: z.string() },
      safe(async (a) => {
        await gcal('DELETE', `${API}/${encodeURIComponent(a.event_id)}?sendUpdates=all`);
        return { done: true, cancelled: a.event_id };
      })),
  ];
}
