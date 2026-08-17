const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Start of "today" in IST, as a UTC ISO string — used to bucket
// today-vs-all-time stats consistently with the rest of the app's Asia/Kolkata
// date formatting (see lib/format.ts). Pure epoch arithmetic, so it's correct
// regardless of the server process's own local timezone.
export function startOfTodayIST(): string {
  const shifted = Date.now() + IST_OFFSET_MS;
  const shiftedStartOfDay = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(shiftedStartOfDay - IST_OFFSET_MS).toISOString();
}
