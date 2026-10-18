"use client";

import { useEffect, useId, useState } from "react";
import { ArrowRight, Check, ClipboardCheck, Clock3, FileText, MessageSquareText, PhoneForwarded, RefreshCw, Route, UserRound, Zap } from "lucide-react";
import { PostOpCheckIn } from "../PostOpCheckIn";
import type { ApiResult, CheckWithClient, EventMode } from "@/lib/types";
import type { PostOpAssessment } from "@/lib/postop/types";
import "./patient-workspace.css";

type Props = {
  check: CheckWithClient | null;
  mode: EventMode;
  busy: boolean;
  onHandled: (id: string) => void;
  onAdvance: (id: string) => void;
  onReview: (id: string, callId: string, reviewer: string) => Promise<void>;
  mockMode: boolean;
  allowAdvance?: boolean;
};

type SavedEvidence = {
  checkId: string;
  callId: string | null;
  source: "persisted_call_log" | "live_rehearsal" | "none";
  callKind?: "teammate_rehearsal" | "sample" | "agency_call";
  callStatus?: string | null;
  recordingAvailable?: boolean;
  audioUrl?: string | null;
  priorDailySimulated?: boolean;
  recordedAt: string | null;
  target: "client" | "emergency_contact" | null;
  turns: { role: "agent" | "user"; content: string }[];
  transcript: string | null;
  priorDaily: { callId: string; recordedAt: string; answers: PostOpAssessment["answers"]; rideQuote: string | null } | null;
  simulated: boolean;
};

type EvidenceState = { key: string; data?: SavedEvidence; error?: string };
type Tab = "evidence" | "followup";
const STAGES = ["First call", "Retry", "Text", "Contact", "Human"];
const SEVERITY = { immediate_danger: "Immediate danger", needs_assistance: "Assistance needed", routine: "Routine report", unknown: "Not established" };
const DISTRESS = { high: "High distress", moderate: "Worry expressed", unknown: "Not established" };

function timeLabel(value: string | null | undefined, date = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Date(value).toLocaleString([], { ...(date ? { month: "short", day: "numeric" } as const : {}), hour: "numeric", minute: "2-digit" });
}

function actionFor(check: CheckWithClient, mode: EventMode) {
  if (check.status === "handled") return { title: "Human follow-up recorded", detail: "The operator marked this case handled. Review the saved evidence below." };
  const transfer = check.nurse_transfer?.call_id === check.last_call_id ? check.nurse_transfer : null;
  if (transfer?.status === "started") return { title: "Nurse connection in progress", detail: "A phone transfer was requested. A human connection has not been confirmed." };
  if (transfer?.status === "connected") return { title: "Confirm the human follow-up", detail: "The call was connected. The operator still needs to confirm who answered and the next step." };
  if (transfer?.status === "failed" || transfer?.status === "ended_unconfirmed") return { title: "Follow up after the transfer", detail: "A human connection was not confirmed. Review the caller’s needs and arrange the next contact." };
  if (check.flag_reason === "unreachable" || (check.status === "needs_human" && check.ladder_step === 4)) return { title: "Review this unreachable patient", detail: mode === "crisis" ? "Confirm the attempted contacts and decide whether to report the patient to local officials." : "The contact attempts did not establish the patient’s status. A person needs to follow up." };
  if (check.status === "needs_human") return { title: mode === "daily" && check.urgency !== "urgent" ? "Review the post-op check-in" : "Human response needed", detail: mode === "crisis" ? "Use the reported situation to decide the response. The operator arranges any care or evacuation help." : "Review the patient’s words and decide the next step. The AI does not provide medical advice." };
  if (check.status === "no_answer") return { title: "Continue the contact attempts", detail: "No response has been confirmed. The follow-up sequence remains open." };
  if (check.status === "calling" || check.status === "queued") return { title: "Await a patient response", detail: "Current wellbeing is unknown until a response is recorded and reviewed." };
  return { title: mode === "daily" ? "Review the recorded response" : "Response recorded", detail: "A caller report does not establish medical wellbeing. The operator decides if any follow-up is needed." };
}

