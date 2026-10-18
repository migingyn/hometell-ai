import type { PostOpField } from "@/lib/postop/types";
import type { AnswerReview, AnswerReviewData } from "./answer-review-types";

export type AnswerDraft = {
  field: PostOpField;
  value: string;
  unknown: boolean;
  checkId: string;
  callId: string;
  fingerprint: string;
  revision: number;
};

export function openAnswerDraft(data: AnswerReviewData, field: PostOpField): AnswerDraft {
  const source = data.sources[field];
  const review = data.reviews.find(item => item.field === field);
  const value = review?.action === "correct" && review.source_current ? review.corrected_value : source.answer.value;
  return { field, value: value === null || value === undefined ? "" : String(value), unknown: value === null || value === undefined,
    checkId: data.checkId, callId: data.callId, fingerprint: source.fingerprint, revision: review?.revision ?? 0 };
}

export function answerDraftConflict(draft: AnswerDraft, data: AnswerReviewData | undefined): string | null {
  if (!data || draft.checkId !== data.checkId || draft.callId !== data.callId) return "The selected call changed or its answers are unavailable.";
  if (draft.fingerprint !== data.sources[draft.field]?.fingerprint) return "The original extraction changed while this correction was open.";
  if (draft.revision !== (data.reviews.find(item => item.field === draft.field)?.revision ?? 0)) return "A newer review was saved while this correction was open.";
  return null;
}

/** A delayed POST must never downgrade a review or approve a newer extraction. */
export function mergeAnswerReceipt(data: AnswerReviewData, receipt: AnswerReview): AnswerReviewData {
  if (receipt.check_id !== data.checkId || receipt.call_id !== data.callId) return data;
  const latest = data.reviews.find(item => item.field === receipt.field);
  if (latest && latest.revision >= receipt.revision) return data;
  const sourceCurrent = receipt.source_current && receipt.source_fingerprint === data.sources[receipt.field]?.fingerprint;
  return { ...data, reviews: [...data.reviews.filter(item => item.field !== receipt.field), { ...receipt, source_current: sourceCurrent }] };
}

/** Keep a completed POST receipt if an earlier GET returns afterward. */
export function mergeAnswerRead(previous: AnswerReviewData | undefined, incoming: AnswerReviewData): AnswerReviewData {
  if (!previous || previous.checkId !== incoming.checkId || previous.callId !== incoming.callId) return incoming;
  return previous.reviews.reduce((data, receipt) => mergeAnswerReceipt(data, receipt), incoming);
}
