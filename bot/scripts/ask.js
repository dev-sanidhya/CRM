// Ask the agent a question from the terminal (no Telegram), e.g.
//   npm run ask -- "How did yesterday go?"
//   npm run ask -- --report
import { runAgent, DIGEST_TASK } from '../src/agent.js';
import { sql } from '../src/db.js';

const args = process.argv.slice(2);
const task = args.includes('--report') ? DIGEST_TASK : args.join(' ');
if (!task) { console.error('Usage: npm run ask -- "your question"'); process.exit(1); }
try {
  const out = await runAgent({ task: args.includes('--report') ? task : `The founder asks: ${task}` });
  console.log(out.text);
  console.error(`\n(${(out.ms / 1000).toFixed(1)} s${out.cost != null ? `, ~$${out.cost.toFixed(3)} at API rates` : ''})`);
} finally {
  await sql.end({ timeout: 5 });
}
