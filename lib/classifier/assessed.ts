import type { ClassifierContext, ClassifierResult, RetellCall } from "@/lib/types";
import { assessCallerPriority } from "./priority";

/** Priority may raise review urgency; it cannot clear an existing danger rule. */
export function withCallerPriority(result: ClassifierResult, call: RetellCall, context: ClassifierContext): ClassifierResult {
  const assessment = assessCallerPriority(call, context);
  if (result.status === "needs_human" && result.urgency === "urgent" &&
      !["immediate", "urgent"].includes(assessment.priority)) {
    assessment.priority = "urgent";
    assessment.reasons.push("The existing concern or danger rule still requires urgent human review.");
  }
  if (["immediate", "urgent"].includes(assessment.priority)) {
    return { ...result, status: "needs_human", urgency: "urgent",
      flag_reason: result.flag_reason || assessment.reasons[0] || "Caller report requires operator review",
      priority_assessment: assessment };
  }
  if (assessment.distress === "high" && result.status === "ok") {
    return { ...result, status: "needs_human", urgency: "follow_up",
      flag_reason: "The caller reports distress; a person should review the conversation.",
      priority_assessment: assessment };
  }
  return { ...result, priority_assessment: assessment };
}
