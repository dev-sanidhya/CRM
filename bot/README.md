# Aperture CRM bot (Telegram)

A Telegram analyst for the CRM, built on the Claude Agent SDK (same pattern as Maddie PA).
Founders ask it anything about the CRM; it sends a daily update at 7:00 pm IST (Mon to Sat).

- Reads the CRM through the Postgres role `crm_bot`: SELECT only, read-only transactions, 20 s timeout.
  It can write only its own memory (`bot_state`, `bot_messages`).
- Tools: `day_overview`, `day_activity`, `lead_signals`, `find_lead`, `run_sql` (read-only), `get_time`.
- Knowledge: `agent/AGENT.md` (business, schema, outcomes, conversion signals, daily update format). Edit freely.
- Access: each founder has their own code (`BOT_FOUNDERS`) and sends `/start <code>` once; the bot then knows who is
  speaking in private chats and groups and addresses them as Boss / Sir / name. Add the bot to the founders' group (a
  linked founder must add it): it answers when @mentioned or replied to, ignores everyone else, and the 7 pm update goes
  to the group. Turn off privacy mode in @BotFather (/setprivacy) or make the bot a group admin so it sees @mentions.
  Commands: `/report`, `/reset`, `/help`.

## Free hosting
- 7 pm update: GitHub Actions (`.github/workflows/daily-update.yml`), free for this public repo.
  Repo secrets: `CLAUDE_CODE_OAUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `BOT_DB_PASSWORD`, `BOT_FOUNDERS`.
- Chat: Render free web service (`render.yaml`, root `bot/`, `BOT_MODE=webhook`). Kept awake by a Supabase pg_cron job
  that pings `/health` every 5 minutes (`supabase/migrations/20261119140000_keep_bot_awake.sql`); without it, the first
  message after a quiet spell takes about a minute while it wakes. Peak memory per answer measured at ~360 MB.
- Or on any always-on machine: `npm start` with `BOT_MODE=polling`.

## Local
```bash
cp .env.example .env   # fill in
npm install
npm run ask -- "How did yesterday go?"
npm run ask -- --report
npm start
```
