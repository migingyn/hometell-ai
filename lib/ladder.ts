// No-pickup ladder and call result rules. Owner: Fullstack.
//
// Step | Action                         | Delay after previous
// 1    | Retry call to client           | 5 min
// 2    | Send SMS to client             | 5 min
// 3    | Call emergency contact         | 5 min
// 4    | Flag needs_human "unreachable" | 5 min
import { nextActionAt } from "@/lib/config";
import type { CallTarget, Check, CheckPatch, Client, ClassifierResult, LadderStep } from "@/lib/types";

export const LAST_STEP: LadderStep = 4;

// Turns a classified call into a check update. Called by the Retell webhook.
export function applyCallResult(check: Check, result: ClassifierResult, target: CallTarget): CheckPatch {
  // TODO(Fullstack): real rules.
  // - Client answered at any step: ok or needs_human, clear next_action_at.
  // - Emergency contact says client is okay: ok with their summary.
  // - Emergency contact did not answer: stay no_answer, keep climbing.
  // - A missed call never becomes ok without a human or emergency contact confirming.
  void target;
  return {
    status: result.status,
    summary: result.summary,
    flag_reason: result.flag_reason,
    next_action_at: result.status === "no_answer" && check.ladder_step < LAST_STEP ? nextActionAt() : null,
  };
}

// Runs the next ladder step for a no_answer check and returns the update to save.
// Called by /api/ladder/tick (when due) and /api/ladder/advance (right away).
export async function runLadderStep(check: Check, client: Client): Promise<CheckPatch> {
  // TODO(Fullstack): do the real action for each step.
  // 1 placeCall(client), 2 sendSms(client.phone), 3 placeCall(emergency_contact),
  // 4 status needs_human, flag_reason "unreachable", alertCoordinator.
  // Save the new last_call_id when a step places a call.
  void client;
  if (check.ladder_step >= LAST_STEP) return {};
  const step = (check.ladder_step + 1) as LadderStep;
  return {
    ladder_step: step,
    summary: `Fake ladder step ${step}`,
    next_action_at: step < LAST_STEP ? nextActionAt() : null,
  };
}
