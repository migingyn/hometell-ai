import { useState, type FormEvent } from "react";
import { Check, ChevronDown, ClipboardList } from "lucide-react";
import { POSTOP_FIELDS, POSTOP_LABELS, type PostOpAssessment } from "@/lib/postop/types";

type Props = {
  assessment?: PostOpAssessment | null;
  checkId: string;
  busy: boolean;
  handled: boolean;
  expanded?: boolean;
  onReview: (id: string, callId: string, reviewer: string) => Promise<void>;
};

export function PostOpCheckIn({ assessment, checkId, busy, handled, onReview, expanded = false }: Props) {
  const [reviewer, setReviewer] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  if (!assessment) return <section className="hb-postop hb-postop-empty" aria-label="Post-op check-in">
    <span className="hb-postop-heading"><ClipboardList size={13} />Post-op check-in</span>
    <p>No structured answers recorded for this call. Patient status remains unknown.</p>
  </section>;

  const answered = POSTOP_FIELDS.filter((field) => assessment.answers[field].status === "reported").length;
  const suggestion = assessment.suggested_next_step;
  const approved = suggestion.status === "approved";

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || !reviewer.trim() || busy) return;
    setReviewError(null);
    try { await onReview(checkId, assessment.call_id, reviewer.trim()); }
    catch (error) { setReviewError(error instanceof Error ? error.message : "Review could not be saved. Please try again."); }
  }

  return <section className="hb-postop" aria-label="Post-op check-in">
    <div className="hb-postop-title">
      <span className="hb-postop-heading"><ClipboardList size={13} />Post-op check-in</span>
      <span>{answered}/{POSTOP_FIELDS.length} answered</span>
    </div>
    {!assessment.patient_confirmed && <p className="hb-postop-identity">Patient identity was not confirmed in this call.</p>}
    <details className="hb-postop-answers" open={expanded || undefined}>
      <summary>Answers & patient quotes<ChevronDown size={12} /></summary>
      <dl>
        {POSTOP_FIELDS.map((field) => {
          const answer = assessment.answers[field];
          const reported = answer.status === "reported";
          return <div key={field} className={reported ? "" : "hb-postop-unknown"}>
            <dt>{POSTOP_LABELS[field]}</dt>
            <dd>
              {reported ? <>
                {field === "pain" && typeof answer.value === "number" && <strong>{answer.value}/10</strong>}
                {answer.quote ? <blockquote>“{answer.quote}”</blockquote> : <span>No supporting quote recorded.</span>}
              </> : <><span>Unknown · not established in this call</span>{answer.quote && <blockquote>“{answer.quote}”</blockquote>}</>}
            </dd>
          </div>;
        })}
      </dl>
    </details>
    <div className="hb-postop-changes">
      <span className="hb-postop-label">Since the previous check-in</span>
      {assessment.comparison.status === "no_previous_check" ? <p>No previous post-op check-in to compare.</p>
        : assessment.changes.length ? <ul>{assessment.changes.map((change) => <li key={change.field}>
          <strong>{POSTOP_LABELS[change.field]}</strong>
          <span className="hb-postop-before">Before: {change.field === "pain" && typeof change.previous === "number" ? `${change.previous}/10` : change.previous_quote ? `“${change.previous_quote}”` : "Unknown"}</span>
          <span>Now: {change.field === "pain" && typeof change.current === "number" ? `${change.current}/10` : change.current_quote ? `“${change.current_quote}”` : "Unknown"}</span>
        </li>)}</ul> : <p>No differences in comparable answers.</p>}
      {assessment.comparison.status === "compared" && assessment.comparison.unavailable_fields.length > 0 && <p>Cannot compare: {assessment.comparison.unavailable_fields.map((field) => POSTOP_LABELS[field].toLowerCase()).join(", ")}. A current or previous answer is unknown.</p>}
    </div>
    <div className={`hb-postop-review ${approved ? "hb-postop-approved" : ""}`}>
      <span className="hb-postop-label">{approved ? "Nurse approval recorded" : "Suggested next step · nurse approval required"}</span>
      <strong>{suggestion.label}</strong>
      <p>{suggestion.reason}</p>
      {approved ? <p className="hb-postop-review-receipt"><Check size={12} />{suggestion.reviewer || "Reviewer recorded"}{suggestion.approved_at ? ` · ${new Date(suggestion.approved_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p>
        : handled ? <p>This check-in has been handled by a person.</p>
          : <form onSubmit={submitReview}>
            <label htmlFor={`reviewer-${checkId}`}>Reviewing nurse</label>
            <input id={`reviewer-${checkId}`} value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Name or initials" autoComplete="off" maxLength={100} required disabled={busy} />
            <button type="submit" disabled={busy || !reviewer.trim()}>{busy ? "Saving review…" : "Approve next step"}<Check size={12} /></button>
          </form>}
      {reviewError && <p className="hb-postop-review-error" role="alert">{reviewError}</p>}
      <small>Records review only. A nurse decides and arranges any care.</small>
    </div>
  </section>;
}
