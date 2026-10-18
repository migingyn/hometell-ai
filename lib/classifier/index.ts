// Picks the classifier and enforces hard rules first. Owner: Fullstack.
import { config } from "@/lib/config";
import type { Classifier, ClassifierContext, ClassifierResult, RetellCall } from "@/lib/types";
import { checkHardRules } from "./hardRules";
import { llmClassifier } from "./llm";
import { retellClassifier } from "./retell";
import { withCallerPriority } from "./assessed";

export function getClassifier(): Classifier {
  return config.classifier === "llm" ? llmClassifier : retellClassifier;
}

export async function classifyCall(call: RetellCall, context: ClassifierContext = { mode: "crisis" }): Promise<ClassifierResult> {
  // Hard rules always run first, even in mock mode.
  const hard = checkHardRules(call, context.mode);
  if (hard) return withCallerPriority(hard, call, context);

  // Mock mode: scripts/fake-webhook.ts can force the outcome.
  const forced = call.metadata?.mock_outcome;
  if (config.mockRetell && forced && ["ok", "needs_human", "no_answer"].includes(forced)) {
    return withCallerPriority({
      status: forced,
      summary: call.call_analysis?.call_summary ?? `Mock ${forced}`,
      flag_reason: forced === "needs_human" ? "simulated follow-up request" : null,
      urgency: forced === "needs_human" ? context.mode === "daily" ? "follow_up" : "urgent" : null,
    }, call, context);
  }

  return getClassifier().classify(call, context);
}
