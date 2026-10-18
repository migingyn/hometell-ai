"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Check, PhoneCall, RefreshCw } from "lucide-react";
import type { ApiResult } from "@/lib/types";
import { voiceAnalysisCopy, type VoiceAnalysisState } from "./voice-analysis";
import "./rehearsal-controls.css";

type RehearsalState = {
  checkId: string;
  refreshPending?: boolean;
  readiness: { configured: boolean; missing: string[] };
  call: null | { requestId: string; callId: string | null; status: string; updatedAt: string; turns: { role: "agent" | "user"; content: string }[]; transcript: string | null; recordingAvailable: boolean; audioUrl: string | null; voiceAnalysis?: VoiceAnalysisState | null; simulated: false };
};
type ReplayProgress = { sessionId: string; eventId: string; dailyEventId: string; step: number; totalSteps: number; label: string; done: boolean; focusClientId?: string; simulated: boolean };
type Prepared = { permit: string; expiresAt: number; recipientLabel: string; demo: ReplayProgress; callsPlaced: number };
type Props = { sessionId: string; eventId: string; checkId: string; name: string; replayComplete: boolean; onRefresh: () => void; onPause: () => void; onPrepared: (demo: ReplayProgress) => void };
const STATUS: Record<string, string> = { reserved: "Call request saved", requested: "Calling your teammate", ongoing: "Conversation in progress", ended: "Call ended · analysis processing", analyzed: "Conversation saved", unknown: "Call status needs checking", error: "Call could not be confirmed" };

