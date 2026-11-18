// Database access as the `crm_bot` Postgres role: every CRM table is read-only (the role only has
// SELECT and its transactions default to read only). The bot's own memory (bot_state, bot_messages)
// is the only thing it can write, through an explicit read-write transaction.
import postgres from 'postgres';

export const sql = postgres({
  host: process.env.BOT_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: Number(process.env.BOT_DB_PORT || 6543),
  database: 'postgres',
  username: process.env.BOT_DB_USER || 'crm_bot.rkkhxquriakwtzeylhar',
  password: process.env.BOT_DB_PASSWORD,
  ssl: 'require',
  prepare: false, // transaction pooler
  max: 4,
  idle_timeout: 30,
  connect_timeout: 15,
});

/** Run read-only SQL. Rejects anything that is not a single SELECT / WITH statement. */
export async function readOnlyQuery(text, limit = 200) {
  const q = String(text || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(q)) throw new Error('Only SELECT / WITH queries are allowed.');
  if (q.includes(';')) throw new Error('One statement at a time.');
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return sql.begin('read only', async (tx) => tx.unsafe(`select * from (${q}) as q limit ${capped}`));
}

// ---- the bot's own memory ----

export async function getState(key, fallback = null) {
  const r = await sql`select value from bot_state where key = ${key}`;
  return r.length ? r[0].value : fallback;
}

export async function setState(key, value) {
  await sql.begin('read write', (tx) => tx`
    insert into bot_state (key, value, updated_at) values (${key}, ${tx.json(value)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
}

export async function saveMessage(chatId, role, text) {
  await sql.begin('read write', (tx) => tx`insert into bot_messages (chat_id, role, text) values (${chatId}, ${role}, ${text})`);
}

export async function recentMessages(chatId, n = 16) {
  const rows = await sql`select role, text, at from bot_messages where chat_id = ${chatId} order by id desc limit ${n}`;
  return rows.reverse();
}

export async function clearMessages(chatId) {
  await sql.begin('read write', (tx) => tx`delete from bot_messages where chat_id = ${chatId}`);
}
