import type { CallerAssessment, ClassifierContext, RetellCall } from "@/lib/types";

type Situation = CallerAssessment["situation"];
type Distress = CallerAssessment["distress"];
type Evidence = CallerAssessment["evidence"][number];

/** Structured speaker attribution takes precedence, including an empty transcript. */
export function callerUtterances(call: RetellCall): string[] {
  const structured = Array.isArray(call.transcript_object)
    ? call.transcript_object
    : Array.isArray(call.transcript_with_tool_calls) ? call.transcript_with_tool_calls : null;
  if (structured) {
    return structured.filter((turn) => turn?.role === "user" && typeof turn.content === "string")
      .map((turn) => turn.content as string).filter((text) => text.trim());
  }
  const turns: string[] = [];
  let readingUser = false;
  for (const line of (call.transcript ?? "").split(/\r?\n/)) {
    const tag = /^\s*([A-Za-z][A-Za-z _-]*):\s*(.*)$/.exec(line);
    if (tag) {
      readingUser = tag[1].trim().toLowerCase() === "user";
      if (readingUser) turns.push(tag[2]);
    } else if (readingUser && turns.length) {
      turns[turns.length - 1] += `\n${line}`;
    }
  }
  return turns.filter((text) => text.trim());
}

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase();
}

/** These are narrow evidence rules for operator review, not medical diagnoses. */
function positiveMatch(text: string, pattern: RegExp): boolean {
  const normalized = normalize(text);
  for (const match of normalized.matchAll(new RegExp(pattern.source, "gi"))) {
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 70), match.index)
      .split(/[.!?;,\n]|\b(?:but|however|yet|although|though)\b/).at(-1) ?? "";
    // Avoid common negations and hypothetical examples. The negation inside
    // "can't breathe" is itself the reported danger and is part of the match.
    if (/\b(?:no|not|never|without|deny|denies|denied|don't|doesn't|isn't|wasn't|aren't|weren't)\s+(?:[a-z']+\s+){0,4}$/.test(prefix)) continue;
    if (/\b(?:if|suppose|imagine|in case|would|could)\b[^.!?;]*$/.test(prefix)) continue;
    return true;
  }
  return false;
}

function koreanReport(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    let index = text.indexOf(phrase);
    while (index !== -1) {
      const remainder = text.slice(index + phrase.length).split(/[.!?;\n]/)[0];
      // Literal Korean stems preserve source evidence. Obvious denials remain
      // unknown rather than turning the phrase itself into an emergency.
      if (!/^(?:[가-힣 ]{0,16})(?:아니|없|않)/.test(remainder)) return true;
      index = text.indexOf(phrase, index + phrase.length);
    }
    return false;
  });
}

