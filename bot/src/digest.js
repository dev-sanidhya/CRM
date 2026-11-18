// The 7 pm IST daily update. Safe to trigger from several places (GitHub Actions, the always-on
// server, /report): it is sent at most once per IST day unless forced.
import { runAgent, DIGEST_TASK } from './agent.js';
import { broadcast, hasAudience, people } from './telegram.js';
import { getState, setState } from './db.js';
import { istParts } from './time.js';

export async function sendDailyUpdate({ force = false } = {}) {
  const day = istParts().date;
  if (!force && (await getState('last_digest_day')) === day) return { skipped: 'already sent today', day };
  if (!(await hasAudience())) return { skipped: 'no founder has linked the bot yet', day };
  // Claim the day first so two triggers firing together do not both send.
  await setState('last_digest_day', day);
  try {
    const everyone = (await people()).map((p) => p.name);
    const out = await runAgent({ task: DIGEST_TASK, inGroup: true, everyone });
    const sent = await broadcast(out.text);
    return { day, sent, ms: out.ms };
  } catch (e) {
    await setState('last_digest_day', null); // allow a retry
    throw e;
  }
}
