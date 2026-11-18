// Everything the bot says about time is in IST.
const TZ = 'Asia/Kolkata';

export function istParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
}

export function longNow(d = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

export function clockBlock(d = new Date()) {
  const p = istParts(d);
  const y = istParts(new Date(d.getTime() - 86400000)).date;
  return `# Live clock (trust this)\nNow: ${longNow(d)} IST.\nToday (IST date): ${p.date}. Yesterday: ${y}.\nIST is UTC+05:30.`;
}
