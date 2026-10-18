"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, PhoneCall, RefreshCw } from "lucide-react";
import type { ApiResult } from "@/lib/types";
import "./rehearsal-controls.css";

type RehearsalState = {
  checkId: string;
  refreshPending?: boolean;
  readiness: { configured: boolean; missing: string[] };
  call: null | { requestId: string; callId: string | null; status: string; updatedAt: string; turns: { role: "agent" | "user"; content: string }[]; transcript: string | null; recordingAvailable: boolean; audioUrl: string | null; simulated: false };
};
type Props = { sessionId: string; eventId: string; checkId: string; name: string; replayComplete: boolean; onRefresh: () => void };
const STATUS: Record<string, string> = { reserved: "Call request saved", requested: "Calling your teammate", ongoing: "Conversation in progress", ended: "Call ended · analysis processing", analyzed: "Conversation saved", unknown: "Call status needs checking", error: "Call could not be confirmed" };

export function RehearsalControls({ sessionId, eventId, checkId, name, replayComplete, onRefresh }: Props) {
  const [state, setState] = useState<RehearsalState | null>(null);
  const [token, setToken] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
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
      const update = result.data.call?.updatedAt;
      if (update && update !== latestUpdate.current) { latestUpdate.current = update; onRefresh(); }
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Rehearsal status is unavailable."); }
  }, [checkId, onRefresh]);
  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => { void load(controller.signal); }, 0);
    const timer = window.setInterval(() => { void load(controller.signal); }, 2500);
    return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function begin() {
    if (!current?.readiness.configured || !consent || !token || !replayComplete || current.call) return;
    if (request.current?.checkId !== checkId) request.current = { checkId, id: crypto.randomUUID() };
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/demo/rehearsal", { method: "POST", headers: { "Content-Type": "application/json", "X-Heartbeat-Presenter-Token": token }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ sessionId, eventId, checkId, requestId: request.current.id, confirmed: true }) });
      const result = await response.json() as ApiResult<unknown>;
      if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : "The call could not be requested.");
      setToken(""); onRefresh(); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Call status is uncertain. Refresh before taking another action."); await load(); }
    finally { setPending(false); }
  }
  const call = current?.call;
  const ready = current?.readiness.configured === true;
  const phoneMissing = current?.readiness.missing.includes("HEARTBEAT_REHEARSAL_PHONE");
  return <section className="rc-panel" aria-label="Real phone rehearsal">
    <div className="rc-heading"><span><PhoneCall size={15} />REAL PHONE REHEARSAL</span><button aria-label="Refresh rehearsal readiness" onClick={() => { setError(null); void load(); }}><RefreshCw size={13} /></button></div>
    {call ? <>
      <strong className="rc-call-status"><i className={call.status === "ongoing" && !current?.refreshPending ? "active" : ""} />{current?.refreshPending ? "Connection interrupted · showing saved evidence" : STATUS[call.status] || "Checking call status"}</strong>
      {current?.refreshPending && <p className="rc-note">The call’s current state is unconfirmed. Last saved update: {new Date(call.updatedAt).toLocaleTimeString()}. Follow-up remains open.</p>}
      <p>This rehearsal uses a real phone call for {name}’s fictional case. The other residents remain samples.</p>
      <div className="rc-receipts"><span className={call.turns.length ? "complete" : ""}><Check size={12} />{call.turns.length ? `${call.turns.length} conversation turns saved` : "Waiting for conversation"}</span><span className={call.recordingAvailable ? "complete" : ""}><Check size={12} />{call.recordingAvailable ? "Recording available below" : "Recording available after the call"}</span></div>
      {["unknown", "error"].includes(call.status) && <p className="rc-note">Keep this case open. Check the existing attempt before starting another scenario.</p>}
    </> : <>
      <h3>Let a real conversation change this case.</h3>
      <p>Your teammate plays {name.split(" ")[0]}. Their phone conversation will supply the transcript and recording here.</p>
      {!replayComplete && <p className="rc-note">Finish the sample walkthrough using Next, then start the real rehearsal.</p>}
      {current && !ready && <p className="rc-note">{phoneMissing && current.readiness.missing.length === 1 ? "Voice setup is ready. Add the consenting teammate’s test number when you meet." : phoneMissing ? "The test phone number will be added when you meet. Voice setup is being prepared." : "Voice setup needs attention before a real call can start."}</p>}
      <details className="rc-setup"><summary>Presenter setup <ChevronDown size={13} /></summary><label>Presenter key<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Private rehearsal key" /></label><p className="rc-setup-hint">Calls go only to the test phone configured for this rehearsal.</p><label className="rc-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />My teammate is ready and agrees to this recorded practice call.</label></details>
      <button className="rc-call" onClick={() => { void begin(); }} disabled={!ready || !replayComplete || !token || !consent || pending}>{pending ? "Requesting one call…" : "Call my teammate"}<PhoneCall size={14} /></button>
      <small>One real participant per scenario. This does not call the sample roster.</small>
    </>}
    {error && <p className="rc-error" role="alert">{error}</p>}
  </section>;
}
