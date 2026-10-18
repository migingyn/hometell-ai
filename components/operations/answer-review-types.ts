import type { PostOpAnswer, PostOpField } from "@/lib/postop/types";

export type AnswerReview = {
  id: string;
  check_id: string;
  call_id: string;
  field: PostOpField;
  action: "confirm" | "correct";
  original_answer: PostOpAnswer;
  corrected_value?: string | number | null;
  reviewer: string;
  reviewed_at: string;
  revision: number;
  source_fingerprint: string;
  source_current: boolean;
};
export type AnswerReviewData = {
  checkId: string;
  callId: string;
  reviews: AnswerReview[];
  sources: Record<PostOpField, { fingerprint: string; answer: PostOpAnswer }>;
};
