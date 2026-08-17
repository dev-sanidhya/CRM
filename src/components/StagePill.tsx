import { STAGE_LABELS, STAGE_STYLES, type Stage } from "@/lib/stages";

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLES[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
