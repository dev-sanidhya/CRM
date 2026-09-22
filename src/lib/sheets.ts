export function parseSheetUrl(url: string): { sheetId: string; gid: string | null } {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error("That doesn't look like a Google Sheets link.");
  const gidMatch = url.match(/[#&]gid=(\d+)/);
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

export function buildExportUrl(sheetId: string, gid: string | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  // A cell sometimes holds more than one number (e.g. "+91 76888 34111 /
  // +91 82336 88000" for a primary + alternate contact) — take the first
  // one rather than stripping non-digits across the whole cell, which
  // would mash both numbers into one unusably long, undialable string.
  const firstSegment = trimmed.split(/[/,;]| or /i)[0].trim();
  const hasPlus = firstSegment.startsWith("+");
  const digits = firstSegment.replace(/\D/g, "");
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return digits ? `+${digits}` : "";
}

export function headerSignature(headers: string[]): string {
  return headers.join("|");
}
