// Optional classifier. Sends the transcript to an LLM. Owner: Fullstack.
import type { Classifier, ClassifierResult, RetellCall } from "@/lib/types";

export const llmClassifier: Classifier = {
  name: "llm",
  async classify(call: RetellCall): Promise<ClassifierResult> {
    // TODO(Fullstack): call the LLM with LLM_API_KEY and a strict JSON schema
    // { status: ok | needs_human | no_answer, summary, flag_reason }. Still treat voicemail as no_answer.
    void call;
    return { status: "ok", summary: "Fake result from llm classifier stub", flag_reason: null };
  },
};
