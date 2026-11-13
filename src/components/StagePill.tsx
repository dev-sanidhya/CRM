import { STAGE_LABELS, STAGE_STYLES, type Stage } from "@/lib/stages";

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[stage] ?? "bg-sunken text-muted"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
