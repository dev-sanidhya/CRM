// The 7 pm IST daily update. Safe to trigger from several places (GitHub Actions, the always-on
// server, /report): it is sent at most once per IST day unless forced.
import { runAgent, DIGEST_TASK, SUNDAY_TASK } from './agent.js';
import { broadcast, hasAudience, people } from './telegram.js';
import { claimState, setState } from './db.js';
import { istParts } from './time.js';

export async function sendDailyUpdate({ force = false } = {}) {
  const day = istParts().date;
  if (!(await hasAudience())) return { skipped: 'no founder has linked the bot yet', day };
  // Claim the day atomically: if Render's scheduler and the GitHub backup fire together, only one sends.
  if (!(await claimState('last_digest_day', day)) && !force) return { skipped: 'already sent today', day };
  try {
    const everyone = (await people()).map((p) => p.name);
    // Sunday: no calling, so a short look-ahead instead of the day's numbers.
    const task = istParts().weekday === 'Sun' ? SUNDAY_TASK : DIGEST_TASK;
    const out = await runAgent({ task, inGroup: true, everyone });
    const sent = await broadcast(out.text);
    return { day, sent, ms: out.ms };
  } catch (e) {
    await setState('last_digest_day', null); // allow a retry
    throw e;
  }
}
