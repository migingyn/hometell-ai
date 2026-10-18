import type { CheckWithClient, EventMode, RiskTier } from "./types";

const TIERS: Record<RiskTier, number> = { red: 0, yellow: 1, green: 2 };
const PRIORITIES = { immediate: 0, urgent: 1, follow_up: 2, review: 2 } as const;
const SEVERITY = { immediate_danger: 0, needs_assistance: 1, unknown: 2, routine: 3 } as const;
const DISTRESS = { high: 0, moderate: 1, unknown: 2 } as const;

function severityRank(check: CheckWithClient): number {
  const assessment = check.priority_assessment;
  // Retain earlier urgent evidence when the precise situation was not assessed.
  if (!assessment || assessment.situation === "unknown") {
    return assessment?.priority === "immediate" ? 0 : check.urgency === "urgent" ? 1 : 2;
  }
  return SEVERITY[assessment.situation];
}

function distressRank(check: CheckWithClient): number {
  const text = DISTRESS[check.priority_assessment?.distress ?? "unknown"];
  const acoustic = check.acoustic_assessment?.call_id === check.last_call_id &&
    check.acoustic_assessment.result.status === "available" && check.acoustic_assessment.result.signal === "elevated";
  // A validated current-call audio signal is additional context, not a severity tier.
  return Math.min(text, acoustic ? 1 : 2);
}

function statusRank(check: CheckWithClient, mode: EventMode): number {
  if (check.status === "needs_human") return mode === "crisis" || check.urgency === "urgent" ? 0 : 1;
  return { no_answer: 2, calling: 3, queued: 4, ok: 5, handled: 6 }[check.status];
}

/** Preserve existing handoff buckets; suggestions refine only the human queue. */
export function sortChecksForDashboard(checks: readonly CheckWithClient[], mode: EventMode): CheckWithClient[] {
  return [...checks].sort((a, b) => {
    if (a.status === "needs_human" && b.status === "needs_human" && (a.priority_assessment || b.priority_assessment)) {
      const severity = severityRank(a) - severityRank(b);
      if (severity) return severity;
      const distress = distressRank(a) - distressRank(b);
      if (distress) return distress;
    }
    const bucket = statusRank(a, mode) - statusRank(b, mode);
    if (bucket) return bucket;

    if (a.status === "needs_human" && b.status === "needs_human") {
      // An unassessed concern is not evidence of low urgency. Keep it alongside
      // urgent suggestions rather than demoting it behind routine requests.
      const priority = (PRIORITIES[a.priority_assessment?.priority ?? "urgent"] ?? 1) -
        (PRIORITIES[b.priority_assessment?.priority ?? "urgent"] ?? 1);
      if (priority) return priority;
    }

    return TIERS[a.client.risk_tier] - TIERS[b.client.risk_tier] || a.client.name.localeCompare(b.client.name);
  });
}