function statusLabel(check: CheckWithClient, mode: EventMode) {
  if (check.status === "needs_human") return check.urgency === "urgent" || mode === "crisis" ? "Needs a human" : "Nurse review";
  return { queued: "Queued", calling: "Calling", ok: mode === "crisis" ? "Reports okay" : "Response recorded", no_answer: "Not reached", handled: "Handled" }[check.status];
}

export function PatientWorkspace({ check, mode, busy, onHandled, onAdvance, onReview, mockMode, allowAdvance = true }: Props) {
  const [selection, setSelection] = useState<{ checkId: string; tab: Tab } | null>(null);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>({ key: "" });
  const [refresh, setRefresh] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const tabId = useId();
  const checkId = check?.id;
  const callId = check?.last_call_id;
  const updatedAt = check?.updated_at;
  const evidenceKey = `${checkId ?? ""}:${callId ?? ""}`;
  const tab = selection && selection.checkId === checkId ? selection.tab : "evidence";
  const evidence = evidenceState.key === evidenceKey ? evidenceState.data : undefined;
  const evidenceError = evidenceState.key === evidenceKey ? evidenceState.error : undefined;

  useEffect(() => {
    if (!checkId) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let active = true;
    void fetch(`/api/checks/${encodeURIComponent(checkId)}/evidence`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ApiResult<SavedEvidence>;
        if (!response.ok || !result.ok) throw new Error("Saved call evidence could not be loaded.");
        if (result.data.checkId !== checkId || result.data.callId !== (callId ?? null)) throw new Error("The current call changed. Refresh its evidence.");
        if (active) setEvidenceState({ key: evidenceKey, data: result.data });
      })
      .catch(() => { if (active) setEvidenceState({ key: evidenceKey, error: "Saved evidence is unavailable right now. The patient record above is still visible." }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [checkId, callId, updatedAt, evidenceKey, refresh]);

  useEffect(() => {
    if (!checkId || !callId || callId.startsWith("mock_")) return;
    const timer = window.setInterval(() => setRefresh(value => value + 1), 2500);
    return () => window.clearInterval(timer);
  }, [checkId, callId]);

  if (!check) return <aside className="pw pw-empty" aria-label="Patient workspace"><div className="pw-empty-icon"><UserRound size={25} strokeWidth={1.4} /></div><span className="pw-eyebrow">PATIENT WORKSPACE</span><h2>Select a patient</h2><p>See their reported situation, exact words, and next human action here.</p><span className="pw-empty-hint">Choose a patient from the response queue.</span></aside>;

  const client = check.client;
  const emergencyContactLabel = /^Fictional replay contact \[[0-9a-f-]{36}\]$/i.test(client.emergency_contact_name)
    ? "Designated emergency contact (fictional)" : client.emergency_contact_name || "Held by agency";
  const notificationLabel = check.sms_status === "coordinator alert simulated (MOCK MODE; no message sent)"
    ? "Demo alert recorded; no message sent" : check.sms_status?.replaceAll("_", " ") || "No delivery recorded";
  const assessment = check.priority_assessment;
  const action = actionFor(check, mode);
  const currentPostop = check.postop_assessment?.call_id === check.last_call_id ? check.postop_assessment : null;
  const transfer = check.nurse_transfer?.call_id === check.last_call_id ? check.nurse_transfer : null;
  const acoustic = check.acoustic_assessment?.call_id === check.last_call_id ? check.acoustic_assessment : null;
  const acousticLabel = acoustic?.result.status === "available" ? acoustic.result.signal === "elevated" ? "Elevated expression signal" : "Expression uncertain" : "No usable recording assessment";
  const urgent = check.status !== "handled" && (assessment?.situation === "immediate_danger" || check.urgency === "urgent");
  const canHandle = check.status === "needs_human" || check.status === "no_answer";
  const transferLabel = transfer ? { started: "Transfer requested", connected: "Human connected", failed: "Transfer failed", ended_unconfirmed: "Connection unconfirmed" }[transfer.status] : "No transfer recorded";
  const prior = evidence?.priorDaily;
  const chosenTab = `${tabId}-${tab}`;

  const conversation = <section className="pw-section pw-transcript"><div className="pw-section-heading"><h3><MessageSquareText size={14} />{evidence?.source === "live_rehearsal" ? "Live conversation" : "Saved call transcript"}</h3><button className="pw-icon-button" aria-label="Refresh saved call evidence" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={13} /></button></div>
          {evidence?.recordingAvailable && evidence.audioUrl ? <div className="pw-call-audio"><strong>Hear the actual conversation</strong><audio key={`${checkId}:${callId}`} aria-label={`${client.name} recorded call`} controls preload="none" src={evidence.audioUrl} onError={() => setAudioError(checkId ?? null)} onCanPlay={() => setAudioError(null)} /><p>{evidence.callKind === "teammate_rehearsal" ? "Real AI-to-teammate practice call. The resident and disaster are fictional." : "Recording from this saved call."}</p>{audioError === checkId && <p role="status">Recording could not load. Refresh the evidence and try again.</p>}</div> : <p className="pw-audio-pending">{evidence?.callKind === "teammate_rehearsal" ? "The recording appears here after the call finishes and the provider makes it available." : "Sample transcript · no recorded audio. Use the real phone rehearsal to capture a conversation."}</p>}
          {evidenceError ? <div className="pw-evidence-error" role="status"><p>{evidenceError}</p><button onClick={() => setRefresh((value) => value + 1)}>Try again<ArrowRight size={12} /></button></div> : !evidence ? <p className="pw-muted" role="status">Loading saved call evidence…</p> : evidence.source === "none" ? <div className="pw-transcript-empty"><FileText size={20} /><p>No analyzed transcript has been saved for this call.</p><small>Transcript evidence appears after it is received and stored.</small></div> : <>
            <p className="pw-source-line">{evidence.callKind === "teammate_rehearsal" ? "Real teammate conversation" : evidence.simulated ? "Sample conversation" : "Stored call record"}<span>·</span>{evidence.target === "emergency_contact" ? "Emergency contact" : "Patient"}<span>·</span>{timeLabel(evidence.recordedAt)}</p>
            {evidence.turns.length ? <ol className="pw-transcript-turns">{evidence.turns.map((turn, index) => <li className={turn.role === "user" ? "pw-caller-turn" : ""} key={index}><span>{turn.role === "agent" ? "Heartbeat" : evidence.target === "emergency_contact" ? "Contact" : "Patient"}</span><p>{turn.content}</p></li>)}</ol> : evidence.transcript ? <p className="pw-plain-transcript">{evidence.transcript}</p> : <p className="pw-muted">The saved call record contains no transcript text.</p>}
          </>}
        </section>;

  return <aside className={`pw ${urgent ? "pw-urgent" : ""}`} aria-label={`${client.name} patient workspace`}>
    <header className="pw-header">
      <div className="pw-header-top"><span className="pw-eyebrow">PATIENT WORKSPACE</span><span className={`pw-status pw-status-${check.status}`}>{statusLabel(check, mode)}</span></div>
      <div className="pw-person"><span className="pw-avatar" aria-hidden="true">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><h2>{client.name}</h2><p>{client.language === "ko" ? "Korean requested" : client.language === "es" ? "Spanish requested" : client.language && client.language !== "en" ? `${client.language} requested` : "English"}<span>·</span>{evidence?.callKind === "teammate_rehearsal" ? "Real teammate call · fictional resident" : evidence?.simulated || mockMode ? "Sample resident" : "Agency patient"}</p></div></div>
    </header>

    <section className="pw-next-action" aria-label="Next human action"><div className="pw-section-label"><ArrowRight size={12} />NEXT HUMAN ACTION</div><h3>{action.title}</h3></section>

    <section className="pw-signals" aria-label="Reported severity and expressed distress">
      <div><span>Reported severity</span><strong className={assessment?.situation === "immediate_danger" ? "pw-danger-text" : ""}>{SEVERITY[assessment?.situation ?? "unknown"]}</strong></div>
      <div><span>Expressed distress</span><strong>{DISTRESS[assessment?.distress ?? "unknown"]}</strong></div>
      <p>Severity comes first. Calm does not mean okay.</p>
    </section>

    <div className="pw-tabs" role="tablist" aria-label="Patient information">
      {(["evidence", "followup"] as const).map((item) => <button key={item} id={`${tabId}-${item}`} role="tab" aria-selected={tab === item} aria-controls={`${tabId}-panel`} tabIndex={tab === item ? 0 : -1} onClick={() => setSelection({ checkId: check.id, tab: item })} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "evidence" : event.key === "End" ? "followup" : tab === "evidence" ? "followup" : "evidence"; setSelection({ checkId: check.id, tab: next }); document.getElementById(`${tabId}-${next}`)?.focus(); } }}>{item === "evidence" ? <><FileText size={14} />Evidence</> : <><Route size={14} />Follow-up</>}</button>)}
    </div>

    <div className="pw-scroll" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={chosenTab} tabIndex={0}>
      {tab === "evidence" ? <>
        {evidence?.callKind === "teammate_rehearsal" && conversation}
        <section className="pw-section pw-reported"><div className="pw-section-heading"><h3>What was reported</h3><span>{assessment?.stage === "live" ? "Provisional snapshot" : "Previously recorded"}</span></div>
          {assessment?.evidence.length ? <div className="pw-quotes">{assessment.evidence.map((item, index) => <blockquote key={`${item.kind}-${index}`} className={item.kind === "situation" ? "pw-situation-quote" : "pw-distress-quote"}><span>{item.kind === "situation" ? "SITUATION" : "DISTRESS"}</span><p>“{item.quote}”</p></blockquote>)}</div> : <p className="pw-muted">No supporting caller quote is recorded yet.</p>}
          {check.summary && <div className="pw-summary"><span>Call summary</span><p>{check.summary}</p></div>}
          <div className="pw-voice-signal"><span>Voice expression</span><strong>{acousticLabel}</strong>{acoustic && <small>Post-call model signal · does not establish safety or a diagnosis</small>}</div>
        </section>

        {mode === "daily" ? <div className="pw-postop"><PostOpCheckIn key={`${check.id}-${check.last_call_id}`} assessment={currentPostop} checkId={check.id} busy={busy} handled={check.status === "handled"} onReview={onReview} expanded /></div> : <section className="pw-section pw-daily-context"><div className="pw-section-heading"><h3>{evidence?.priorDailySimulated ? "Sample daily-care context" : "Previously recorded care context"}</h3>{prior && <time dateTime={prior.recordedAt}>{timeLabel(prior.recordedAt, true)}</time>}</div><div className="pw-mobility-fact"><Route size={16} /><div><strong>{client.needs_ride === true ? "Ride assistance is flagged" : "No ride need recorded"}</strong><p>{client.needs_ride === true ? "Saved planning flag. The operator confirms and arranges assistance." : "This does not establish that the patient can leave independently."}</p></div></div>{prior?.rideQuote && <blockquote className="pw-context-quote"><span>Previously recorded transport statement</span><p>“{prior.rideQuote}”</p></blockquote>}{prior?.answers.pain.status === "reported" && <p className="pw-prior-pain">Previously recorded pain <strong>{prior.answers.pain.value}/10</strong>{prior.answers.pain.quote && <span>“{prior.answers.pain.quote}”</span>}</p>}{!prior && <p className="pw-muted">{evidence ? "No earlier post-op record is available." : "Earlier check-in evidence has not loaded."}</p>}</section>}

        {evidence?.callKind !== "teammate_rehearsal" && conversation}

      </> : <>
        <section className="pw-section pw-action-detail"><div className="pw-section-heading"><h3>{action.title}</h3></div><p>{action.detail}</p><p className="pw-muted">Reported severity describes the caller’s situation. Expressed distress is a separate signal from the caller’s words; calm does not establish wellbeing.</p></section>
        <section className="pw-section"><div className="pw-section-heading"><h3>Contact sequence</h3><span>Step {check.ladder_step + 1} of 5</span></div><ol className="pw-ladder" aria-label="Recorded contact stage">{STAGES.map((stage, index) => <li key={stage} className={index === check.ladder_step ? "pw-stage-current" : index < check.ladder_step ? "pw-stage-past" : ""}><span>{index < check.ladder_step ? <Check size={10} /> : index + 1}</span><small>{stage}</small></li>)}</ol><p className="pw-muted">Stages show attempted contact, not confirmation of wellbeing.</p>{check.next_action_at && <p className="pw-next-time"><Clock3 size={13} />Next scheduled step <time dateTime={check.next_action_at}>{timeLabel(check.next_action_at)}</time></p>}</section>
        <section className="pw-section"><div className="pw-section-heading"><h3><PhoneForwarded size={14} />Nurse handoff</h3></div><div className={`pw-handoff pw-handoff-${transfer?.status ?? "none"}`}><span className="pw-handoff-dot" /><strong>{transferLabel}</strong></div><p className="pw-muted">{transfer?.status === "connected" ? "A phone bridge is confirmed. Nurse identity and follow-through require human verification." : transfer?.status === "started" ? "Awaiting a confirmed phone bridge. Do not assume the nurse received the caller." : "The operator chooses and arranges the next contact. No responder has been dispatched by this website."}</p>{transfer && <p className="pw-source-line">Recorded {timeLabel(transfer.updated_at)}</p>}</section>
        <section className="pw-section"><div className="pw-section-heading"><h3>Agency follow-up</h3></div>{check.flag_reason && <p className="pw-flag-reason">{check.flag_reason}</p>}<div className="pw-patient-facts" aria-label="Previously recorded patient context">{client.lives_alone && <span><UserRound size={12} />Lives alone</span>}{client.uses_powered_equipment && <span><Zap size={12} />Powered equipment</span>}{client.needs_ride === true && <span className="pw-transport"><Route size={12} />Ride assistance flagged</span>}</div><dl className="pw-followup-facts"><div><dt>Emergency contact</dt><dd>{emergencyContactLabel}</dd></div><div><dt>Coordinator notification</dt><dd>{notificationLabel}</dd></div><div><dt>Previously recorded transport need</dt><dd>{client.needs_ride === true ? "Ride assistance flagged" : "Not established by this record"}</dd></div></dl></section>
      </>}
      <div className="pw-record-stamp"><span>{check.status === "handled" ? "Human follow-up recorded" : "Latest record update"}</span><time dateTime={check.updated_at}>{timeLabel(check.updated_at)}</time></div>
    </div>

    <footer className="pw-footer">
      {canHandle && <div className="pw-actions">{allowAdvance && mockMode && check.status === "no_answer" && check.ladder_step < 4 && <button className="pw-secondary-action" disabled={busy} onClick={() => onAdvance(check.id)}>Advance demo<ArrowRight size={13} /></button>}<button className="pw-primary-action" disabled={busy} onClick={() => onHandled(check.id)}><ClipboardCheck size={15} />{busy ? "Saving…" : "Mark handled"}</button></div>}
      {canHandle ? <p>Records follow-up; does not dispatch help.</p> : <div className="pw-updated"><span>{check.status === "handled" ? "Human follow-up recorded" : "Latest record update"}</span><time dateTime={check.updated_at}>{timeLabel(check.updated_at)}</time></div>}
    </footer>
  </aside>;
}