const IMMEDIATE_PATTERNS = [
  /\bbleeding out\b/,
  /\b(?:can't|cannot|can not|unable to) breathe\b/,
  /\b(?:struggling to breathe|having (?:severe )?(?:trouble|difficulty) breathing)\b/,
  /\b(?:bleeding (?:severely|heavily|uncontrollably)|(?:severe|heavy|uncontrollable) bleeding|bleeding (?:that )?(?:won't|will not) stop)\b/,
  /\b(?:am|is|are) drowning\b/,
  /\b(?:roof|ceiling|house|building) (?:is |are )?(?:collapsing|caving in)\b/,
  /\b(?:house|home|room|building|kitchen) (?:is |are )?(?:on fire|burning)\b/,
  /\b(?:fire|flames) (?:is |are )?(?:inside|in) (?:my |the |our )?(?:house|home|room|building|kitchen)\b/,
  /\b(?:rising floodwater|floodwater (?:is )?rising) (?:is )?(?:inside|in)\b/,
  /\b(?:water|floodwater) (?:is )?(?:coming|pouring|rushing) (?:into|inside) (?:my |the |our )?(?:house|home|room|car)\b/,
];
const TRAPPED = /\b(?:trapped|stuck inside|can't (?:leave|escape)|cannot (?:leave|escape))\b/;
const RISING_WATER = /\b(?:water|floodwater|flood water) (?:is |keeps )?rising\b/;
const ASSISTANCE = /\b(?:need|needs|require|requires|request|want|would like) (?:some |a |an |urgent )?(?:help|assistance|ride|transport|transportation|evacuation|food|water|medicine|medication|shelter)\b|\b(?:help|assistance) (?:with|getting|leaving|evacuating)\b|\b(?:out of|running out of) (?:food|water|medicine|medication|oxygen)\b|\b(?:power (?:is )?out|lost power|no power)\b/;
const ROUTINE = /\b(?:i am|i'm|we are|we're) (?:doing )?(?:okay|ok|fine)\b|\b(?:at|in|inside) (?:a |the )?shelter\b|\b(?:have|have enough) (?:food and water|water and food)\b/;
const HIGH_DISTRESS = /\b(?:i am|i'm|i feel|i'm feeling|we are|we're) (?:in (?:a )?panic|panicking|terrified|freaking out|overwhelmed)\b|\b(?:i|we) (?:can't|cannot) calm down\b|\b(?:i|we) (?:am |are )?(?:feel|feeling) like (?:i'm|i am|we're|we are) (?:going to die|dying)\b/;
const MODERATE_DISTRESS = /\b(?:i am|i'm|i feel|i'm feeling|we are|we're) (?:really |very |so )?(?:worried|scared|anxious|afraid|frightened|upset)\b/;
const situationRank: Record<Situation, number> = { unknown: 0, routine: 1, needs_assistance: 2, immediate_danger: 3 };

function reportedTraumaticLimbLoss(text: string): boolean {
  // Current traumatic limb-loss wording. Past surgery/disability is not itself
  // a new emergency; preserve ordinary negation and hypothetical handling.
  const loss = /\b(?:arm|leg|hand|foot|finger|toe|limb)(?:'s| (?:has (?:just )?been|was|is|got|just got|just been))? (?:just )?(?:(?:chopped|cut|torn|ripped) off|severed)\b|\b(?:i|he|she|they) (?:have |has )?just lost (?:my|his|her|their|an?|the) (?:arm|leg|hand|foot|finger|toe|limb)\b/;
  return normalize(text).split(/[.!?;\n]|\b(?:but|however|yet|although|though)\b/).some(clause => {
    if (/\b(?:prosthetic|prosthesis|artificial|years? ago|months? ago|weeks? ago|last year|last month|last week|as a child|when i was|previously|healed)\b/.test(clause)) return false;
    return positiveMatch(clause, loss);
  });
}

function observedSituation(text: string): Situation {
  if (reportedTraumaticLimbLoss(text) || IMMEDIATE_PATTERNS.some((pattern) => positiveMatch(text, pattern)) ||
      (positiveMatch(text, TRAPPED) && positiveMatch(text, RISING_WATER)) ||
      koreanReport(text, ["숨을 못 쉬", "숨을 못쉬", "숨이 안 쉬"])) return "immediate_danger";
  if (positiveMatch(text, ASSISTANCE) || positiveMatch(text, TRAPPED) ||
      koreanReport(text, ["흉통", "가슴 통증", "가슴이 아파", "넘어졌", "어지러", "어지럽", "혼란", "응급", "도와주", "도움이 필요", "나갈 수 없", "못 나가", "갇혔"])) return "needs_assistance";
  if (positiveMatch(text, ROUTINE)) return "routine";
  return "unknown";
}

function observedDistress(text: string): Distress {
  if (positiveMatch(text, HIGH_DISTRESS) || koreanReport(text, ["패닉 상태", "공황 상태", "너무 무서워", "너무 두려워"])) return "high";
  if (positiveMatch(text, MODERATE_DISTRESS) || koreanReport(text, ["걱정돼", "걱정이 돼", "무서워", "불안해"])) return "moderate";
  return "unknown";
}

function validQuote(value: unknown, turns: string[]): { quote: string; sourceTurns: string[] } | null {
  if (typeof value !== "string") return null;
  const quote = value.trim();
  if (quote.length < 3 || quote.length > 600) return null;
  const sourceTurns = turns.filter((turn) => turn.includes(quote));
  return sourceTurns.length ? { quote, sourceTurns } : null;
}

function boundedEvidence(evidence: Evidence[]): Evidence[] {
  // Situation evidence is added only when severity increases, with the two
  // supporting turns retained for a combined flood/entrapment report. Keep it
  // separately so repeated distress cannot displace the reason for escalation.
  return [
    ...evidence.filter((item) => item.kind === "situation").slice(-6),
    ...evidence.filter((item) => item.kind === "distress").slice(-2),
  ];
}

/** Suggested human review order from attributed caller text. No audio is inferred. */
export function assessCallerPriority(
  call: RetellCall,
  context: ClassifierContext,
  stage: "live" | "post_call" = "post_call",
): CallerAssessment {
  const turns = callerUtterances(call);
  const evidence: Evidence[] = [];
  let situation: Situation = "unknown";
  let distress: Distress = "unknown";
  const addEvidence = (kind: Evidence["kind"], quote: string) => {
    const excerpt = quote.trim().slice(0, 600);
    if (!evidence.some((item) => item.kind === kind && item.quote === excerpt)) evidence.push({ kind, quote: excerpt });
  };
  for (const turn of turns) {
    const observed = observedSituation(turn);
    if (situationRank[observed] > situationRank[situation]) {
      situation = observed;
      addEvidence("situation", turn);
    }
    const reported = observedDistress(turn);
    if ((reported === "high" && distress !== "high") || (reported === "moderate" && distress === "unknown")) {
      distress = reported;
      addEvidence("distress", turn);
    }
  }
  // A hazard and entrapment may be described on different caller turns.
  if (situation !== "immediate_danger") {
    const trapped = turns.find((turn) => positiveMatch(turn, TRAPPED));
    const rising = turns.find((turn) => positiveMatch(turn, RISING_WATER));
    if (trapped && rising) {
      situation = "immediate_danger";
      addEvidence("situation", trapped);
      addEvidence("situation", rising);
    }
  }

  // Extracted labels require exact caller evidence AND supporting language.
  // Preserve the full source turn: a shortened quote can omit a preceding
  // hypothetical or a following denial. A model-issued score cannot erase it.
  if (stage === "post_call") {
    const data = call.call_analysis?.custom_analysis_data ?? {};
    const quote = validQuote(data.situation_evidence_quote, turns);
    const label = data.situation_urgency;
    if (quote && typeof label === "string" && Object.hasOwn(situationRank, label) &&
        observedSituation(quote.quote) === label && quote.sourceTurns.some((turn) => observedSituation(turn) === label) &&
        situationRank[label as Situation] > situationRank[situation]) {
      situation = label as Situation;
      addEvidence("situation", quote.quote);
    }
    const distressQuote = validQuote(data.distress_evidence_quote, turns);
    const reported = data.reported_distress;
    if (distressQuote && (reported === "high" || reported === "moderate") &&
        observedDistress(distressQuote.quote) === reported &&
        distressQuote.sourceTurns.some((turn) => observedDistress(turn) === reported) &&
        ((reported === "high" && distress !== "high") || (reported === "moderate" && distress === "unknown"))) {
      distress = reported;
      addEvidence("distress", distressQuote.quote);
    }
  }

  let priority: CallerAssessment["priority"] = "review";
  const reasons: string[] = [];
  if (situation === "immediate_danger") {
    priority = "immediate";
    reasons.push("The caller describes a potentially immediate threat; prioritize operator review.");
  } else if (situation === "needs_assistance") {
    priority = context.mode === "crisis" ? "urgent" : "follow_up";
    reasons.push("The caller describes an assistance need; follow up on the reported circumstances.");
  } else if (situation === "routine") {
    priority = "follow_up";
    reasons.push("The caller reports routine circumstances; this does not establish their overall condition.");
  } else {
    reasons.push(turns.length
      ? "The caller's circumstances remain unclear; operator review is needed."
      : "No attributable caller speech is available; their circumstances remain unknown.");
  }
  if (distress !== "unknown") reasons.push("The caller describes distress in text; bring them to a person sooner within the same reported-severity tier. Distress does not change reported severity.");
  if ((context.target ?? call.metadata?.target) === "emergency_contact") {
    reasons.push("This is the emergency contact's report and distress, not a verified medical condition of the enrolled client.");
  }
  reasons.push("Audible distress is unavailable: transcript analysis does not measure tone, pitch, or breathing.");
  const sentiment = stage === "post_call" ? call.call_analysis?.user_sentiment : undefined;
  const transcriptSentiment = sentiment === "Positive" || sentiment === "Negative" || sentiment === "Neutral" || sentiment === "Unknown"
    ? sentiment : null;
  return { priority, situation, distress, audible_distress: "unavailable", transcript_sentiment: transcriptSentiment,
    evidence: boundedEvidence(evidence), reasons, stage };
}
