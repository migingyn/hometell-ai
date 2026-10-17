// Danger words that always mean needs_human. Owner: Fullstack.
// Runs before any classifier. No classifier may downgrade a match.
import type { ClassifierResult } from "@/lib/types";

export const DANGER_WORDS = [
  "chest pain",
  "can't breathe",
  "fell",
  "fall",
  "dizzy",
  "confused",
  "help",
  "emergency",
];

// Returns a needs_human result if the transcript has a danger word, else null.
export function checkHardRules(transcript: string | undefined): ClassifierResult | null {
  // TODO(Fullstack): match DANGER_WORDS in the transcript (case insensitive, handle curly
  // apostrophes in "can't"). Return { status: "needs_human", summary, flag_reason: "said <word>" }.
  void transcript;
  return null;
}
