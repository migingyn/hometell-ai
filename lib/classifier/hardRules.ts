import type { ClassifierResult, EventMode, RetellCall } from "@/lib/types";
import { callerUtterances } from "./priority";

const SHARED_WORDS = ["chest pain", "can't breathe", "fell", "fall", "dizzy", "confused", "emergency"];
const CRISIS_WORDS = ["help", "can't get out", "can't leave", "trapped"];
export const DANGER_WORDS = [...SHARED_WORDS, ...CRISIS_WORDS];
// Literal Korean phrase stems supplied for the Korean check-in agent. Hangul
// does not use JavaScript's ASCII word boundaries; retain the matched phrase
// rather than inventing an English translation in the caller's evidence.
const SHARED_KOREAN_PHRASES = ["흉통", "가슴 통증", "가슴이 아파", "숨을 못 쉬", "숨을 못쉬", "숨이 안 쉬", "넘어졌", "어지러", "어지럽", "혼란", "응급"];
const CRISIS_KOREAN_PHRASES = ["도와주", "도움이 필요", "나갈 수 없", "못 나가", "갇혔"];

/** Denials apply only within the current clause, never across "but" or "No,". */
function clausePrefix(turn: string, index: number): string {
  return turn.slice(0, index).split(/[.!?;,\n]|\b(?:but|however|yet|although|though)\b/).at(-1) ?? "";
}

function clearlyDenied(turn: string, index: number): boolean {
  const prefix = clausePrefix(turn, index);
  // Deliberately limited grammar: "not sure", "don't know" and other
  // uncertain statements do not match and still require a person's review.
  return /\b(?:no|not|never|without|deny|denies|denied|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't)\s+(?:(?:any|a|an|current|currently|have|had|having|feel|felt|feeling|experience|experienced|experiencing|been|be|need|needing|longer)\s+){0,3}$/.test(prefix);
}

function koreanDenied(turn: string, index: number, phrase: string): boolean {
  const prefix = clausePrefix(turn, index);
  const suffix = turn.slice(index + phrase.length).split(/[.!?;,\n]|하지만|그런데/)[0];
  // Only direct Korean denials. The negative words inside "cannot breathe"
  // remain danger evidence, and uncertainty such as "는지 모르겠어요" remains open.
  if (!/못|안 쉬|수 없/.test(phrase) && /(?:^|\s)안\s*$/.test(prefix)) return true;
  return /^(?:(?:이|가|은|는|을|를|도)\s*)?(?:없|아니)/.test(suffix) ||
    /^(?:지|하지)\s*않/.test(suffix) || /^(?:던|은)\s*적이\s*없/.test(suffix);
}

export function checkHardRules(input: RetellCall | string | undefined, mode: EventMode = "crisis"): ClassifierResult | null {
  const attributed = typeof input === "object" && input !== null ? input : { call_id: "hard-rules", transcript: input };
  const turns = callerUtterances(attributed).map((turn) => turn.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase());
  const hit = (phrase: string): ClassifierResult => ({
    status: "needs_human", urgency: "urgent", flag_reason: `said "${phrase}"`,
    summary: typeof input === "object" && input?.call_analysis?.call_summary?.trim()
      ? input.call_analysis.call_summary.trim()
      : `Caller said "${phrase}". A person needs to follow up.`,
  });
  for (const word of mode === "daily" ? SHARED_WORDS : DANGER_WORDS) {
    const phrase = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const pattern = new RegExp(`\\b${phrase}\\b`, "g");
    if (turns.some((turn) => [...turn.matchAll(pattern)].some((match) => !clearlyDenied(turn, match.index ?? 0)))) {
      return hit(word);
    }
  }
  const koreanPhrases = mode === "daily" ? SHARED_KOREAN_PHRASES : [...SHARED_KOREAN_PHRASES, ...CRISIS_KOREAN_PHRASES];
  for (const phrase of koreanPhrases) {
    if (turns.some((turn) => {
      let index = turn.indexOf(phrase);
      while (index !== -1) {
        if (!koreanDenied(turn, index, phrase)) return true;
        index = turn.indexOf(phrase, index + phrase.length);
      }
      return false;
    })) return hit(phrase);
  }
  return null;
}
