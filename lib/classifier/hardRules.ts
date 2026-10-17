import type { ClassifierResult, EventMode, RetellCall } from "@/lib/types";

const SHARED_WORDS = ["chest pain", "can't breathe", "fell", "fall", "dizzy", "confused", "emergency"];
const CRISIS_WORDS = ["help", "can't get out", "can't leave", "trapped"];
export const DANGER_WORDS = [...SHARED_WORDS, ...CRISIS_WORDS];

/** Untagged transcripts cannot establish who said a word. Never scan agent speech. */
function userTurns(input: RetellCall | string | undefined): string[] {
  if (typeof input === "object" && input !== null && Array.isArray(input.transcript_object)) {
    return input.transcript_object.filter((turn) => turn.role === "user" && typeof turn.content === "string").map((turn) => turn.content);
  }
  const transcript = typeof input === "string" ? input : input?.transcript;
  if (!transcript) return [];
  const turns: string[] = [];
  let isUser = false;
  for (const line of transcript.split(/\r?\n/)) {
    const tagged = /^\s*([A-Za-z][A-Za-z _-]*):\s*(.*)$/.exec(line);
    if (tagged) {
      isUser = tagged[1].trim().toLowerCase() === "user";
      if (isUser) turns.push(tagged[2]);
    } else if (isUser && turns.length) {
      turns[turns.length - 1] += ` ${line.trim()}`;
    }
  }
  return turns;
}

export function checkHardRules(input: RetellCall | string | undefined, mode: EventMode = "crisis"): ClassifierResult | null {
  const turns = userTurns(input).map((turn) => turn.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase());
  for (const word of mode === "daily" ? SHARED_WORDS : DANGER_WORDS) {
    const phrase = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const pattern = new RegExp(`\\b${phrase}\\b`, "i");
    if (turns.some((turn) => pattern.test(turn))) {
      return {
        status: "needs_human", urgency: "urgent", flag_reason: `said "${word}"`,
        summary: typeof input === "object" && input?.call_analysis?.call_summary?.trim()
          ? input.call_analysis.call_summary.trim()
          : `Caller said "${word}". A person needs to follow up.`,
      };
    }
  }
  return null;
}
