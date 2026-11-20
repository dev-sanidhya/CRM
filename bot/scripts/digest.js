// One-shot: send today's update to the linked founders, then exit. Used by the GitHub Actions
// schedule (7 pm IST). `--force` sends even if today's update already went out.
import { sendDailyUpdate } from '../src/digest.js';
import { sql } from '../src/db.js';

const force = process.argv.includes('--force');

// Sends only inside the 7 pm to 11 pm IST window (enforced in sendDailyUpdate), so a late GitHub run is harmless.
try {
  const r = await sendDailyUpdate({ force });
  console.log(JSON.stringify(r));
} catch (e) {
  console.error('daily update failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
