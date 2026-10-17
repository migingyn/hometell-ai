import type { ClassifierResult, EventMode, RetellCall } from "@/lib/types";

const SHARED_WORDS = ["chest pain", "can't breathe", "fell", "fall", "dizzy", "confused", "emergency"];
const CRISIS_WORDS = ["help", "can't get out", "can't leave", "trapped"];
export const DANGER_WORDS = [...SHARED_WORDS, ...CRISIS_WORDS];
// Literal Korean phrase stems supplied for the Korean check-in agent. Hangul
// does not use JavaScript's ASCII word boundaries; retain the matched phrase
// rather than inventing an English translation in the caller's evidence.
const SHARED_KOREAN_PHRASES = ["흉통", "가슴 통증", "가슴이 아파", "숨을 못 쉬", "숨을 못쉬", "숨이 안 쉬", "넘어졌", "어지러", "어지럽", "혼란", "응급"];
const CRISIS_KOREAN_PHRASES = ["도와주", "도움이 필요", "나갈 수 없", "못 나가", "갇혔"];

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
  const hit = (phrase: string): ClassifierResult => ({
    status: "needs_human", urgency: "urgent", flag_reason: `said "${phrase}"`,
    summary: typeof input === "object" && input?.call_analysis?.call_summary?.trim()
      ? input.call_analysis.call_summary.trim()
      : `Caller said "${phrase}". A person needs to follow up.`,
  });
  for (const word of mode === "daily" ? SHARED_WORDS : DANGER_WORDS) {
    const phrase = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const pattern = new RegExp(`\\b${phrase}\\b`, "i");
    if (turns.some((turn) => pattern.test(turn))) {
      return hit(word);
    }
  }
  const koreanPhrases = mode === "daily" ? SHARED_KOREAN_PHRASES : [...SHARED_KOREAN_PHRASES, ...CRISIS_KOREAN_PHRASES];
  for (const phrase of koreanPhrases) {
    if (turns.some((turn) => turn.includes(phrase))) return hit(phrase);
  }
  return null;
}
