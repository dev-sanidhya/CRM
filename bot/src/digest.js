// The 7 pm IST daily update. Safe to trigger from several places (GitHub Actions, the always-on
// server, /report): it is sent at most once per IST day unless forced.
import { runAgent, DIGEST_TASK, SUNDAY_TASK } from './agent.js';
import { broadcast, hasAudience, people } from './telegram.js';
import { claimState, setState } from './db.js';
import { istParts } from './time.js';

// The update only ever goes out in the evening window, whoever triggers it. GitHub's scheduler can
// start a job hours late (it once ran the 7 pm backup at 3 am); outside the window it does nothing.
const WINDOW_START = Number(process.env.BOT_DIGEST_HOUR || 19);
const WINDOW_END = 23;

export async function sendDailyUpdate({ force = false } = {}) {
  const now = istParts();
  const day = now.date;
  if (!force && (now.hour < WINDOW_START || now.hour >= WINDOW_END)) {
    return { skipped: `outside the ${WINDOW_START}:00-${WINDOW_END}:00 IST window (now ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')})`, day };
  }
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
