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
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return digits ? `+${digits}` : "";
}

export function headerSignature(headers: string[]): string {
  return headers.join("|");
}
