// Local check of the write tools: node --env-file=.env scripts/try-write.js "request" [Speaker]
import { runAgent } from '../src/agent.js';
import { sql } from '../src/db.js';

const out = await runAgent({ task: process.argv[2], speaker: process.argv[3] || 'Sanidhya' });
console.log(out.text);
console.log(`(${out.ms} ms, cost ${out.cost})`);
await sql.end();
