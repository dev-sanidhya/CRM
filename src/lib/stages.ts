export const STAGES = [
  "new",
  "attempted",
  "contacted",
  "qualified",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  attempted: "Attempted",
  contacted: "Contacted",
  qualified: "Qualified",
  meeting_booked: "Meeting Booked",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost",
};

export const STAGE_STYLES: Record<Stage, string> = {
  new: "bg-zinc-100 text-zinc-700",
  attempted: "bg-amber-50 text-amber-700",
  contacted: "bg-blue-50 text-blue-700",
  qualified: "bg-indigo-50 text-indigo-700",
  meeting_booked: "bg-violet-50 text-violet-700",
  proposal_sent: "bg-purple-50 text-purple-700",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-red-50 text-red-700",
};
