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
  attempted: "Tried",
  contacted: "Spoke",
  qualified: "Interested",
  meeting_booked: "Demo booked",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export const STAGE_STYLES: Record<Stage, string> = {
  new: "bg-sunken text-muted",
  attempted: "bg-sunken text-ink",
  contacted: "bg-amber-soft text-amber",
  qualified: "bg-call-soft text-call",
  meeting_booked: "bg-demo-soft text-demo",
  proposal_sent: "bg-demo-soft text-demo",
  won: "bg-call text-white",
  lost: "bg-lost-soft text-lost",
};
