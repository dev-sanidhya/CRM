// Telegram: send messages, link founders with a private code, handle commands and questions.
// Works with long polling (always-on host or a Mac) or a webhook (hosts that sleep).
import { getState, setState, saveMessage, clearMessages } from './db.js';
import { runAgent, DIGEST_TASK } from './agent.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const LINK_CODE = process.env.BOT_LINK_CODE || '';
const MAX_CHATS = 4;

export async function tg(method, params = {}) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return data.result;
}

export async function send(chatId, text) {
  const t = String(text || '').trim() || '(nothing to report)';
  for (let i = 0; i < t.length; i += 3900) await tg('sendMessage', { chat_id: chatId, text: t.slice(i, i + 3900), disable_web_page_preview: true });
}

export async function linkedChats() {
  return (await getState('linked_chats', [])) || [];
}

/** Send the same text to every linked founder. */
export async function broadcast(text) {
  const chats = await linkedChats();
  for (const c of chats) {
    try { await send(c.chat_id, text); await saveMessage(c.chat_id, 'assistant', text); } catch (e) { console.error('broadcast failed', c.chat_id, e.message); }
  }
  return chats.length;
}

function typingLoop(chatId) {
  const ping = () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  ping();
  const t = setInterval(ping, 4500);
  return () => clearInterval(t);
}

const HELP = `I'm the Aperture CRM analyst. Ask me anything about the CRM, for example:
- How did today go?
- Who are the hottest leads right now?
- What happened with Brandmela?
- Compare this week with last week
- Which deck leads haven't been followed up?

Commands: /report (today's update now), /reset (forget our chat), /help`;

// One question at a time per chat; extra messages wait their turn.
const busy = new Map();

export async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Founder';
  const chats = await linkedChats();
  const linked = chats.find((c) => c.chat_id === chatId);

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1] || '';
    if (linked) return send(chatId, `You're already linked, ${linked.name}.\n\n${HELP}`);
    if (!LINK_CODE || code !== LINK_CODE) return send(chatId, 'This bot is private. Send /start followed by your access code.');
    if (chats.length >= MAX_CHATS) return send(chatId, 'This bot already has the maximum number of linked accounts.');
    await setState('linked_chats', [...chats, { chat_id: chatId, name, linked_at: new Date().toISOString() }]);
    return send(chatId, `Linked. Hi ${name}, you'll get the daily update at 7:00 pm IST.\n\n${HELP}`);
  }
  if (!linked) return send(chatId, 'This bot is private. Send /start followed by your access code.');
  if (!text) return send(chatId, 'I can only read text messages for now.');
  if (text === '/help') return send(chatId, HELP);
  if (text === '/reset') { await clearMessages(chatId); return send(chatId, 'Done, starting fresh.'); }

  if (busy.get(chatId)) return send(chatId, 'Still working on your last question, one moment.');
  busy.set(chatId, true);
  const stop = typingLoop(chatId);
  try {
    const isReport = text === '/report';
    if (!isReport) await saveMessage(chatId, 'user', text);
    const out = await runAgent(isReport
      ? { task: DIGEST_TASK }
      : { task: 'Answer the founder\'s latest message. Use the CRM tools; your final text is sent to them on Telegram.', chatId, founderName: linked.name });
    stop();
    await send(chatId, out.text);
    await saveMessage(chatId, 'assistant', out.text);
    console.log(`answered ${chatId} in ${out.ms} ms`);
  } catch (e) {
    stop();
    console.error('agent error', e);
    await send(chatId, 'Sorry, I hit a problem reading the CRM. Please ask again in a moment.');
  } finally {
    busy.set(chatId, false);
  }
}

/** Long polling, for an always-on process. */
export async function startPolling() {
  await tg('deleteWebhook').catch(() => {});
  const me = await tg('getMe');
  console.log(`Telegram polling as @${me.username}`);
  let offset = Number(await getState('tg_offset', 0)) || 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
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
