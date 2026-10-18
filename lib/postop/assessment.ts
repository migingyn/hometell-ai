import { callerUtterances } from "@/lib/classifier/priority";
import type { ClassifierContext, RetellCall } from "@/lib/types";
import { POSTOP_FIELDS, type PostOpAnswer, type PostOpAssessment } from "./types";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
type PostOpContext = ClassifierContext & { patientName?: string };

/** Full attributed turns preserve negation and timing that a short quote could omit. */
function patientQuote(value: unknown, turns: string[]): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  const quote = value.trim();
  return turns.some((turn) => turn.trim() === quote) ? quote : null;
}

function confirmsIdentity(call: RetellCall, quote: string, patientName?: string): boolean {
  const name = patientName?.trim().toLowerCase();
  const normalized = quote.toLowerCase();
  // A complete self-identification or a yes to the identity question is needed;
  // a model label plus a random patient answer is not identity evidence.
  if (/\b(?:this is|i am|i'm)\b/i.test(quote) && (!name || normalized.includes(name)) &&
    !/\b(?:not|don't|isn't|no)\b/i.test(quote)) return true;
  if (!/^(?:yes|yeah|yep|speaking|that's me|that is me|네|예)(?:[,.!\s]|$)/i.test(quote)) return false;
  const structured = call.transcript_object ?? call.transcript_with_tool_calls;
  if (!Array.isArray(structured)) return false;
  return structured.some((turn, index) => {
    if (turn.role !== "user" || turn.content?.trim() !== quote) return false;
    const before = structured[index - 1];
    const question = before?.content ?? "";
    return (before?.role === "agent" || before?.role === "assistant") &&
      /\b(?:is this|am i speaking|are you)\b|님이신가요|본인/i.test(question) &&
      (!name || question.toLowerCase().includes(name));
  });
}

function isUncertain(quote: string): boolean {
  return /\b(?:don't know|do not know|not sure|unsure|can't tell|cannot tell|cannot remember|don't remember|haven't checked|have not checked)\b|모르겠|모르[고는]?|확인하지 않았/i.test(quote);
}

/** Conservative evidence check, not a pain threshold or a clinical severity score. */
export function reportedPainScore(value: unknown, quote: string): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) return null;
  const text = quote.toLowerCase().replace(/(?:out of|\/)\s*(?:10|ten)\b/g, "");
  if (/\b(?:not|was|yesterday|last|previous|used to|maybe|not sure|don't know)\b/.test(text)) return null;
  const tokens = text.match(/\b(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g) ?? [];
  const numbers = tokens.map((token) => NUMBER_WORDS.includes(token) ? NUMBER_WORDS.indexOf(token) : Number(token));
  return numbers.length > 0 && numbers.every((number) => number === value) ? value : null;
}

function normalized(value: string | number): string { return String(value).trim().replace(/\s+/g, " ").toLowerCase(); }

export function buildPostOpAssessment(
  call: RetellCall,
  context: PostOpContext,
  previous: PostOpAssessment | null = null,
  recordedAt = new Date().toISOString(),
): PostOpAssessment | null {
  if (context.mode !== "daily" || (context.target ?? call.metadata?.target) !== "client") return null;
  const data = call.call_analysis?.custom_analysis_data ?? {};
  const turns = callerUtterances(call);
  const identityQuote = patientQuote(data.postop_identity_quote, turns);
  const thirdParty = identityQuote && /\b(?:his|her|their|my)\s+(?:wife|husband|daughter|son|mother|father|caregiver|nurse)\b|\b(?:not|isn't|is not)\s+(?:the patient|him|her)\b/i.test(identityQuote);
  const patientConfirmed = data.postop_patient_confirmed === true && identityQuote !== null && !thirdParty &&
    confirmsIdentity(call, identityQuote, context.patientName);
  const answers = Object.fromEntries(POSTOP_FIELDS.map((field): [string, PostOpAnswer] => {
    const quote = patientConfirmed ? patientQuote(data[`postop_${field}_quote`], turns) : null;
    const value = quote && !isUncertain(quote) ? field === "pain" ? reportedPainScore(data.postop_pain_score, quote) : quote : null;
    return [field, { status: value === null ? "unknown" : "reported", value, quote }];
  })) as PostOpAssessment["answers"];
  const validPrevious = previous?.version === 1 && previous.call_id !== call.call_id ? previous : null;
  const changes: PostOpAssessment["changes"] = [];
  const unavailable: PostOpAssessment["comparison"]["unavailable_fields"] = [];
  for (const field of POSTOP_FIELDS) {
    const before = validPrevious?.answers[field];
    const current = answers[field];
    if (!before || before.status !== "reported" || current.status !== "reported" ||
      before.value === null || current.value === null || !before.quote || !current.quote) {
      unavailable.push(field);
      continue;
    }
    if (normalized(before.value) !== normalized(current.value)) changes.push({
      field, previous: before.value, current: current.value, previous_quote: before.quote, current_quote: current.quote,
    });
  }
  const missing = POSTOP_FIELDS.filter((field) => answers[field].status === "unknown");
  return {
    version: 1, call_id: call.call_id, recorded_at: recordedAt, patient_confirmed: patientConfirmed,
    identity_quote: patientConfirmed ? identityQuote : null, answers, changes,
    comparison: { previous_call_id: validPrevious?.call_id ?? null, status: validPrevious ? "compared" : "no_previous_check", unavailable_fields: unavailable },
    suggested_next_step: {
      action: "nurse_review", label: missing.length ? "Review missing answers" : "Review check-in record",
      reason: !patientConfirmed ? "Patient identity was not confirmed; answers remain unknown. A nurse must review the call."
        : missing.length ? `${missing.length} of ${POSTOP_FIELDS.length} answers are unknown. A nurse should review the record and decide the follow-up.`
          : changes.length ? `${changes.length} recorded ${changes.length === 1 ? "answer differs" : "answers differ"} from the previous call. A nurse should review the quotes and decide the follow-up.`
            : "Review the patient's reported answers and decide whether any follow-up is needed. This does not establish that the patient is clinically well.",
      status: "proposed", approved_at: null, reviewer: null,
    },
  };
}
