// Telegram: founders link once with their own code; the bot then knows who is who in private
// chats and in groups. Works with long polling (always-on) or a webhook (hosts that sleep).
import dns from 'node:dns';
import net from 'node:net';
import { getState, setState, saveMessage, clearMessages } from './db.js';
import { runAgent, DIGEST_TASK } from './agent.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// BOT_FOUNDERS="Sanidhya:CODE1,Atharva:CODE2"
export const FOUNDERS = String(process.env.BOT_FOUNDERS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const i = s.indexOf(':'); return { name: s.slice(0, i).trim(), code: s.slice(i + 1).trim() }; })
  .filter((f) => f.name && f.code);

let me = null; // the bot's own Telegram user

// Reaching Telegram from the host: prefer IPv4 and give each connection attempt time. Node's default
// tries IPv6 and IPv4 with a 250 ms cut-off, which on a slow route fails with ETIMEDOUT
// ("fetch failed"); that is what once dropped replies for a few minutes.
dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Telegram Bot API. Network errors, 5xx and 429 are retried with backoff (about 40 s in
 * total by default), so a short blip does not lose a reply. Errors Telegram reports for the request
 * itself (4xx) are not retried.
 */
export async function tg(method, params = {}, { retries = 5, timeoutMs = 20000 } = {}) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const delays = [1000, 3000, 6000, 10000, 15000];
  for (let attempt = 0; ; attempt++) {
    let retryAfterMs = null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) return data.result;
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || attempt >= retries) throw Object.assign(new Error(data.description || `HTTP ${res.status}`), { final: true });
      if (data.parameters?.retry_after) retryAfterMs = data.parameters.retry_after * 1000;
    } catch (e) {
      if (e.final || attempt >= retries) throw e;
    }
    const wait = retryAfterMs ?? delays[Math.min(attempt, delays.length - 1)];
    console.warn(`telegram ${method} failed, retry ${attempt + 1}/${retries} in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
}

async function whoAmI() {
  if (!me) me = await tg('getMe');
  return me;
}

export async function send(chatId, text, replyTo = null) {
  const t = String(text || '').trim() || '(nothing to report)';
  for (let i = 0; i < t.length; i += 3900) {
    const params = { chat_id: chatId, text: t.slice(i, i + 3900), disable_web_page_preview: true };
    if (replyTo && i === 0) params.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
    await tg('sendMessage', params);
  }
}

// ---- who is linked ----
// people: [{ name, user_id, chat_id (their private chat), linked_at }]
// groups: [{ chat_id, title, enabled_by, at }]
export const people = async () => (await getState('people', [])) || [];
export const groups = async () => (await getState('groups', [])) || [];
const personFor = async (userId) => (await people()).find((p) => p.user_id === userId) || null;

/** Where the daily update goes: the founders' group(s) if any, else each founder privately. */
export async function broadcast(text) {
  const g = await groups();
  const targets = g.length ? g.map((x) => x.chat_id) : (await people()).map((p) => p.chat_id).filter(Boolean);
  for (const chatId of targets) {
    try { await send(chatId, text); await saveMessage(chatId, 'assistant', text); } catch (e) { console.error('broadcast failed', chatId, e.message); }
  }
  return targets.length;
}
export async function hasAudience() {
  return (await groups()).length > 0 || (await people()).some((p) => p.chat_id);
}

function typingLoop(chatId) {
  const ping = () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }, { retries: 0, timeoutMs: 8000 }).catch(() => {});
  ping();
  const t = setInterval(ping, 4500);
  return () => clearInterval(t);
}

const help = (username, inGroup) => `I'm Jas, the Aperture CRM analyst. ${inGroup ? `In this group, mention me (@${username}) or reply to one of my messages.` : 'Just ask.'} For example:
- How did today go?
- Who are the hottest leads right now?
- What happened with StoryBizz?
- Compare this week with last week

Commands: /report (today's update now), /reset (forget this chat's history), /help`;

async function link(msg, code) {
  const founder = FOUNDERS.find((f) => f.code === code);
  if (!founder) return null;
  const list = await people();
  const others = list.filter((p) => p.name !== founder.name && p.user_id !== msg.from.id);
  const entry = {
    name: founder.name,
    user_id: msg.from.id,
    chat_id: msg.chat.type === 'private' ? msg.chat.id : (list.find((p) => p.name === founder.name)?.chat_id ?? null),
    linked_at: new Date().toISOString(),
  };
  await setState('people', [...others, entry]);
  return entry;
}

async function enableGroup(chat, person) {
  const g = await groups();
  if (g.some((x) => x.chat_id === chat.id)) return false;
  await setState('groups', [...g, { chat_id: chat.id, title: chat.title || '', enabled_by: person.name, at: new Date().toISOString() }]);
  return true;
}

// One question at a time per chat.
const busy = new Map();

export async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.chat || !msg.from || msg.from.is_bot) return;
  const bot = await whoAmI();
  const chat = msg.chat;
  const inGroup = chat.type === 'group' || chat.type === 'supergroup';
  if (!inGroup && chat.type !== 'private') return;
  const raw = String(msg.text || msg.caption || '').trim();
  const person = await personFor(msg.from.id);

  // Bot added to a group: enable it only if a linked founder added it.
  if (inGroup && Array.isArray(msg.new_chat_members) && msg.new_chat_members.some((u) => u.id === bot.id)) {
    if (!person) return send(chat.id, 'I only work for the Aperture founders. A founder needs to link first: message me privately with /start and your code.');
    await enableGroup(chat, person);
    return send(chat.id, `Thank you, Sir. I'm set up for this group: the daily update will come here at 7:00 pm IST.\n\n${help(bot.username, true)}`);
  }

  // Commands may be addressed as /cmd@BotName in groups.
  const cmdMatch = raw.match(/^\/(\w+)(?:@(\w+))?(?:\s+(.*))?$/s);
  const cmd = cmdMatch && (!cmdMatch[2] || cmdMatch[2].toLowerCase() === bot.username.toLowerCase()) ? cmdMatch[1].toLowerCase() : null;
  const arg = cmdMatch ? (cmdMatch[3] || '').trim() : '';

  if (cmd === 'start' || cmd === 'link') {
    if (arg) {
      const linked = await link(msg, arg);
      if (!linked) return send(chat.id, 'That code is not right. Check it and send /start followed by your code.');
      if (inGroup) await enableGroup(chat, linked);
      return send(chat.id, `Linked. Welcome, Sir.\n\n${help(bot.username, inGroup)}`, inGroup ? msg.message_id : null);
    }
    if (person) return send(chat.id, `You're already linked, Sir.\n\n${help(bot.username, inGroup)}`);
    return inGroup ? null : send(chat.id, 'This bot is private. Send /start followed by your personal code.');
  }

  // Everyone else is ignored (silently in groups).
  if (!person) return inGroup ? null : send(chat.id, 'This bot is private. Send /start followed by your personal code.');

  if (inGroup) {
    const g = await groups();
    if (!g.some((x) => x.chat_id === chat.id)) {
      if (cmd === 'enable' || (raw.includes(`@${bot.username}`))) await enableGroup(chat, person);
      else return;
    }
  }

  if (cmd === 'help') return send(chat.id, help(bot.username, inGroup));
  if (cmd === 'reset') { await clearMessages(chat.id); return send(chat.id, 'Done, Boss. Starting fresh in this chat.'); }

  // In a group, only answer when spoken to: a mention, a reply to me, or a command.
  const mentioned = raw.toLowerCase().includes(`@${bot.username.toLowerCase()}`);
  const repliedToMe = msg.reply_to_message?.from?.id === bot.id;
  if (inGroup && !mentioned && !repliedToMe && cmd !== 'report' && cmd !== 'ask') return;

  const text = (cmd === 'ask' ? arg : raw).replace(new RegExp(`@${bot.username}`, 'ig'), '').trim();
  if (cmd !== 'report' && !text) return send(chat.id, 'Yes Sir? Ask me anything about the CRM.', inGroup ? msg.message_id : null);

  if (busy.get(chat.id)) return send(chat.id, 'Still working on the last question, one moment.', inGroup ? msg.message_id : null);
  busy.set(chat.id, true);
  const stop = typingLoop(chat.id);
  try {
    const isReport = cmd === 'report';
    if (!isReport) await saveMessage(chat.id, 'user', `[${person.name}] ${text}`);
    const everyone = (await people()).map((p) => p.name);
    const out = await runAgent(isReport
      ? { task: DIGEST_TASK, speaker: person.name, inGroup, everyone }
      : { task: `Answer ${person.name}'s latest message. Use the CRM tools; your final text is sent to the chat on Telegram.`, chatId: chat.id, speaker: person.name, inGroup, everyone });
    stop();
    await send(chat.id, out.text, inGroup ? msg.message_id : null);
    await saveMessage(chat.id, 'assistant', out.text);
    console.log(`answered ${person.name} in ${inGroup ? 'group' : 'private'} in ${out.ms} ms`);
  } catch (e) {
    stop();
    console.error('agent error', e);
    await send(chat.id, `Sorry Sir, I hit a problem reading the CRM. Please ask again in a moment.`, inGroup ? msg.message_id : null);
  } finally {
    busy.set(chat.id, false);
  }
}

/** Long polling, for an always-on process. */
export async function startPolling() {
  await tg('deleteWebhook').catch(() => {});
  const bot = await whoAmI();
  console.log(`Telegram polling as @${bot.username}; founders configured: ${FOUNDERS.map((f) => f.name).join(', ') || 'none'}`);
  let offset = Number(await getState('tg_offset', 0)) || 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, { retries: 0, timeoutMs: 40000 });
      for (const u of updates) {
        offset = u.update_id + 1;
        await setState('tg_offset', offset);
        handleUpdate(u).catch((e) => console.error('update failed', e));
      }
    } catch (e) {
      console.error('polling error', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
