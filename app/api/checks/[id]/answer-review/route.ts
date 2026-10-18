import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase";
import { AnswerReviewInput, ReviewCallId, allowsAnswerReviewOrigin, publicAnswerReview, publicAnswerReviews, reviewFailure } from "@/lib/postop/answer-review";

const Params = z.object({ id: z.string().uuid() });
type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  const params = Params.safeParse(await context.params);
  const call = ReviewCallId.safeParse(new URL(req.url).searchParams.get("call_id"));
  if (!params.success || !call.success) return fail("Select a valid case and current call.");
  try {
    const { data, error } = await supabaseAdmin().rpc("read_heartbeat_answer_reviews", { p_check_id: params.data.id, p_call_id: call.data });
    if (error || !data) return fail("Cannot read answer reviews. Confirm the answer-review migration is applied.", 503);
    if (data.error_kind) { const problem = reviewFailure(data.error_kind); return fail(problem.message, problem.status); }
    const response = ok(publicAnswerReviews(data));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch { return fail("Cannot read answer reviews.", 500); }
}

export async function POST(req: Request, context: Context) {
  if (!allowsAnswerReviewOrigin(req)) return fail("Submit answer reviews from this Heartbeat page.", 403);
  const params = Params.safeParse(await context.params);
  if (!params.success) return fail("Select a valid case.");
  let value: unknown;
  try {
    const text = await req.text();
    if (text.length > 12_000) return fail("Review request is too large.", 413);
    value = JSON.parse(text);
  } catch { return fail("Body is not JSON."); }
  const parsed = AnswerReviewInput.safeParse(value);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The answer review is invalid.");
  const input = parsed.data;
  try {
    const { data, error } = await supabaseAdmin().rpc("save_heartbeat_answer_review", {
      p_check_id: params.data.id, p_call_id: input.call_id, p_field: input.field,
      p_action: input.action, p_reviewer: input.reviewer, p_expected_revision: input.expected_revision,
      p_expected_source: input.expected_source, p_corrected_value: input.corrected_value ?? null,
    });
    if (error || !data) return fail("Cannot save answer review. Confirm the answer-review migration is applied.", 503);
    if (data.error_kind) { const problem = reviewFailure(data.error_kind); return fail(problem.message, problem.status); }
    return ok({ review: publicAnswerReview(data.review) });
  } catch { return fail("Cannot save answer review.", 500); }
}
