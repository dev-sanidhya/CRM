export type VoiceExtraction = {
  summary: string;
  call_answered: boolean | null;
  suggested_stage: string | null;
  follow_up_date: string | null; // ISO datetime
  follow_up_note: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
};

const STAGE_VALUES = [
  "new",
  "attempted",
  "contacted",
  "qualified",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
];

export type InferredMapping = {
  business_name: string | null;
  phone: string | null;
  city: string | null;
  website: string | null;
  score: string | null;
  status: string | null;
  follow_up_date: string | null;
};

// Format-agnostic sheet mapping: when a pulled sheet's headers don't match
// any layout we've seen before, ask Groq to map them to our fixed schema
// instead of hard-failing. The result gets cached as a new sheet_layouts row
// keyed by the exact header signature, so the same format is instant and
// free on every future pull — this call only happens once per new format.
export async function inferSheetMapping(
  headers: string[],
  sampleRow: Record<string, string>,
): Promise<InferredMapping | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You map spreadsheet column headers to a fixed CRM schema for a cold-call lead sheet. You will be given the exact list of column headers and one example data row.

Return strict JSON, using ONLY header names that appear EXACTLY in the given list (or null if no column fits):
{
  "business_name": header name for the company/business name, or null,
  "phone": header name for the phone number, or null,
  "city": header name for city/location, or null,
  "website": header name for a website URL, or null,
  "score": header name for a numeric priority/lead score, or null,
  "status": header name for call outcome/disposition/status, or null,
  "follow_up_date": header name for a follow-up/callback date, or null
}

business_name and phone are required — give your best guess for these even if uncertain. Do not invent header names that are not in the given list.`;

  const userPrompt = `Headers: ${JSON.stringify(headers)}

Example row:
${JSON.stringify(sampleRow, null, 2)}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const headerSet = new Set(headers);
  const pick = (key: string): string | null => {
    const v = parsed[key];
    return typeof v === "string" && headerSet.has(v) ? v : null;
  };

  const mapping: InferredMapping = {
    business_name: pick("business_name"),
    phone: pick("phone"),
    city: pick("city"),
    website: pick("website"),
    score: pick("score"),
    status: pick("status"),
    follow_up_date: pick("follow_up_date"),
  };

  if (!mapping.business_name || !mapping.phone) return null;
  return mapping;
}

export async function extractFromTranscript(
  transcript: string,
  context: { businessName: string; city: string | null; currentStage: string },
): Promise<VoiceExtraction> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You extract structured call notes from a sales caller's spoken debrief about a cold-call lead. Today's date is ${today}. Resolve relative day references ("Thursday", "next week", "tomorrow") against today's date.

Return strict JSON matching this shape, nothing else:
{
  "summary": string (1-2 clean sentences summarizing what happened on the call),
  "call_answered": true if the lead picked up and there was a conversation, false if it explicitly says no answer/voicemail/didn't pick up, null if unclear from the transcript,
  "suggested_stage": one of [${STAGE_VALUES.join(", ")}] or null (only set this if the transcript clearly implies the lead's stage changed; otherwise null),
  "follow_up_date": ISO 8601 datetime string or null (only set if a specific future date/day was mentioned for a callback; default to 10:00 local time if no time was given),
  "follow_up_note": short string describing what the follow-up is about, or null (only set alongside follow_up_date),
  "sentiment": one of "positive", "neutral", "negative", or null
}`;

  const userPrompt = `Lead: ${context.businessName}${context.city ? ` (${context.city})` : ""}
Current stage: ${context.currentStage}

Caller's voice note transcript:
"""
${transcript}
"""`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no content.");

  const parsed = JSON.parse(content);
  return {
    summary: String(parsed.summary ?? "").trim(),
    call_answered: typeof parsed.call_answered === "boolean" ? parsed.call_answered : null,
    suggested_stage: STAGE_VALUES.includes(parsed.suggested_stage) ? parsed.suggested_stage : null,
    follow_up_date: parsed.follow_up_date ?? null,
    follow_up_note: parsed.follow_up_note ?? null,
    sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : null,
  };
}
