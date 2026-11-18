// The agent: one Claude Agent SDK run per question (or per daily update). Context = AGENT.md +
// live clock + who is who, plus the recent Telegram conversation with this founder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { crmTools } from './tools.js';
import { clockBlock } from './time.js';
import { sql, recentMessages } from './db.js';

const MODEL = process.env.BOT_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.BOT_AGENT_TIMEOUT_MS || 240000);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_MD = fs.readFileSync(path.join(ROOT, 'agent', 'AGENT.md'), 'utf8');

async function peopleBlock() {
  const [people, lists] = await Promise.all([
    sql`select id, name, role from profiles order by role, name`,
    sql`select key, label from lead_categories order by sort`,
  ]);
  return `# People (profiles)\n${people.map((p) => `- ${p.name} (${p.role}) id=${p.id}`).join('\n')}\n\n# Lists\n${lists.map((l) => `- ${l.key} = ${l.label}`).join('\n')}`;
}

function conversationBlock({ speaker, inGroup, everyone }) {
  const where = inGroup
    ? `a Telegram group with the founders (${everyone.join(' and ') || 'the founders'}). Several people talk here; each founder line in the history is tagged with who said it.`
    : 'a private Telegram chat.';
  return `\n\n# This conversation\nYou are in ${where}${speaker ? `\nThe message you are answering is from ${speaker}.` : ''}\nHow to address the founders: they are your bosses. Address them only as "Boss" or "Sir" (e.g. "Sure Boss", "Sir, here's ..."). Never address or greet them by their names. Vary it naturally; do not use it in every line. In the group your reply is attached to the message you are answering, so there is no need to say whom you are answering. For the daily update to the group, greet them together without names (e.g. "Good evening, Sir" or "Good evening, Bosses").`;
}

/** Plain text for Telegram: drop markdown the model may slip in. */
export const plain = (t) => String(t || '')
  .replace(/\*\*(.+?)\*\*/gs, '$1').replace(/__(.+?)__/gs, '$1').replace(/`+/g, '')
  .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[*•]\s+/gm, '- ').replace(/—/g, ' - ').replace(/–/g, '-').trim();

export async function runAgent({ task, chatId = null, speaker = null, inGroup = false, everyone = [] }) {
  const tools = crmTools();
  const server = createSdkMcpServer({ name: 'crm', version: '1.0.0', tools });
  const system = [AGENT_MD, '\n\n', clockBlock(), '\n\n', await peopleBlock(),
    conversationBlock({ speaker, inGroup, everyone })].join('');

  let history = '';
  if (chatId) {
    const rows = await recentMessages(chatId, 16);
    // Founder messages are stored as "[Name] text", so the speaker of each line is known.
    history = rows.map((r) => (r.role === 'user' ? r.text : `[You] ${r.text}`)).join('\n');
  }
  const prompt = history
    ? `Recent conversation (oldest first):\n${history}\n\n${task}`
    : task;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let final = '';
  let cost = null;
  const t0 = Date.now();
  try {
    for await (const m of query({
      prompt,
      options: {
        systemPrompt: system,
        model: MODEL,
        mcpServers: { crm: server },
        tools: [], // no built-in file/shell/web tools: CRM tools only
        allowedTools: tools.map((t) => `mcp__crm__${t.name}`),
        maxTurns: 30,
        persistSession: false,
        settingSources: [],
        abortController: ctrl,
      },
    })) {
      if (m.type === 'result') {
        cost = m.total_cost_usd ?? null;
        if (m.subtype === 'success') final = m.result || '';
        else throw new Error(`agent run ended: ${m.subtype}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { text: plain(final), ms: Date.now() - t0, cost };
}

export const SUNDAY_TASK = 'Write this Sunday\'s update for the founders now, following the "Sunday update" section: only upcoming follow-ups, demos and important items for the coming days. Use the CRM tools (run_sql for the next days, lead_signals, day_overview for context). Reply with only the update text.';

export const DIGEST_TASK = 'Write today\'s daily update for the founders now, following the "Daily update" section. Use day_overview for today first, then lead_signals and day_activity as needed. Reply with only the update text.';