export function RehearsalControls({ sessionId, eventId, checkId, name, replayComplete, onRefresh, onPause, onPrepared }: Props) {
  const [state, setState] = useState<RehearsalState | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<"prepare" | "call" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ checkId: string; id: string } | null>(null);
  const latestUpdate = useRef<string | null>(null);
  const current = state?.checkId === checkId ? state : null;
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/demo/rehearsal?checkId=${encodeURIComponent(checkId)}`, { cache: "no-store", signal });
      const result = await response.json() as ApiResult<RehearsalState>;
      if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "Could not load rehearsal state.");
      if (signal?.aborted) return;
      setState(result.data);
      const voice = result.data.call?.voiceAnalysis;
      const update = result.data.call ? `${checkId}:${result.data.call.updatedAt}:${voice?.updatedAt ?? ""}:${voice?.status ?? ""}:${voice?.retryPending ?? false}` : null;
      if (update && update !== latestUpdate.current) { latestUpdate.current = update; onRefresh(); }
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Rehearsal status is unavailable."); }
  }, [checkId, onRefresh]);
  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => { void load(controller.signal); }, 0);
    const timer = window.setInterval(() => { void load(controller.signal); }, 2500);
    return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function prepare() {
    if (pending || current?.call) return;
    onPause(); setPending("prepare"); setError(null);
    request.current ||= { checkId, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/demo/rehearsal/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ sessionId, eventId, checkId, requestId: request.current.id, phone }) });
      const result = await response.json() as ApiResult<Prepared>;
      if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "Could not prepare this call.");
      setPrepared(result.data); onPrepared(result.data.demo); onRefresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not prepare the call. No phone call was placed."); }
    finally { setPending(null); }
  }

  async function begin() {
    if (!prepared || !consent || pending || current?.call || !request.current) return;
    if (prepared.expiresAt <= Date.now()) { setPrepared(null); setError("Setup expired. Prepare the call again; no call was placed."); return; }
    setPending("call"); setError(null);
    try {
      const response = await fetch("/api/demo/rehearsal", { method: "POST", headers: { "Content-Type": "application/json", "X-Heartbeat-Rehearsal-Permit": prepared.permit }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ sessionId, eventId, checkId, requestId: request.current.id, confirmed: true }) });
      const result = await response.json() as ApiResult<unknown>;
      if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "The call could not be requested.");
      setPrepared(null); setPhone(""); onRefresh(); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Call status is uncertain. Refresh before taking another action."); await load(); }
    finally { setPending(null); }
  }

  const call = current?.call;
  return <section className="rc-panel" aria-label="Real phone rehearsal">
    <div className="rc-heading"><span><PhoneCall size={15} />REAL PHONE REHEARSAL</span><button aria-label="Refresh rehearsal readiness" onClick={() => { setError(null); void load(); }}><RefreshCw size={13} /></button></div>
    {call ? <>
      <strong className="rc-call-status"><i className={call.status === "ongoing" && !current?.refreshPending ? "active" : ""} />{current?.refreshPending ? "Connection interrupted · showing saved evidence" : STATUS[call.status] || "Checking call status"}</strong>
      {current?.refreshPending && <p className="rc-note">The call’s current state is unconfirmed. Last saved update: {new Date(call.updatedAt).toLocaleTimeString()}. Follow-up remains open.</p>}
      <p>This rehearsal uses a real phone call for {name}’s fictional case. Each resident’s call evidence stays separate.</p>
      <div className="rc-receipts"><span className={call.turns.length ? "complete" : ""}><Check size={12} />{call.turns.length ? `${call.turns.length} conversation turns saved` : "Waiting for conversation"}</span><span className={call.recordingAvailable ? "complete" : ""}><Check size={12} />{call.recordingAvailable ? "Recording available below" : "Recording available after the call"}</span><span className={call.voiceAnalysis?.status === "available" ? "complete" : ""}><AudioLines size={12} />{call.voiceAnalysis ? voiceAnalysisCopy(call.voiceAnalysis).receipt : "Voice analysis follows the call"}</span></div>
      {["unknown", "error"].includes(call.status) && <p className="rc-note">Keep this case open. Check the existing attempt before starting another scenario.</p>}
    </> : <>
      <h3>Let a real conversation change this case.</h3>
      <p>Your teammate plays {name.split(" ")[0]}. Their call supplies the transcript, recording, and an experimental voice-expression analysis after it ends.</p>
      {!setupOpen ? <><button className="rc-call" onClick={() => { onPause(); setSetupOpen(true); setError(null); }}>Set up teammate call<PhoneCall size={14} /></button><small>Enter a test number here. Setup does not place a call.</small></> : <>
        {!prepared ? <form className="rc-setup rc-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
          <label htmlFor={`rehearsal-phone-${checkId}`}>Teammate’s phone number</label>
          <input id={`rehearsal-phone-${checkId}`} type="tel" inputMode="tel" autoComplete="off" required maxLength={40} placeholder="(213) 555-0123 or +country code" value={phone} disabled={Boolean(pending)} onChange={event => { setPhone(event.target.value); request.current = null; }} />
          <p className="rc-setup-hint">10-digit US numbers use +1. Include the country code for other countries.</p>
          {!replayComplete && <p className="rc-note">Preparing finishes the remaining sample steps and keeps {name.split(" ")[0]} selected. No sample residents are called.</p>}
          <button className="rc-call" type="submit" disabled={Boolean(pending)}>{pending === "prepare" ? "Preparing this case…" : "Prepare call"}<PhoneCall size={14} /></button>
          <small>No phone call is placed until you confirm below.</small>
        </form> : <div className="rc-prepared">
          <p className="rc-ready" role="status"><Check size={15} />Ready · {prepared.recipientLabel}</p>
          <label className="rc-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={Boolean(pending)} />My teammate is ready and agrees to this recorded practice call.</label>
          <button className="rc-call" onClick={() => { void begin(); }} disabled={!consent || Boolean(pending)}>{pending === "call" ? "Requesting one call…" : "Call my teammate"}<PhoneCall size={14} /></button>
          {!consent && <p className="rc-setup-hint">Confirm recording consent to enable the call.</p>}
          <button className="rc-change" disabled={Boolean(pending)} onClick={() => { setPrepared(null); setConsent(false); request.current = null; }}>Change phone number</button>
        </div>}
        <small>Calls only the number you enter for this resident. You can call other residents in the same scenario.</small>
      </>}
    </>}
    {error && <p className="rc-error" role="alert">{error}</p>}
  </section>;
}
