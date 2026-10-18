import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, ChevronDown, ClipboardList, Pencil, RefreshCw } from "lucide-react";
import { POSTOP_FIELDS, POSTOP_LABELS, type PostOpAssessment, type PostOpField } from "@/lib/postop/types";
import type { ApiResult } from "@/lib/types";
import type { AnswerReview, AnswerReviewData } from "./operations/answer-review-types";
import { answerDraftConflict, mergeAnswerRead, mergeAnswerReceipt, openAnswerDraft, type AnswerDraft } from "./operations/answer-review-state";

type Props = {
  assessment?: PostOpAssessment | null;
  checkId: string;
  busy: boolean;
  handled: boolean;
  expanded?: boolean;
  onReview: (id: string, callId: string, reviewer: string) => Promise<void>;
  onQuoteSelect?: (quote: string, callId: string) => void;
};

function answerValue(value: string | number | null | undefined, field: PostOpField) {
  if (value === null || value === undefined || value === "") return "Unknown";
  return field === "pain" && typeof value === "number" ? `${value}/10` : String(value);
}

export function PostOpCheckIn({ assessment, checkId, busy, handled, onReview, onQuoteSelect, expanded = false }: Props) {
  const [reviewer, setReviewer] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<{ key: string; signature?: string; data?: AnswerReviewData; error?: string }>({ key: "" });
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [savingField, setSavingField] = useState<PostOpField | null>(null);
  const [fieldError, setFieldError] = useState<{ field: PostOpField; message: string } | null>(null);
  const [editor, setEditor] = useState<AnswerDraft | null>(null);
  const callId = assessment?.call_id;
  const answerKey = `${checkId}:${callId ?? ""}`;
  const answerSignature = JSON.stringify(assessment?.answers ?? null);
  const answerData = answerState.key === answerKey ? answerState.data : undefined;
  const answerError = answerState.key === answerKey ? answerState.error : undefined;
  const answerSourceCurrent = answerState.key === answerKey && answerState.signature === answerSignature;

  useEffect(() => {
    if (!callId) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let active = true;
    void fetch(`/api/checks/${encodeURIComponent(checkId)}/answer-review?call_id=${encodeURIComponent(callId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as ApiResult<AnswerReviewData>;
        if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "Answer reviews could not be loaded.");
        if (result.data.checkId !== checkId || result.data.callId !== callId) throw new Error("The call changed. Refresh the answers before reviewing.");
        if (active) setAnswerState(previous => ({ key: answerKey, signature: answerSignature, data: mergeAnswerRead(previous.key === answerKey ? previous.data : undefined, result.data) }));
      })
      .catch(error => { if (active) setAnswerState(previous => ({ key: answerKey, signature: previous.key === answerKey ? previous.signature : undefined, data: previous.key === answerKey ? previous.data : undefined, error: error instanceof Error ? error.message : "Answer reviews are unavailable." })); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [checkId, callId, answerKey, answerSignature, reviewRefresh]);

  async function saveAnswer(field: PostOpField, action: "confirm" | "correct") {
    const source = answerData?.sources[field];
    if (!callId || !source || !reviewer.trim() || savingField || busy || handled || answerError || !answerSourceCurrent) return;
    if (action === "confirm" && source.answer.status !== "reported") return;
    const previous = answerData?.reviews.find(review => review.field === field);
    let expectedSource = source.fingerprint;
    let expectedRevision = previous?.revision ?? 0;
    let corrected: string | number | null | undefined;
    if (action === "correct") {
      if (editor?.field !== field) return;
      const conflict = answerDraftConflict(editor, answerData);
      if (conflict) { setFieldError({ field, message: `${conflict} This draft was not applied. Cancel and reopen Correct to review the updated answer.` }); return; }
      expectedSource = editor.fingerprint;
      expectedRevision = editor.revision;
      corrected = editor.unknown ? null : field === "pain" ? Number(editor.value) : editor.value.trim();
      if (!editor.unknown && (!editor.value.trim() || (field === "pain" && (!Number.isFinite(corrected) || Number(corrected) < 0 || Number(corrected) > 10)))) {
        setFieldError({ field, message: field === "pain" ? "Enter a pain score from 0 to 10, or mark the answer unknown." : "Enter the corrected answer, or mark it unknown." }); return;
      }
    }
    setSavingField(field); setFieldError(null);
    try {
      const response = await fetch(`/api/checks/${encodeURIComponent(checkId)}/answer-review`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ call_id: callId, field, action, reviewer: reviewer.trim(), expected_revision: expectedRevision,
          expected_source: expectedSource, ...(action === "correct" ? { corrected_value: corrected } : {}) }) });
      const result = await response.json() as ApiResult<{ review: AnswerReview }>;
      if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "The answer review could not be saved.");
      if (result.data.review.check_id !== checkId || result.data.review.call_id !== callId || result.data.review.field !== field) throw new Error("The returned review did not match this answer. Refresh to check its status.");
      setAnswerState(previousState => previousState.key === answerKey && previousState.data ? { ...previousState,
        data: mergeAnswerReceipt(previousState.data, result.data.review) } : previousState);
      setEditor(null);
      setReviewRefresh(value => value + 1);
    } catch (error) {
      setFieldError({ field, message: `Could not confirm the save. ${error instanceof Error ? error.message : "The connection was interrupted."} Check the saved review before retrying.` });
      setReviewRefresh(value => value + 1);
    } finally { setSavingField(null); }
  }

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
      <div className="pw-answer-reviewer"><label htmlFor={`answer-reviewer-${checkId}`}>Answer reviewer</label><input id={`answer-reviewer-${checkId}`} value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} autoComplete="off" placeholder="Name or initials" disabled={Boolean(savingField) || busy || handled} /><small>Confirm or correct each extracted answer. The original stays visible.</small></div>
      {answerError && <div className="pw-answer-load-error" role="status"><p>{answerError} Review controls are paused.</p><button type="button" onClick={() => setReviewRefresh(value => value + 1)}><RefreshCw size={12} />Reload reviews</button></div>}
      {!answerError && (!answerData || !answerSourceCurrent) && <p className="pw-answer-hint" role="status">Loading the current answers and saved reviews…</p>}
      <dl>
        {POSTOP_FIELDS.map((field) => {
          const answer = answerData?.sources[field]?.answer ?? assessment.answers[field];
          const reported = answer.status === "reported";
          const review = answerData?.reviews.find(item => item.field === field);
          const editing = editor?.field === field;
          const editorConflict = editing ? answerDraftConflict(editor, answerData) : null;
          const disabled = busy || handled || Boolean(savingField) || !answerData || !answerSourceCurrent || Boolean(answerError) || !reviewer.trim();
          const confirmedCurrent = review?.action === "confirm" && review.source_current && answerSourceCurrent;
          const correctedCurrent = review?.action === "correct" && review.source_current && answerSourceCurrent;
          const showValue = typeof answer.value === "number" || String(answer.value ?? "").trim() !== String(answer.quote ?? "").trim();
          return <div key={field} className={reported ? "" : "hb-postop-unknown"}>
            <dt>{POSTOP_LABELS[field]}</dt>
            <dd>
              {reported ? <>
                {review?.action === "correct" && <span className="pw-answer-original-label">Original extraction</span>}
                {showValue && (answer.quote && onQuoteSelect ? <button type="button" className="pw-answer-value" onClick={() => onQuoteSelect(answer.quote!, assessment.call_id)} aria-label={`Find source for ${POSTOP_LABELS[field]}: ${answerValue(answer.value, field)}`}>{answerValue(answer.value, field)}<ArrowUpRight size={12} aria-hidden="true" /></button> : <strong>{answerValue(answer.value, field)}</strong>)}
                {answer.quote ? onQuoteSelect ? <button type="button" className="pw-answer-quote" onClick={() => onQuoteSelect(answer.quote!, assessment.call_id)}><span>“{answer.quote}”</span><ArrowUpRight size={13} aria-hidden="true" /><span className="pw-visually-hidden">Find this statement in the caller’s transcript</span></button> : <blockquote>“{answer.quote}”</blockquote> : <span>No supporting quote recorded.</span>}
              </> : <><span>Unknown · not established in this call</span>{answer.quote && <blockquote>“{answer.quote}”</blockquote>}</>}
              {review && <div className={`pw-answer-receipt ${review.source_current && answerSourceCurrent ? "" : "pw-answer-stale"}`}>
                <strong>{!answerSourceCurrent ? "Refreshing answer source…" : review.source_current ? review.action === "confirm" ? "Answer confirmed" : "Corrected answer" : "Source changed · review again"}</strong>
                {review.action === "correct" && <p>{answerValue(review.corrected_value, field)}</p>}
                <small>{review.reviewer} · {new Date(review.reviewed_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · revision {review.revision}</small>
                {!review.source_current && <details><summary>Previously reviewed source</summary><p>{answerValue(review.original_answer.value, field)}</p>{review.original_answer.quote && <blockquote>“{review.original_answer.quote}”</blockquote>}</details>}
              </div>}
              {!handled && <div className="pw-answer-actions"><button type="button" disabled={disabled || !reported || confirmedCurrent} onClick={() => { void saveAnswer(field, "confirm"); }}><Check size={12} />{savingField === field && !editing ? "Saving…" : confirmedCurrent ? "Confirmed" : correctedCurrent ? "Use original" : "Confirm"}</button><button type="button" disabled={busy || Boolean(savingField) || !answerData || !answerSourceCurrent || Boolean(answerError) || editing} onClick={() => { if (answerData) setEditor(openAnswerDraft(answerData, field)); setFieldError(null); }}><Pencil size={12} />Correct</button></div>}
              {!reported && !handled && <small className="pw-answer-hint">Unknown answers cannot be confirmed.</small>}
              {editing && <form className="pw-answer-editor" onSubmit={event => { event.preventDefault(); void saveAnswer(field, "correct"); }}>
                {editorConflict && <p className="pw-answer-save-error" role="alert">{editorConflict} This draft has not been applied. Cancel and reopen Correct to review the updated answer.</p>}
                <label htmlFor={`answer-value-${checkId}-${field}`}>Corrected {POSTOP_LABELS[field].toLowerCase()}</label>
                {field === "pain" ? <input id={`answer-value-${checkId}-${field}`} type="number" min="0" max="10" step="any" value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} disabled={editor.unknown || Boolean(savingField)} /> : <textarea id={`answer-value-${checkId}-${field}`} rows={2} maxLength={2000} value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} disabled={editor.unknown || Boolean(savingField)} />}
                <label className="pw-answer-unknown"><input type="checkbox" checked={editor.unknown} onChange={event => setEditor({ ...editor, unknown: event.target.checked })} disabled={Boolean(savingField)} />Mark as unknown</label>
                <div><button type="submit" disabled={disabled || Boolean(editorConflict)}>{savingField === field ? "Saving…" : "Save correction"}</button><button type="button" disabled={Boolean(savingField)} onClick={() => setEditor(null)}>Cancel</button></div>
                {!reviewer.trim() && <small>Enter the reviewer’s name above to save.</small>}
              </form>}
              {fieldError?.field === field && <p className="pw-answer-save-error" role="alert">{fieldError.message}</p>}
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
