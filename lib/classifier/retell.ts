import type { Classifier, ClassifierContext, ClassifierResult, RetellCall } from "@/lib/types";
import { checkHardRules } from "./hardRules";
import { withCallerPriority } from "./assessed";

const MISSED_REASONS = ["voicemail_reached", "dial_no_answer", "dial_busy", "dial_failed"];

/** Uses explicit post-call fields; a successful connection alone never establishes wellbeing. */
function classifyAnalysis(call: RetellCall, context: ClassifierContext): ClassifierResult {
  const hard = checkHardRules(call, context.mode);
  if (hard) return hard;
  const summary = call.call_analysis?.call_summary?.trim() || "No verified client update was recorded.";
  if (call.call_analysis?.in_voicemail || MISSED_REASONS.includes(call.disconnection_reason ?? "") ||
      ["not_connected", "error"].includes(call.call_status ?? "")) {
    return { status: "no_answer", summary, flag_reason: null, urgency: null };
  }
  const data = call.call_analysis?.custom_analysis_data ?? {};
  if ((context.target ?? call.metadata?.target) === "emergency_contact") {
    if (data.contact_confirms_ok === true) {
      const contact = context.contactName?.trim() || "emergency contact";
      return { status: "ok", summary: `Confirmed okay by ${contact}: ${summary}`, flag_reason: null, urgency: null };
    }
    return { status: "no_answer", summary, flag_reason: null, urgency: null };
  }
  if (data.client_status === "ok") return { status: "ok", summary, flag_reason: null, urgency: null };
  return {
    status: "needs_human", summary,
    flag_reason: data.client_status === "needs_help"
      ? typeof data.request === "string" && data.request.trim() ? data.request.trim() : "needs help leaving"
      : "unclear call, needs review",
    urgency: context.mode === "daily" ? "follow_up" : "urgent",
  };
}

export function classifyRetellAnalysis(call: RetellCall, context: ClassifierContext = { mode: "crisis" }): ClassifierResult {
  return withCallerPriority(classifyAnalysis(call, context), call, context);
}

export const retellClassifier: Classifier = {
  name: "retell",
  async classify(call, context) { return classifyRetellAnalysis(call, context); },
};
