import { config, nextActionAt } from "@/lib/config";
import { normalizeMode } from "@/lib/mode";
import { placeCall } from "@/lib/retell";
import { alertCoordinator, sendSms, type SmsResult } from "@/lib/sms";
import type { CallTarget, Check, CheckPatch, Client, ClassifierResult, HeartbeatEvent, LadderStep } from "@/lib/types";

export const LAST_STEP: LadderStep = 4;

export function applyCallResult(check: Check, result: ClassifierResult, target: CallTarget, callId?: string): CheckPatch {
  if (check.status === "handled" || check.handled_at || (callId !== undefined && callId !== check.last_call_id)) return {};
  // A later automated result cannot downgrade an existing danger-word alert.
  if (check.status === "needs_human" && check.urgency === "urgent" && check.flag_reason?.startsWith('said "') &&
      (result.status !== "needs_human" || result.urgency !== "urgent" || !result.flag_reason?.startsWith('said "'))) return {};
  if (result.status === "no_answer" && check.ladder_step >= LAST_STEP) {
    return { status: "needs_human", summary: result.summary, flag_reason: "unreachable", urgency: "urgent", next_action_at: null };
  }
  return {
    status: result.status,
    summary: target === "emergency_contact" && result.status === "ok" && !result.summary.startsWith("Confirmed okay by")
      ? `Confirmed okay by emergency contact: ${result.summary}` : result.summary,
    flag_reason: result.flag_reason,
    urgency: result.status === "needs_human" ? result.urgency ?? "urgent" : null,
    ...(result.priority_assessment ? { priority_assessment: result.priority_assessment } : {}),
    next_action_at: result.status === "no_answer" ? nextActionAt() : null,
  };
}

type LadderDependencies = {
  placeCall?: typeof placeCall;
  sendSms?: typeof sendSms;
  alertCoordinator?: typeof alertCoordinator;
  nextActionAt?: () => string;
};

const unknownSms = (): SmsResult => ({ id: null, status: "failed", note: "text status unknown (SMS request could not be confirmed)" });

/** Call attempts wait for their webhook; SMS failures still advance toward a person. */
export async function runLadderStep(check: Check, client: Client, event?: HeartbeatEvent, deps: LadderDependencies = {}): Promise<CheckPatch> {
  if (check.status !== "no_answer" || check.handled_at || check.ladder_step >= LAST_STEP) return {};
  const step = (check.ladder_step + 1) as LadderStep;
  const schedule = deps.nextActionAt ?? nextActionAt;
  if (step === 1 || step === 3) {
    const target: CallTarget = step === 1 ? "client" : "emergency_contact";
    try {
      const result = await (deps.placeCall ?? placeCall)({ client, checkId: check.id, target, event });
      return { status: "calling", ladder_step: step, last_call_id: result.callId, next_action_at: null,
        summary: step === 1 ? "Retry call requested; awaiting the client's response." : "Emergency-contact call requested; awaiting confirmation." };
    } catch {
      return { status: "no_answer", ladder_step: step, next_action_at: schedule(),
        summary: `${step === 1 ? "Client retry" : "Emergency-contact call"} could not be confirmed. Follow-up remains open.` };
    }
  }
  if (step === 2) {
    const contact = config.coordinatorPhone ? `${config.agencyName} at ${config.coordinatorPhone}` : `${config.agencyName} using your usual agency contact number`;
    const message = normalizeMode(event?.type) === "daily"
      ? `We missed you at your check-in. Please call ${contact}.`
      : `${event?.alert_text?.trim() ? `${event.alert_text}\n\n` : ""}We couldn't reach you by phone. Call ${contact} if you need help.`;
    const sms = await (deps.sendSms ?? sendSms)(client.phone, message).catch(unknownSms);
    return { status: "no_answer", ladder_step: step, next_action_at: schedule(), sms_status: sms.note,
      summary: `Client text step: ${sms.note}. The check is still unanswered.` };
  }
  const sms = await (deps.alertCoordinator ?? alertCoordinator)(client, "unreachable after client retry, client text, and emergency-contact attempt").catch(unknownSms);
  return { status: "needs_human", ladder_step: LAST_STEP, next_action_at: null, flag_reason: "unreachable", urgency: "urgent",
    summary: "No response after the retry, text, and emergency-contact attempt. A person must follow up.", sms_status: sms.note };
}
