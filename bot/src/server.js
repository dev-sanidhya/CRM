// Entry point.
//   BOT_MODE=polling  (default): always-on process, long polling (a Mac, or any always-on host)
//   BOT_MODE=webhook : for hosts that sleep (Render free). Telegram wakes the service by calling
//                      POST /telegram/<BOT_WEBHOOK_SECRET>; set PUBLIC_URL so the webhook is registered.
// BOT_SCHEDULER=1 also sends the 7 pm update from this process (not needed when GitHub Actions does it).
import http from 'node:http';
import { handleUpdate, startPolling, tg } from './telegram.js';
import { sendDailyUpdate } from './digest.js';
import { istParts } from './time.js';

const PORT = Number(process.env.PORT || 3400);
const MODE = process.env.BOT_MODE || 'polling';
const SECRET = process.env.BOT_WEBHOOK_SECRET || '';
const DIGEST_HOUR = Number(process.env.BOT_DIGEST_HOUR || 19);

for (const k of ['TELEGRAM_BOT_TOKEN', 'BOT_DB_PASSWORD', 'BOT_FOUNDERS']) {
  if (!process.env[k]) console.warn(`warning: ${k} is not set`);
}
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) console.warn('warning: no Claude credentials (CLAUDE_CODE_OAUTH_TOKEN)');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, mode: MODE, at: new Date().toISOString() }));
  }
  if (req.method === 'POST' && SECRET && url.pathname === `/telegram/${SECRET}`) {
    let body = '';
    req.on('data', (c) => { if (body.length < 1e6) body += c; });
    req.on('end', () => {
      res.writeHead(200); res.end('ok'); // answer Telegram at once, work afterwards
      try { handleUpdate(JSON.parse(body)).catch((e) => console.error('update failed', e)); } catch { /* bad json */ }
    });
    return;
  }
  if (req.method === 'POST' && SECRET && url.pathname === `/digest/${SECRET}`) {
    res.writeHead(202); res.end('started');
    sendDailyUpdate().then((r) => console.log('digest', r)).catch((e) => console.error('digest failed', e));
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, async () => {
  console.log(`CRM bot listening on :${PORT} (${MODE})`);
  if (MODE === 'webhook') {
    if (process.env.PUBLIC_URL && SECRET) {
      await tg('setWebhook', { url: `${process.env.PUBLIC_URL.replace(/\/$/, '')}/telegram/${SECRET}`, allowed_updates: ['message'] })
        .then(() => console.log('Telegram webhook set'))
        .catch((e) => console.error('setWebhook failed', e.message));
    }
  } else {
    startPolling();
  }
  if (process.env.BOT_SCHEDULER === '1') {
    // Checks every minute from 7 pm IST; sends once per day (a failed send retries next minute).
    let running = false;
    setInterval(() => {
      const p = istParts();
      if (running || p.hour < DIGEST_HOUR || p.hour >= 23) return;
      running = true;
      sendDailyUpdate()
        .then((r) => { if (!r.skipped) console.log('daily update sent', r); })
        .catch((e) => console.error('daily update failed, will retry', e))
        .finally(() => { running = false; });
    }, 60000);
    console.log(`daily update scheduler on: ${DIGEST_HOUR}:00 IST`);
  }
});
