export type VoiceExtraction = {
  summary: string;
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
    suggested_stage: STAGE_VALUES.includes(parsed.suggested_stage) ? parsed.suggested_stage : null,
    follow_up_date: parsed.follow_up_date ?? null,
    follow_up_note: parsed.follow_up_note ?? null,
    sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : null,
  };
}
