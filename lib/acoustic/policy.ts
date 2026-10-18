import type { CallerAssessment } from "@/lib/types";
import type { AcousticAnalysis } from "./types";

const RANK = { follow_up: 1, review: 2, urgent: 3, immediate: 4 } as const;
const PREFIX = "Acoustic expression:";

function higher(a: CallerAssessment["priority"], b: CallerAssessment["priority"]): CallerAssessment["priority"] {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Expression is additional operator evidence; it never establishes panic or safety. */
export function combineAcousticPriority(priority: CallerAssessment, analysis: AcousticAnalysis): CallerAssessment {
  const floor = priority.situation === "immediate_danger" ? "immediate" : priority.priority;
  const preserved = higher(priority.priority, floor);
  // A missing recording or failed analyzer provides no new evidence and cannot
  // erase a previous available signal or an existing human-review priority.
  if (analysis.status !== "available") {
    return { ...priority, priority: preserved, evidence: [...priority.evidence], reasons: [...priority.reasons] };
  }

  const elevated = analysis.signal === "elevated";
  const suggested = elevated && preserved === "follow_up" ? "review" : preserved;
  const nextPriority = higher(preserved, suggested);
  const reason = elevated
    ? `${PREFIX} the recording model detected an elevated speech-expression signal. Review sooner within the same reported-severity tier; this is not a determination of panic or safety.`
    : `${PREFIX} the recording model's expression signal is uncertain. Existing review priority is retained; this does not establish distress or safety.`;
  const reasons = priority.reasons.filter((item) => !item.startsWith(PREFIX) && !item.startsWith("Audible distress is unavailable:"));
  return {
    ...priority,
    priority: nextPriority,
    audible_distress: analysis.signal,
    evidence: [...priority.evidence],
    reasons: [...reasons, reason],
  };
}
