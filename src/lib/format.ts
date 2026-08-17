// Fixed locale + timezone so server-rendered and client-rendered dates
// always match — using the runtime default (`undefined`) causes a
// hydration mismatch whenever the server and browser environments differ.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}
