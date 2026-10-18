"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, AudioLines, Check as CheckIcon, ChevronRight, Download, HeartPulse, Phone, Play, Radio, RotateCcw, Search, Sun, Users, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAMPLE_ALERT } from "@/lib/mode";
import { sortChecksForDashboard } from "@/lib/priority-ordering";
import type { ApiResult, Check, CheckWithClient, Client, EventMode, HeartbeatEvent } from "@/lib/types";
import { OperationsMap } from "./operations/OperationsMap";
import { PatientWorkspace } from "./operations/PatientWorkspace";
import { RehearsalControls } from "./operations/RehearsalControls";
import "./heartbeat.css";
import "./operations/operations.css";
import "./operations/smoove.css";

type Data = { event: HeartbeatEvent | null; checks: CheckWithClient[] };
type Health = { database: boolean; mockMode: boolean; fictionalData: boolean; retell: { configured: boolean; missing: string[] }; sms: { configured: boolean; missing: string[] }; note: string };
type Demo = { sessionId: string; eventId: string; dailyEventId: string; step: number; totalSteps: number; label: string; done: boolean; focusClientId?: string; simulated: boolean };
type Filter = "all" | "attention" | "transport" | "unreached" | "review";
const DEMO_SESSION_KEY = "heartbeat-smoove-scenario";
type View = "conversation" | "evidence" | "followup";
async function post<T = unknown>(url: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : `Request failed (${response.status})`);
  return result.data;
}
async function fetchDashboard(mode: EventMode, pinnedEventId?: string): Promise<Data> {
  const db = supabaseBrowser(); const signal = AbortSignal.timeout(8000);
  let eventQuery = db.from("events").select("*").in("type", mode === "crisis" ? ["crisis", "heat_wave"] : ["daily"]);
  if (pinnedEventId) eventQuery = eventQuery.eq("id", pinnedEventId);
  const { data: event, error } = await eventQuery.order("started_at", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { event: null, checks: [] };
  const [{ data, error: checksError }, { data: clients, error: clientsError }] = await Promise.all([
    db.from("checks").select("*").eq("event_id", event.id).abortSignal(signal), db.from("clients_public").select("*").abortSignal(signal),
  ]);
  if (checksError || clientsError) throw new Error(checksError?.message || clientsError?.message);
  const roster = new Map(((clients ?? []) as Omit<Client, "phone" | "emergency_contact_phone">[]).map(client => [client.id, { ...client, phone: "", emergency_contact_phone: "" }]));
  return { event: event as HeartbeatEvent, checks: ((data ?? []) as Check[]).flatMap(check => { const client = roster.get(check.client_id); return client ? [{ ...check, client }] : []; }) };
}
function status(check: CheckWithClient) {
  if (check.status === "handled") return { label: "Follow-up recorded", tone: "resolved" };
  if (check.priority_assessment?.situation === "immediate_danger") return { label: "Immediate attention", tone: "urgent" };
  if (check.status === "needs_human") return { label: check.urgency === "urgent" ? "Human review needed" : "Follow-up needed", tone: check.urgency === "urgent" ? "urgent" : "waiting" };
  return { calling: { label: "Call in progress", tone: "calling" }, queued: { label: "Waiting to call", tone: "neutral" }, no_answer: { label: "Not reached yet", tone: "waiting" }, ok: { label: "Response recorded", tone: "resolved" } }[check.status];
}
function initialName(name: string) { return name.split(" ").slice(0, 2).map(n => n[0]).join(""); }
function exportReport(checks: CheckWithClient[], event: HeartbeatEvent | null, simulated: boolean) {
  const rows = [["Dataset", "Event ID", "Event type", "Patient", "Recorded transport need", "Outreach status", "Last update", "Reported concern"]];
  for (const check of checks.filter(c => c.client.needs_ride || c.status === "no_answer" || c.flag_reason?.includes("unreachable") || c.ladder_step === 4)) rows.push([simulated ? "SIMULATED / FICTIONAL — NOT FOR DISPATCH" : "Agency records — human review required", event?.id ?? "", event?.type ?? "", check.client.name, check.client.needs_ride ? "Needs transport assistance; operator assessment required" : "Not established", check.flag_reason?.includes("unreachable") || check.ladder_step === 4 ? "Unreachable after contact attempts" : status(check).label, check.updated_at, check.flag_reason || check.summary || "Unknown"]);
  const csv = rows.map(row => row.map(cell => `"${(/^[=+@\-\t\r]/.test(cell) ? "'" : "") + cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = simulated ? "heartbeat-simulated-assistance-review.csv" : "heartbeat-assistance-review.csv"; anchor.click(); URL.revokeObjectURL(url);
}

export function Dashboard({ agencyName, mockMode, fictionalData, liveMapUrl }: { agencyName: string; mockMode: boolean; fictionalData: boolean; liveMapUrl?: string }) {
  const [mode, setMode] = useState<EventMode>("crisis"); const modeRef = useRef(mode);
  const [event, setEvent] = useState<HeartbeatEvent | null>(null); const [checks, setChecks] = useState<CheckWithClient[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null); const [connection, setConnection] = useState("connecting"); const [lastSync, setLastSync] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [filter, setFilter] = useState<Filter>("all"); const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false); const [dialogOpen, setDialogOpen] = useState(false); const [alertText, setAlertText] = useState(SAMPLE_ALERT); const [showAlert, setShowAlert] = useState(false);
  const [view, setView] = useState<View>("conversation");
  const [reveal, setReveal] = useState<{ eventId: string; count: number } | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null); const [demoBusy, setDemoBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null); const loadId = useRef(0); const demoRequest = useRef<string | null>(null);
  const pinnedEvents = useRef<Partial<Record<EventMode, string>> | null>(null);
  const caseBody = useRef<HTMLDivElement>(null);
  const roundVersion = useRef(0);
  const roundRequest = useRef<{ type: EventMode; alert: string; id: string } | null>(null);
  const isMock = health?.mockMode ?? mockMode; const isFictional = health?.fictionalData ?? fictionalData;
  const eventId = event?.id;
  const isReplayEvent = event?.alert_text?.startsWith("SIMULATED DISASTER REPLAY") ?? false;
  const load = useCallback(async (requestedMode: EventMode = modeRef.current) => {
    if (requestedMode !== modeRef.current) return;
    // The experiment never adopts another tab’s newest campaign.
    if (mockMode && !pinnedEvents.current?.[requestedMode]) { setEvent(null); setChecks([]); setLoading(false); return; }
    const id = ++loadId.current;
    const pinnedEventId = pinnedEvents.current?.[requestedMode];
    try { const data = await fetchDashboard(requestedMode, pinnedEventId); if (id !== loadId.current || requestedMode !== modeRef.current || pinnedEventId !== pinnedEvents.current?.[requestedMode]) return; setEvent(data.event); setChecks(data.checks); setConnectionError(null); setLastSync(new Date().toISOString()); }
    catch { if (id === loadId.current) { setConnection("polling"); setConnectionError("Connection interrupted. Displaying the last received records."); } }
    finally { if (id === loadId.current) setLoading(false); }
  }, [mockMode]);
  useEffect(() => {
    if (!mockMode) return;
    let cancelled = false;
    const version = roundVersion.current;
    const restore = window.setTimeout(async () => {
      try {
        const saved = sessionStorage.getItem(DEMO_SESSION_KEY);
        if (!saved) return;
        const { sessionId, eventId } = JSON.parse(saved) as { sessionId?: string; eventId?: string };
        if (!sessionId || !eventId) return;
        const result = await post<Demo>("/api/demo/disaster", { action: "status", sessionId, eventId });
        if (cancelled || version !== roundVersion.current) return;
        pinnedEvents.current = { daily: result.dailyEventId, crisis: result.eventId };
        setDemo(result);
        const restored = await fetchDashboard("crisis", result.eventId);
        setSelectedId(restored.checks.find(c => c.client.name === "Rosa Alvarez")?.client_id ?? null);
        await load();
      } catch { try { sessionStorage.removeItem(DEMO_SESSION_KEY); } catch { /* Storage is optional. */ } }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(restore); };
  }, [load, mockMode]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0); const grace = window.setTimeout(() => setConnection(value => value === "connecting" ? "polling" : value), 5000);
    let remove: (() => void) | undefined; let refreshTimer: number | undefined;
    try { const db = supabaseBrowser(); const refresh = () => { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => { void load(); }, 80); };
      const channel = db.channel("heartbeat-operations").on("postgres_changes", { event: "*", schema: "public", table: "events" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "checks" }, refresh).subscribe(state => { if (state === "SUBSCRIBED") { setConnection("realtime"); void load(); } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) setConnection("polling"); });
      remove = () => { void db.removeChannel(channel); };
    } catch { queueMicrotask(() => setConnection("polling")); }
    return () => { window.clearTimeout(initial); window.clearTimeout(grace); window.clearTimeout(refreshTimer); remove?.(); };
  }, [load]);
  useEffect(() => { if (connection !== "polling") return; const timer = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(timer); }, [connection, load]);
  useEffect(() => { let active = true; void fetch("/api/health", { cache: "no-store" }).then(r => r.json()).then((r: ApiResult<Health>) => { if (active && r.ok) setHealth(r.data); }).catch(() => undefined); return () => { active = false; }; }, []);
  useEffect(() => { if (dialogOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [dialogOpen]);
  useEffect(() => {
    if (!eventId || isReplayEvent || !pinnedEvents.current?.[mode]) return;
    let ticking = false; const timer = window.setInterval(async () => { if (ticking) return; ticking = true; try { await post("/api/ladder/tick"); } catch { /* Connection state is shown separately. */ } finally { ticking = false; } }, 5000);
    return () => window.clearInterval(timer);
  }, [eventId, isReplayEvent, mode]);
  const selectPatient = useCallback((id: string) => { setSelectedId(id); caseBody.current?.scrollTo({ top: 0 }); }, []);
  function changeView(next: View) { setView(next); caseBody.current?.scrollTo({ top: 0 }); }
  const refreshRecords = useCallback(() => { void load(); }, [load]);
  function changeMode(next: EventMode) { if (next === mode) return; setView(next === "daily" ? "evidence" : "conversation"); modeRef.current = next; setMode(next); setFilter("all"); setQuery(""); setChecks([]); setEvent(null); setLoading(true); setShowAlert(false); void load(next); }
  async function startRound(type: EventMode) {
    roundVersion.current += 1;
    setStarting(true); setError(null);
    const alert = type === "crisis" ? alertText : "";
    if (roundRequest.current?.type !== type || roundRequest.current.alert !== alert) roundRequest.current = { type, alert, id: crypto.randomUUID() };
    try { const result = await post<{ event: HeartbeatEvent }>("/api/events/start", { type, request_id: roundRequest.current.id, ...(type === "crisis" ? { alert_text: alert } : {}) }, 310000); roundRequest.current = null; setDemo(null); pinnedEvents.current = { ...pinnedEvents.current, [type]: result.event.id }; try { sessionStorage.removeItem(DEMO_SESSION_KEY); } catch { /* Storage is optional. */ } setDialogOpen(false); setFilter("all"); await load(); }
    catch (err) { setError(err instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(err.name) ? "Outreach may still be starting. Retry the same request to recover its status without creating another round." : err instanceof Error ? err.message : "Outreach could not start."); } finally { setStarting(false); }
  }
  async function act(url: string, id: string) { setPending(id); try { await post(url); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Action could not be saved."); } finally { setPending(null); } }
  async function reviewPostOp(id: string, callId: string, reviewer: string) { setPending(id); try { await post(`/api/checks/${id}/postop-review`, { call_id: callId, reviewer }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Review could not be saved."); throw err; } finally { setPending(null); } }
  async function startDemo() {
    if (demoBusy || starting) return;
    roundVersion.current += 1;
    setDemoBusy(true); setError(null); modeRef.current = "crisis"; setMode("crisis"); setFilter("all"); setQuery(""); setView("conversation");
    demoRequest.current ||= crypto.randomUUID();
    try {
      let result = await post<Demo>("/api/demo/disaster", { action: "start", sessionId: demoRequest.current }, 120000);
      // Prepare the fictional context before a real call can begin. There is no
      // replay timer capable of changing selection or overwriting that call.
      while (!result.done) result = await post<Demo>("/api/demo/disaster", { action: "step", sessionId: result.sessionId, eventId: result.eventId, step: result.step + 1 }, 120000);
      pinnedEvents.current = { daily: result.dailyEventId, crisis: result.eventId };
      const data = await fetchDashboard("crisis", result.eventId);
      setDemo(result); setEvent(data.event); setChecks(data.checks); setLoading(false);
      setSelectedId(data.checks.find(c => c.client.name === "Rosa Alvarez")?.client_id ?? null);
      setReveal({ eventId: result.eventId, count: 0 });
      try { sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ sessionId: result.sessionId, eventId: result.eventId })); } catch { /* Storage is optional. */ }
      demoRequest.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : "The scenario could not be prepared. Retry to recover the same scenario."); }
    finally { setDemoBusy(false); }
  }
  const revealCount = reveal && reveal.eventId === eventId ? reveal.count : checks.length;
  useEffect(() => {
    if (!eventId || revealCount >= checks.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setReveal({ eventId, count: reduced ? checks.length : revealCount + 1 }), reduced ? 0 : 125);
    return () => window.clearTimeout(timer);
  }, [eventId, revealCount, checks.length]);
  const pendingReview = (check: CheckWithClient) => check.status !== "handled" && check.postop_assessment?.call_id === check.last_call_id && check.postop_assessment?.suggested_next_step.status === "proposed";
  const allSorted = sortChecksForDashboard(checks, mode);
  const visible = allSorted.filter(c => (filter === "attention" ? c.status === "needs_human" : filter === "transport" ? c.client.needs_ride : filter === "unreached" ? ["queued", "calling", "no_answer"].includes(c.status) || c.flag_reason?.includes("unreachable") : filter === "review" ? pendingReview(c) : true) && `${c.client.name} ${c.flag_reason ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const selected = allSorted.find(c => c.client_id === selectedId) ?? visible[0] ?? null;
  const counts = { attention: checks.filter(c => c.status === "needs_human").length, transport: checks.filter(c => c.client.needs_ride).length, unreached: checks.filter(c => ["queued", "calling", "no_answer"].includes(c.status) || c.flag_reason?.includes("unreachable")).length, outcomes: checks.filter(c => !["queued", "calling"].includes(c.status)).length, review: checks.filter(pendingReview).length };
  const activeDemo = demo && mode === "crisis" && event?.id === demo.eventId;
  const shownOnMap = visible.filter(c => checks.slice(0, revealCount).some(known => known.id === c.id));
  const flow = [{ id: "conversation" as const, name: "Call", detail: "Hear the person", icon: Phone }, { id: "evidence" as const, name: "Review", detail: "Understand the need", icon: AudioLines }, { id: "followup" as const, name: "Follow up", detail: "Decide the next action", icon: CheckIcon }];
  return <main className={`ops-app sm-app ops-${mode}`}>
    <header className="sm-topbar">
      <Link href="/" className="ops-brand"><span><HeartPulse size={22} /></span>heartbeat<span className="ops-brand-dot">.</span></Link>
      <nav className="sm-modes" aria-label="Workspace"><button disabled={demoBusy || starting} aria-pressed={mode === "daily"} onClick={() => changeMode("daily")}><Sun size={15} />Everyday care</button><button disabled={demoBusy || starting} aria-pressed={mode === "crisis"} onClick={() => changeMode("crisis")}><Radio size={15} />Crisis response</button></nav>
      <div className="sm-account"><span className="sm-avatar">{initialName(agencyName)}</span><span>{agencyName}<small>Care coordinator</small></span></div>
    </header>
    <section className="sm-mission">
      <div><div className="sm-eyebrow"><span className="sm-dot" />{mode === "crisis" ? "WEST ALTADENA, LOS ANGELES" : "POST-OPERATIVE FOLLOW-UP"}</div><h1>{mode === "crisis" ? "Every person. A way forward." : "A check-in becomes a next step."}</h1><p>{mode === "crisis" ? "See who needs help. Hear their story. Decide what happens next." : "The same patients, before the crisis. Review their daily care and changing needs."}</p></div>
      <div className="sm-mission-actions">{isMock && mode === "daily" && demo ? <span className="sm-scenario-badge"><span />Prior daily care · {checks.length} residents</span> : isMock && mode === "crisis" ? activeDemo ? <span className="sm-scenario-badge"><span />Fictional wildfire · {checks.length} residents</span> : <button className="sm-primary" disabled={demoBusy || starting} onClick={() => { void startDemo(); }}><Play size={15} />{demoBusy ? "Preparing the community…" : "Start disaster demo"}<ArrowRight size={15} /></button> : <button className="sm-primary" disabled={starting || demoBusy} onClick={() => mode === "crisis" ? setDialogOpen(true) : void startRound("daily")}><Phone size={15} />{starting ? "Starting…" : mode === "crisis" ? "Start crisis outreach" : "Run morning check-ins"}</button>}
      <details className="sm-tools"><summary aria-label="Scenario tools">•••</summary><div>{isMock && <button disabled={demoBusy || starting} onClick={() => { void startDemo(); }}><RotateCcw size={13} />New demo scenario</button>}<button disabled={starting || demoBusy} onClick={() => setDialogOpen(true)}><Radio size={13} />Outreach settings</button><button disabled={!checks.length} onClick={() => exportReport(checks, event, isMock || isFictional || isReplayEvent)}><Download size={13} />Export assistance list</button></div></details></div>
    </section>
    {(error || connectionError) && <div className="ops-error" role="alert"><span>{error || connectionError}</span><button onClick={() => { void load(); }}>Refresh records</button><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
    {demoBusy && <div className="sm-preparing" role="status"><span />Preparing fictional residents and their care context. No phone calls are placed.</div>}
    <div className="sm-workspace">
      <section className="sm-community" aria-label="Community and patient selection">
        <div className="sm-section-heading"><div><span className="sm-step-number">01</span><h2>The community</h2><span className="sm-count">{checks.length} people</span></div><span className="sm-live"><i className={connection === "realtime" ? "connected" : ""} />{connection === "realtime" ? "Records connected" : "Syncing records"}</span></div>
        <div className="sm-map"><OperationsMap checks={shownOnMap} selectedId={selected?.client_id ?? null} eventId={event?.id ?? null} mode={mode} mapUrl={liveMapUrl} onSelect={selectPatient} /></div>
        <div className="sm-stats" aria-label="Filter residents"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}><strong>{checks.length}</strong><span>Residents</span></button><button aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}><strong className="sm-coral">{counts.attention}</strong><span>Need a human</span></button><button aria-pressed={filter === "transport"} onClick={() => setFilter("transport")}><strong>{counts.transport}</strong><span>Need a ride</span></button><button aria-pressed={filter === "unreached"} onClick={() => setFilter("unreached")}><strong className="sm-amber">{counts.unreached}</strong><span>Not reached</span></button></div>
        <div className="sm-roster-heading"><h3>Choose a person</h3><div className="sm-search"><Search size={13} /><input aria-label="Search patients" placeholder="Find a resident" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
        <div className="sm-roster" aria-label="Patient list">{visible.map(check => { const state = status(check); return <button className={`sm-person ${state.tone}`} key={check.id} aria-pressed={selected?.id === check.id} onClick={() => selectPatient(check.client_id)}><span className="sm-person-avatar">{initialName(check.client.name)}<i /></span><span><strong>{check.client.name}</strong><small>{state.label}</small></span><ChevronRight size={14} /></button>; })}{!visible.length && <div className="sm-empty"><Users size={22} /><p>{loading ? "Loading patient records…" : checks.length ? "No residents match this filter." : "Start the demo to meet the community."}</p>{checks.length > 0 && <button onClick={() => { setFilter("all"); setQuery(""); }}>Show everyone</button>}</div>}</div>
        {mode === "crisis" && event?.alert_text && <div className="sm-briefing"><button onClick={() => setShowAlert(v => !v)} aria-expanded={showAlert}><Radio size={13} />Scenario briefing<ChevronRight size={13} /></button>{showAlert && <p>{event.alert_text}</p>}</div>}
      </section>
      <section className={`sm-case sm-view-${view}`} aria-label="Selected patient call workspace">
        <div className="sm-case-heading"><span className="sm-step-number">02</span><div><span className="sm-eyebrow">ONE CONVERSATION AT A TIME</span><h2>{selected ? `${selected.client.name}’s check-in` : "The person behind the pin"}</h2></div><span className="sm-case-icon"><Phone size={19} /></span></div>
        <nav className="sm-journey" aria-label="Call workflow">{flow.map((item, index) => <button id={`sm-step-${item.id}`} key={item.id} aria-current={view === item.id ? "step" : undefined} disabled={!selected} onClick={() => changeView(item.id)}><span className="sm-journey-icon"><item.icon size={16} /></span><span><strong>{index + 1}. {item.name}</strong><small>{item.detail}</small></span></button>)}</nav>
        <div ref={caseBody} className="sm-case-body">
          {activeDemo && selected && <div hidden={view !== "conversation"}><RehearsalControls key={selected.id} sessionId={demo.sessionId} eventId={demo.eventId} checkId={selected.id} name={selected.client.name} replayComplete={demo.done} onRefresh={refreshRecords} onPause={() => undefined} onPrepared={progress => { setDemo(current => current?.sessionId === progress.sessionId ? progress : current); }} /></div>}
          <PatientWorkspace check={selected} mode={mode} busy={pending === selected?.id} mockMode={isMock} allowAdvance={!isReplayEvent} view={view} onViewChange={changeView} onHandled={id => { void act(`/api/checks/${id}/handled`, id); }} onAdvance={id => { void act(`/api/ladder/advance/${id}`, id); }} onReview={reviewPostOp} />
        </div>
        {selected && <div className="sm-next-step">{view === "conversation" ? <><span>Words become evidence. You make the decision.</span><button onClick={() => changeView("evidence")}>Review this call<ArrowRight size={14} /></button></> : view === "evidence" ? <><span>Severity first. Distress is a separate signal.</span><button onClick={() => changeView("followup")}>Choose the next step<ArrowRight size={14} /></button></> : <><span>Decisions and follow-through stay with your team.</span><button onClick={() => changeView("conversation")}>Back to the call<ArrowRight size={14} /></button></>}</div>}
      </section>
    </div>
    <footer className="sm-footer"><span><i />{isFictional ? "Fictional residents" : "Agency patients"} · {activeDemo ? "Sample context. Teammate calls are labeled separately." : "Human decisions at every step."}</span><span>{lastSync ? `Records updated ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting to records"}</span><button disabled={!checks.length} onClick={() => exportReport(checks, event, isMock || isFictional || isReplayEvent)}><Download size={12} />Export assistance list</button></footer>
    <dialog ref={dialog} className="ops-start-dialog" onClose={() => setDialogOpen(false)} onClick={e => { if (e.target === e.currentTarget && !starting) setDialogOpen(false); }}><div><span className="ops-kicker">START CRISIS OUTREACH</span><button aria-label="Close outreach dialog" disabled={starting} onClick={() => setDialogOpen(false)}><X size={20} /></button></div><Radio size={30} /><h2>One message.<br />Every enrolled patient.</h2><p>The phone agent reads the coordinator’s message exactly, then records who needs assistance.</p><label htmlFor="ops-alert">{alertText === SAMPLE_ALERT ? "Fictional sample alert" : "Coordinator-provided alert"}</label><textarea id="ops-alert" value={alertText} maxLength={1400} rows={6} onChange={e => setAlertText(e.target.value)} /><small>{isMock ? "Demo mode: this creates simulated calls only." : "This requests real calls to the enrolled roster."} Humans decide and arrange any response.</small><button className="ops-button coral" disabled={starting || !alertText.trim()} onClick={() => { void startRound("crisis"); }}>{starting ? "Starting outreach…" : "Start crisis outreach"}<ArrowRight size={16} /></button>{error && <p className="ops-dialog-error" role="alert">{error}</p>}</dialog>
  </main>;
}
