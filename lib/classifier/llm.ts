import type { Classifier } from "@/lib/types";
import { classifyRetellAnalysis } from "./retell";

// The optional LLM selector uses Retell's existing model-generated, structured
// post-call analysis. It never guesses wellbeing from free text or requires an
// additional model provider on the check-in path.
export const llmClassifier: Classifier = {
  name: "llm",
  async classify(call, context) { return classifyRetellAnalysis(call, context); },
};
