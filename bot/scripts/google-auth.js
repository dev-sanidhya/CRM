// One-time Google sign-in for the agency calendar. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// (an OAuth client of type "Desktop app") in .env. Run: node --env-file=.env scripts/google-auth.js
// Open the printed link, sign in as the agency account, allow access; the refresh token is saved
// to .env as GOOGLE_REFRESH_TOKEN (never printed).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = process.env.GOOGLE_CLIENT_ID;
const SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!ID || !SECRET) { console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.'); process.exit(1); }

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', login_hint: process.env.GOOGLE_ACCOUNT || '',
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const code = u.searchParams.get('code');
  if (!code) { res.end(`Sign-in failed: ${u.searchParams.get('error') || 'no code'}`); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: ID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const data = await r.json();
  if (!data.refresh_token) { res.end('No refresh token came back. Try again.'); console.error('token exchange failed:', data.error || r.status); process.exit(1); }
  let env = fs.readFileSync(ENV, 'utf8');
  env = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(env)
    ? env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${data.refresh_token}`)
    : `${env.trimEnd()}\nGOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`;
  fs.writeFileSync(ENV, env);
  res.end('Calendar connected. You can close this tab.');
  console.log(`Saved GOOGLE_REFRESH_TOKEN to .env (scope: ${data.scope}).`);
  server.close();
});
server.listen(PORT, '127.0.0.1', () => console.log(`Open this link and sign in as the agency account:\n\n${url}\n`));
