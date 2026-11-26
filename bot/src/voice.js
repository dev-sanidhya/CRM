// Voice notes: Claude cannot take audio, so Telegram voice notes are turned into text first with
// Whisper on Cloudflare Workers AI (free tier), with Groq Whisper as a backup if it is configured.
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || '';
const CF_TOKEN = process.env.CF_API_TOKEN || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export const MAX_VOICE_SECONDS = 600;
// Helps Whisper spell the words that matter here.
const HINT = 'Jas, Aperture CRM. Leads, follow-up, callback, demo, deck sent, stage, Interested, Diksha, Sanidhya, Atharva.';

export const voiceEnabled = () => Boolean((CF_ACCOUNT && CF_TOKEN) || GROQ_KEY);

/** The voice note, audio file or round video in a Telegram message, if any. */
export function voiceOf(msg) {
  const v = msg.voice || msg.audio || msg.video_note || null;
  if (!v) return null;
  return { fileId: v.file_id, seconds: v.duration || 0, size: v.file_size || 0, name: v.file_name || 'voice.ogg', mime: v.mime_type || 'audio/ogg' };
}

async function download(fileId) {
  const meta = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json());
  if (!meta.ok) throw new Error(meta.description || 'getFile failed');
  const res = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${meta.result.file_path}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function cloudflare(buf) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/openai/whisper-large-v3-turbo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: buf.toString('base64'), initial_prompt: HINT }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`cloudflare whisper: ${data.errors?.[0]?.message || `HTTP ${res.status}`}`);
  return String(data.result?.text || '').trim();
}

async function groq(buf, v) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: v.mime }), v.name.endsWith('.oga') ? 'voice.ogg' : v.name);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('prompt', HINT);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: form, signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`groq whisper: ${data.error?.message || `HTTP ${res.status}`}`);
  return String(data.text || '').trim();
}

/** Download a Telegram voice note and return its text. */
export async function transcribe(v) {
  return transcribeBuffer(await download(v.fileId), v);
}

export async function transcribeBuffer(buf, v) {
  const t0 = Date.now();
  let text = '';
  let via = '';
  if (CF_ACCOUNT && CF_TOKEN) {
    try { text = await cloudflare(buf); via = 'cloudflare'; } catch (e) { console.warn(e.message); }
  }
  if (!text && GROQ_KEY) { text = await groq(buf, v); via = 'groq'; }
  if (!via) throw new Error('voice transcription failed');
  console.log(`transcribed ${v.seconds}s voice via ${via} in ${Date.now() - t0} ms`);
  return text;
}
