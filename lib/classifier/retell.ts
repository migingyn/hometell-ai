// Default classifier. Uses Retell post-call analysis. Owner: Fullstack.
import type { Classifier, ClassifierResult, RetellCall } from "@/lib/types";

export const retellClassifier: Classifier = {
  name: "retell",
  async classify(call: RetellCall): Promise<ClassifierResult> {
    // TODO(Fullstack): voicemail (call_analysis.in_voicemail or disconnection_reason
    // voicemail_reached) and dial_no_answer / dial_busy / dial_failed -> no_answer.
    // Use call_analysis custom fields to pick ok or needs_human. Summary from call_summary.
    void call;
    return { status: "ok", summary: "Fake result from retell classifier stub", flag_reason: null };
  },
};
