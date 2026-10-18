import { z } from "zod";
import { redactPhoneNumbers } from "@/lib/demo/evidence";
import { POSTOP_FIELDS, type PostOpAnswer, type PostOpField } from "./types";

export const ReviewCallId = z.string().trim().min(1).max(200);
export const AnswerReviewInput = z.object({
  call_id: ReviewCallId,
  field: z.enum(POSTOP_FIELDS),
  action: z.enum(["confirm", "correct"]),
  reviewer: z.string().trim().min(1).max(100),
  expected_revision: z.number().int().min(0).max(1_000_000),
  expected_source: z.string().regex(/^[a-f0-9]{32}$/),
  corrected_value: z.union([z.string().trim().min(1).max(2000), z.number().finite(), z.null()]).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "confirm" && value.corrected_value !== undefined) {
    context.addIssue({ code: "custom", path: ["corrected_value"], message: "A confirmation cannot change the extracted answer." });
  }
  if (value.action === "correct") {
    if (value.corrected_value === undefined) context.addIssue({ code: "custom", path: ["corrected_value"], message: "Supply a correction, or null to record unknown." });
    else if (value.corrected_value !== null && (value.field === "pain"
      ? typeof value.corrected_value !== "number" || value.corrected_value < 0 || value.corrected_value > 10
      : typeof value.corrected_value !== "string")) {
      context.addIssue({ code: "custom", path: ["corrected_value"], message: value.field === "pain" ? "Pain must be a number from 0 to 10, or unknown." : "This answer must be text, or unknown." });
    }
  }
});
export type AnswerReviewRequest = z.infer<typeof AnswerReviewInput>;
export type AnswerReview = {
  id: string; check_id: string; call_id: string; field: PostOpField; action: "confirm" | "correct";
  original_answer: PostOpAnswer; corrected_value?: string | number | null;
  reviewer: string; reviewed_at: string; revision: number;
  source_fingerprint: string; source_current: boolean;
};
export type AnswerReviewSource = { fingerprint: string; answer: PostOpAnswer };
export type AnswerReviews = { checkId: string; callId: string; reviews: AnswerReview[]; sources: Record<PostOpField, AnswerReviewSource> };

/** Reject browser cross-origin writes while preserving existing local CLI verification. */
export function allowsAnswerReviewOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const value = request.headers.get("origin");
  if (!value) return true;
  try {
    const origin = new URL(value), destination = new URL(request.url);
    return origin.protocol === destination.protocol && origin.host === (request.headers.get("host") ?? destination.host);
  } catch { return false; }
}

export function reviewFailure(kind: string): { message: string; status: number } {
  if (["unknown_check", "unknown_call", "no_assessment"].includes(kind)) return { status: 404, message: "No current extracted answers were found for this call." };
  if (kind === "stale_call") return { status: 409, message: "The current call changed. Refresh before reviewing an answer." };
  if (kind === "source_changed") return { status: 409, message: "The original extraction changed. Refresh and review the new answer." };
  if (kind === "revision_conflict") return { status: 409, message: "Another review was saved. Refresh before applying your change." };
  if (kind === "handled") return { status: 409, message: "This case was already handled. Its answers cannot be changed here." };
  if (kind === "unknown_answer") return { status: 400, message: "An unknown answer cannot be confirmed. Record a correction or leave it unknown." };
  return { status: 400, message: "The answer review is invalid." };
}

function publicAnswer(answer: PostOpAnswer): PostOpAnswer {
  return { status: answer.status, value: typeof answer.value === "string" ? redactPhoneNumbers(answer.value) : answer.value,
    quote: answer.quote === null ? null : redactPhoneNumbers(answer.quote) };
}
/** Leave the stored source and audit record untouched; redact outward-facing strings only. */
export function publicAnswerReview(review: AnswerReview): AnswerReview {
  const value: AnswerReview = { id: review.id, check_id: review.check_id, call_id: review.call_id,
    field: review.field, action: review.action, original_answer: publicAnswer(review.original_answer),
    reviewer: redactPhoneNumbers(review.reviewer), reviewed_at: review.reviewed_at, revision: review.revision,
    source_fingerprint: review.source_fingerprint, source_current: review.source_current };
  if (review.action === "correct") value.corrected_value = typeof review.corrected_value === "string"
    ? redactPhoneNumbers(review.corrected_value) : review.corrected_value ?? null;
  return value;
}
export function publicAnswerReviews(data: AnswerReviews): AnswerReviews {
  return { checkId: data.checkId, callId: data.callId, reviews: data.reviews.map(publicAnswerReview),
    sources: Object.fromEntries(POSTOP_FIELDS.map(field => [field, { fingerprint: data.sources[field].fingerprint,
      answer: publicAnswer(data.sources[field].answer) }])) as AnswerReviews["sources"] };
}
