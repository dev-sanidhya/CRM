// One-shot: send today's update to the linked founders, then exit. Used by the GitHub Actions
// schedule (7 pm IST). `--force` sends even if today's update already went out.
import { sendDailyUpdate } from '../src/digest.js';
import { sql } from '../src/db.js';

const force = process.argv.includes('--force');

// GitHub's scheduler starts a few minutes early or late. If it starts before 7 pm IST, wait for 7.
const { istParts } = await import('../src/time.js');
const p = istParts();
const hour = Number(process.env.BOT_DIGEST_HOUR || 19);
if (!force && p.hour === hour - 1 && p.minute >= 40) {
  const waitMs = (60 - p.minute) * 60000;
  console.log(`waiting ${Math.round(waitMs / 60000)} min for ${hour}:00 IST`);
  await new Promise((r) => setTimeout(r, waitMs));
}
try {
  const r = await sendDailyUpdate({ force });
  console.log(JSON.stringify(r));
} catch (e) {
  console.error('daily update failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
