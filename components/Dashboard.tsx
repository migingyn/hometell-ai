"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Check as CheckIcon, ChevronRight, Download, HeartPulse, MapPin, Pause, Phone, Play, Radio, RotateCcw, Search, ShieldCheck, Sun, Users, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { SAMPLE_ALERT } from "@/lib/mode";
import { sortChecksForDashboard } from "@/lib/priority-ordering";
import type { ApiResult, Check, CheckWithClient, Client, EventMode, HeartbeatEvent } from "@/lib/types";
import { OperationsMap } from "./operations/OperationsMap";
import { PatientWorkspace } from "./operations/PatientWorkspace";
import { DisasterExperience } from "./operations/DisasterExperience";
import { RehearsalControls } from "./operations/RehearsalControls";
import { request as careRequest } from "@/frontend/api";
import "./heartbeat.css";
import "./operations/operations.css";

type Data = { event: HeartbeatEvent | null; checks: CheckWithClient[] };
type Health = { database: boolean; mockMode: boolean; fictionalData: boolean; retell: { configured: boolean; missing: string[] }; sms: { configured: boolean; missing: string[] }; note: string };
type Demo = { facilityId?: string | null; sessionId: string; eventId: string; dailyEventId: string; step: number; totalSteps: number; label: string; done: boolean; focusClientId?: string; simulated: boolean };
type Filter = "all" | "attention" | "transport" | "unreached" | "review";
const BEATS = ["Calls begin", "Listen & prioritize", "Transport needs", "Retry outreach", "Reach a contact", "Human handoff"];
const DEMO_SESSION_KEY = "heartbeat-disaster-replay";
async function post<T = unknown>(url: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : `Request failed (${response.status})`);
  return result.data;
}
async function fetchDashboard(mode: EventMode, pinnedEventId?: string, facilityId?: string | null): Promise<Data> {
  const db = supabaseBrowser(); const signal = AbortSignal.timeout(8000);
  let eventQuery = db.from("events").select("*").in("type", mode === "crisis" ? ["crisis", "heat_wave"] : ["daily"]);
  if (facilityId && !pinnedEventId) eventQuery = eventQuery.eq("facility_id", facilityId);
  if (pinnedEventId) eventQuery = eventQuery.eq("id", pinnedEventId);
  const { data: event, error } = await eventQuery.order("started_at", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { event: null, checks: [] };
  const [{ data, error: checksError }, { data: clients, error: clientsError }] = await Promise.all([
    db.from("checks").select("*").eq("event_id", event.id).abortSignal(signal), db.from("clients_public").select("*").abortSignal(signal),
  ]);
  if (checksError || clientsError) throw new Error(checksError?.message || clientsError?.message);
  const permitted: {id: string}[] | null = facilityId && !pinnedEventId ? await careRequest(`/api/clients?facility_id=${encodeURIComponent(facilityId)}`) : null;
  const roster = new Map(((clients ?? []) as Omit<Client, "phone" | "emergency_contact_phone">[]).map(client => [client.id, { ...client, phone: "", emergency_contact_phone: "" }]));
  return { event: event as HeartbeatEvent, checks: ((data ?? []) as Check[]).flatMap(check => { const client = roster.get(check.client_id); return client && (!permitted || permitted.some(c => c.id === client.id)) ? [{ ...check, client }] : []; }) };
}
function status(check: CheckWithClient) {
  if (check.status === "handled") return { label: "Follow-up recorded", tone: "resolved" };
  if (check.priority_assessment?.situation === "immediate_danger") return { label: "Immediate attention", tone: "urgent" };
  if (check.status === "needs_human") return { label: check.urgency === "urgent" ? "Human review needed" : "Follow-up needed", tone: check.urgency === "urgent" ? "urgent" : "waiting" };
  return { calling: { label: "Call in progress", tone: "calling" }, queued: { label: "Waiting to call", tone: "neutral" }, no_answer: { label: "Not reached yet", tone: "waiting" }, ok: { label: "Response recorded", tone: "resolved" } }[check.status];
}
function initialName(name: string) { return name.split(" ").slice(0, 2).map(n => n[0]).join(""); }
function quoteFor(check: CheckWithClient) { return check.priority_assessment?.evidence.find(e => e.kind === "situation")?.quote || check.flag_reason || check.summary || "Waiting for a response. Current needs are unknown."; }
function exportReport(checks: CheckWithClient[], event: HeartbeatEvent | null, simulated: boolean) {
  const rows = [["Dataset", "Event ID", "Event type", "Patient", "Recorded transport need", "Outreach status", "Last update", "Reported concern"]];
  for (const check of checks.filter(c => c.client.needs_ride || c.status === "no_answer" || c.flag_reason?.includes("unreachable") || c.ladder_step === 4)) rows.push([simulated ? "SIMULATED / FICTIONAL — NOT FOR DISPATCH" : "Agency records — human review required", event?.id ?? "", event?.type ?? "", check.client.name, check.client.needs_ride ? "Needs transport assistance; operator assessment required" : "Not established", check.flag_reason?.includes("unreachable") || check.ladder_step === 4 ? "Unreachable after contact attempts" : status(check).label, check.updated_at, check.flag_reason || check.summary || "Unknown"]);
  const csv = rows.map(row => row.map(cell => `"${(/^[=+@\-\t\r]/.test(cell) ? "'" : "") + cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = simulated ? "heartbeat-simulated-assistance-review.csv" : "heartbeat-assistance-review.csv"; anchor.click(); URL.revokeObjectURL(url);
}

export function Dashboard({ agencyName, mockMode, fictionalData, liveMapUrl, facilityId, initialMode = "crisis", onSelectResident }: { agencyName: string; mockMode: boolean; fictionalData: boolean; liveMapUrl?: string; facilityId?: string | null; initialMode?: EventMode; onSelectResident?: (id: string) => void }) {
  const demoSessionKey = `${DEMO_SESSION_KEY}:${facilityId||"all"}`;
  const [mode, setMode] = useState<EventMode>(initialMode); const modeRef = useRef(mode);
  const [event, setEvent] = useState<HeartbeatEvent | null>(null); const [checks, setChecks] = useState<CheckWithClient[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null); const [connection, setConnection] = useState("connecting"); const [lastSync, setLastSync] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [filter, setFilter] = useState<Filter>("all"); const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false); const [dialogOpen, setDialogOpen] = useState(false); const [alertText, setAlertText] = useState(SAMPLE_ALERT); const [showAlert, setShowAlert] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [demo, setDemo] = useState<Demo | null>(null); const [playing, setPlaying] = useState(false); const [demoBusy, setDemoBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null); const loadId = useRef(0); const demoRequest = useRef<string | null>(null); const advancing = useRef(false);
  const pinnedEvents = useRef<{ daily: string; crisis: string } | null>(null);
  const roundVersion = useRef(0);
  const roundRequest = useRef<{ type: EventMode; alert: string; id: string } | null>(null);
  const isMock = health?.mockMode ?? mockMode; const isFictional = health?.fictionalData ?? fictionalData;
  const eventId = event?.id;
  const isReplayEvent = event?.alert_text?.startsWith("SIMULATED DISASTER REPLAY") ?? false;
  const load = useCallback(async (requestedMode: EventMode = modeRef.current) => {
    if (requestedMode !== modeRef.current) return;
    const id = ++loadId.current;
    try { const data = await fetchDashboard(requestedMode, pinnedEvents.current?.[requestedMode], facilityId); if (id !== loadId.current || requestedMode !== modeRef.current) return; setEvent(data.event); setChecks(data.checks); setConnectionError(null); setLastSync(new Date().toISOString()); }
    catch { if (id === loadId.current) { setConnection("polling"); setConnectionError("Connection interrupted. Displaying the last received records."); } }
    finally { if (id === loadId.current) setLoading(false); }
  }, [facilityId]);
  useEffect(() => {
    if (!mockMode) return;
    let cancelled = false;
    const version = roundVersion.current;
    const restore = window.setTimeout(async () => {
      try {
        const saved = sessionStorage.getItem(demoSessionKey);
        if (!saved) return;
        const { sessionId, eventId } = JSON.parse(saved) as { sessionId?: string; eventId?: string };
        if (!sessionId || !eventId) return;
        const result = await post<Demo>("/api/demo/disaster", { action: "status", sessionId, eventId });
        if (result.facilityId !== (facilityId||null)) return;
        if (cancelled || version !== roundVersion.current) return;
        pinnedEvents.current = { daily: result.dailyEventId, crisis: result.eventId };
        setDemo(result);
        setPresentation(true);
        await load();
      } catch { try { sessionStorage.removeItem(demoSessionKey); } catch { /* Storage is optional. */ } }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(restore); };
  }, [load, mockMode, facilityId, demoSessionKey]);
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
    if (!eventId || isReplayEvent) return;
    let ticking = false; const timer = window.setInterval(async () => { if (ticking) return; ticking = true; try { await post("/api/ladder/tick"); } catch { /* Connection state is shown separately. */ } finally { ticking = false; } }, 5000);
    return () => window.clearInterval(timer);
  }, [eventId, isReplayEvent]);
  const selectPatient = useCallback((id: string) => { setSelectedId(id); setPlaying(false); onSelectResident?.(id); }, [onSelectResident]);
  const refreshRecords = useCallback(() => { void load(); }, [load]);
  function changeMode(next: EventMode) { if (next === mode) return; setPresentation(false); setPlaying(false); modeRef.current = next; setMode(next); setFilter("all"); setQuery(""); setSelectedId(null); setChecks([]); setEvent(null); setLoading(true); setShowAlert(false); void load(next); }
  async function startRound(type: EventMode) {
    roundVersion.current += 1;
    setStarting(true); setError(null); setPlaying(false);
    const alert = type === "crisis" ? alertText : "";
    if (roundRequest.current?.type !== type || roundRequest.current.alert !== alert) roundRequest.current = { type, alert, id: crypto.randomUUID() };
    try { await post("/api/events/start", { type, facility_id: facilityId || undefined, request_id: roundRequest.current.id, ...(type === "crisis" ? { alert_text: alert } : {}) }, 310000); roundRequest.current = null; setDemo(null); pinnedEvents.current = null; try { sessionStorage.removeItem(demoSessionKey); } catch { /* Storage is optional. */ } setDialogOpen(false); setFilter("all"); await load(); }
    catch (err) { setError(err instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(err.name) ? "Outreach may still be starting. Retry the same request to recover its status without creating another round." : err instanceof Error ? err.message : "Outreach could not start."); } finally { setStarting(false); }
  }
  async function act(url: string, id: string) { setPending(id); try { await post(url); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Action could not be saved."); } finally { setPending(null); } }
  async function reviewPostOp(id: string, callId: string, reviewer: string) { setPending(id); try { await post(`/api/checks/${id}/postop-review`, { call_id: callId, reviewer }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Review could not be saved."); throw err; } finally { setPending(null); } }
  async function startDemo() {
    setPresentation(true);
    roundVersion.current += 1;
    setDemoBusy(true); setPlaying(false); setError(null); modeRef.current = "crisis"; setMode("crisis"); setFilter("all"); setQuery(""); setSelectedId(null); setEvent(null); setChecks([]); setLoading(true);
    demoRequest.current ||= crypto.randomUUID();
    try { const result = await post<Demo>("/api/demo/disaster", { action: "start", sessionId: demoRequest.current, facility_id: facilityId||undefined }); setDemo(result); pinnedEvents.current = { daily: result.dailyEventId, crisis: result.eventId }; try { sessionStorage.setItem(demoSessionKey, JSON.stringify({ sessionId: result.sessionId, eventId: result.eventId })); } catch { /* The replay also works when browser storage is disabled. */ } demoRequest.current = null; await load(); setPlaying(modeRef.current === "crisis"); }
    catch (err) { await load(); setError(err instanceof Error ? err.message : "The demonstration could not start."); } finally { setDemoBusy(false); }
  }
  const advanceDemo = useCallback(async () => {
    if (!demo || demo.done || advancing.current) return; advancing.current = true; setDemoBusy(true);
    try { const result = await post<Demo>("/api/demo/disaster", { action: "step", sessionId: demo.sessionId, eventId: demo.eventId, step: demo.step + 1 }); setDemo(result); if (result.focusClientId) setSelectedId(result.focusClientId); await load("crisis"); if (result.done) setPlaying(false); }
    catch (err) { setPlaying(false); setError(err instanceof Error ? err.message : "Demo paused because the next event could not be saved."); } finally { advancing.current = false; setDemoBusy(false); }
  }, [demo, load]);
  useEffect(() => { if (!playing || !demo || demo.done || demoBusy) return; const timer = window.setTimeout(() => { void advanceDemo(); }, demo.step < 0 ? 1000 : 7000); return () => window.clearTimeout(timer); }, [playing, demo, demoBusy, advanceDemo]);
  const pendingReview = (check: CheckWithClient) => check.status !== "handled" && check.postop_assessment?.call_id === check.last_call_id && check.postop_assessment?.suggested_next_step.status === "proposed";
  const allSorted = sortChecksForDashboard(checks, mode);
  const visible = allSorted.filter(c => (filter === "attention" ? c.status === "needs_human" : filter === "transport" ? c.client.needs_ride : filter === "unreached" ? ["queued", "calling", "no_answer"].includes(c.status) || c.flag_reason?.includes("unreachable") : filter === "review" ? pendingReview(c) : true) && `${c.client.name} ${c.flag_reason ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const selected = visible.find(c => c.client_id === selectedId) ?? visible[0] ?? null;
  const counts = { attention: checks.filter(c => c.status === "needs_human").length, transport: checks.filter(c => c.client.needs_ride).length, unreached: checks.filter(c => ["queued", "calling", "no_answer"].includes(c.status) || c.flag_reason?.includes("unreachable")).length, outcomes: checks.filter(c => !["queued", "calling"].includes(c.status)).length, review: checks.filter(pendingReview).length };
  const recent = [...checks].filter(c => !["queued", "calling"].includes(c.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  const activeDemo = demo && mode === "crisis" && event?.id === demo.eventId;
  const patientPanel = <>{activeDemo && selected && <RehearsalControls key={selected.id} sessionId={demo.sessionId} eventId={demo.eventId} checkId={selected.id} name={selected.client.name} replayComplete={demo.done} onRefresh={refreshRecords} />}<PatientWorkspace check={selected} mode={mode} busy={pending === selected?.id} mockMode={isMock} allowAdvance={!isReplayEvent} onHandled={id => { void act(`/api/checks/${id}/handled`, id); }} onAdvance={id => { void act(`/api/ladder/advance/${id}`, id); }} onReview={reviewPostOp} /></>;
  return <section aria-label="Outreach workspace" className={`ops-app ops-${mode} ${presentation && activeDemo ? "ops-guided" : ""}`}>
    <header className="ops-topbar"><Link href="/" className="ops-brand"><span><HeartPulse size={22} /></span>heartbeat<span className="ops-brand-dot">.</span></Link><span className="ops-brand-caption">CARE, CONNECTED.</span><nav className="ops-mode-nav" aria-label="Workspace"><button aria-pressed={mode === "daily"} onClick={() => changeMode("daily")}><Sun size={15} />Daily care</button><button aria-pressed={mode === "crisis"} onClick={() => changeMode("crisis")}><Radio size={15} />Crisis response</button></nav><div className="ops-account"><span>{isMock ? "SAMPLE SCENARIO" : "PHONE OUTREACH"}</span><div className="ops-agency-avatar">{initialName(agencyName)}</div><strong>{agencyName}</strong></div></header>
    <div className="ops-command-bar"><div><div className="ops-kicker"><span className={mode === "crisis" ? "ops-signal amber" : "ops-signal"} />{mode === "crisis" ? "EMERGENCY OUTREACH" : "POST-OPERATIVE FOLLOW-UP"}<span>/ LOS ANGELES</span></div><h1>{mode === "crisis" ? "A familiar voice. When it matters most." : "Small changes. A clearer next step."}</h1><p>{mode === "crisis" ? "The same people you care for every day. Now, one coordinated response." : "Patient conversations, exact answers, and a nurse behind every decision."}</p></div><div className="ops-command-actions">{isMock && <button className="ops-button secondary" onClick={() => { if (activeDemo) setPresentation(true); else void startDemo(); }} disabled={demoBusy || starting}><Play size={14} />{demoBusy && !demo ? "Preparing demo…" : activeDemo ? "Explore disaster map" : "Play disaster demo"}</button>}<button className={`ops-button ${mode === "crisis" ? "coral" : "primary"}`} disabled={starting || playing || demoBusy} onClick={() => mode === "crisis" ? setDialogOpen(true) : void startRound("daily")}><Phone size={15} />{starting ? "Starting…" : mode === "crisis" ? "Start crisis outreach" : "Run morning check-ins"}<ArrowRight size={15} /></button></div></div>
    {(error || connectionError) && <div className="ops-error" role="alert"><span>{error || connectionError}</span><button onClick={() => { void load(); }}>Refresh records</button><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
    {activeDemo && <section className="ops-replay" aria-label="Disaster demo playback"><div className="ops-replay-controls"><button onClick={() => setPlaying(p => !p)} disabled={demo.done || demoBusy} aria-label={playing ? "Pause disaster demo" : "Resume disaster demo"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><span>SIMULATED SCENARIO<strong>{demo.done ? "Ready for human response" : demo.step < 0 ? "A normal morning becomes a crisis" : demo.label}</strong></span></div><ol>{BEATS.map((beat, i) => <li key={beat} className={i === demo.step ? "active" : i < demo.step ? "complete" : ""}><span>{i < demo.step ? <CheckIcon size={10} /> : i + 1}</span>{beat}</li>)}</ol><button className="ops-replay-next" disabled={demoBusy} onClick={() => { if (demo.done) void startDemo(); else { setPlaying(false); void advanceDemo(); } }}>{demo.done ? <RotateCcw size={14} /> : <ChevronRight size={16} />}{demo.done ? "Replay" : "Next"}</button></section>}
    {presentation && activeDemo ? <DisasterExperience key={event?.id} checks={checks} selectedId={selected?.client_id ?? null} eventId={event?.id ?? null} mapUrl={liveMapUrl} onSelect={selectPatient} onOpenDashboard={() => { setPlaying(false); setPresentation(false); }} playing={playing} onPause={() => setPlaying(false)}>{patientPanel}</DisasterExperience> : <>
    <section className="ops-metrics" aria-label="Outreach overview"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}><Users size={18} /><span><strong>{String(checks.length).padStart(2, "0")}</strong>Enrolled in this round</span><small>{event ? `${counts.outcomes} outcomes recorded` : "No round yet"}</small></button><button aria-pressed={filter === "attention"} className="ops-metric-alert" onClick={() => setFilter("attention")}><Activity size={18} /><span><strong>{String(counts.attention).padStart(2, "0")}</strong>Need human attention</span><small>Reported severity first</small></button><button aria-pressed={filter === (mode === "crisis" ? "transport" : "review")} onClick={() => setFilter(mode === "crisis" ? "transport" : "review")}><MapPin size={18} /><span><strong>{String(mode === "crisis" ? counts.transport : counts.review).padStart(2, "0")}</strong>{mode === "crisis" ? "Transport assistance" : "Awaiting nurse review"}</span><small>{mode === "crisis" ? "Recorded care context" : "Evidence before decisions"}</small></button><button aria-pressed={filter === "unreached"} onClick={() => setFilter("unreached")}><Phone size={18} /><span><strong>{String(counts.unreached).padStart(2, "0")}</strong>Not yet reached</span><small>A missed call stays open</small></button></section>
    <div className="ops-workspace">
      <aside className="ops-queue"><div className="ops-queue-heading"><div><span className="ops-kicker">OUTREACH QUEUE</span><h2>People, in priority order <span>{visible.length}</span></h2></div><div className="ops-search"><Search size={14} /><input aria-label="Search patients" placeholder="Find a person or concern" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="ops-queue-filters"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Everyone</button><button aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>Attention</button><button aria-pressed={filter === "unreached"} onClick={() => setFilter("unreached")}>Unreached</button></div>{!["all", "attention", "unreached"].includes(filter) && <button className="ops-filter-note" onClick={() => setFilter("all")}>{filter === "transport" ? "Transport needs" : "Nurse review"}<X size={12} /></button>}</div>
        <div className="ops-queue-list">{visible.map((check, index) => { const state = status(check); return <button className={`ops-person ${state.tone} ${selected?.id === check.id ? "selected" : ""}`} key={check.id} onClick={() => selectPatient(check.client_id)} aria-pressed={selected?.id === check.id}><div className="ops-person-line"><span className="ops-person-rank">{String(index + 1).padStart(2, "0")}</span><strong>{check.client.name}</strong><ChevronRight size={14} /></div><span className="ops-person-status"><i />{state.label}</span><p>{quoteFor(check)}</p><div className="ops-person-tags">{check.client.needs_ride && <span><MapPin size={10} />Needs a ride</span>}{check.client.uses_powered_equipment && <span>Powered equipment</span>}{check.client.language === "ko" && <span>Korean</span>}{check.ladder_step > 0 && <span>{check.ladder_step === 4 ? "Unreachable" : `Attempt ${check.ladder_step + 1}`}</span>}</div></button>; })}{!visible.length && <div className="ops-queue-empty"><Users size={25} /><strong>{loading ? "Loading outreach…" : checks.length ? "No matching patients" : "Your next round starts here"}</strong><p>{checks.length ? "Clear the filter to return to the full queue." : (facilityId ? "Start outreach for this facility to see responses and next steps." : "Start outreach or play the disaster demo to follow a complete response.")}</p>{checks.length > 0 && <button onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>}</div>}</div>
        <div className="ops-queue-footer"><ShieldCheck size={14} /><span>Severity first. Distress changes order only within the same tier.</span></div>
      </aside>
      <section className="ops-map-panel" aria-label="Los Angeles response map"><OperationsMap checks={visible} selectedId={selected?.client_id ?? null} eventId={event?.id ?? null} mode={mode} mapUrl={liveMapUrl} onSelect={selectPatient} />
        {event?.alert_text && mode === "crisis" && <div className="ops-incident"><button onClick={() => setShowAlert(v => !v)} aria-expanded={showAlert}><span><Radio size={14} />{activeDemo || event.alert_text.includes("FICTIONAL") || isMock ? "Scenario briefing" : "Coordinator alert"}</span><span>Read exact message <ChevronRight size={13} /></span></button>{showAlert && <blockquote>{event.alert_text}</blockquote>}</div>}
        <div className="ops-activity"><div><span className="ops-signal" /><strong>Latest activity</strong><small>{connection === "realtime" ? "Database connected" : connection === "polling" ? "Refreshing every 3s" : "Connecting"}</small></div>{recent.length ? recent.map(check => <button key={check.id} onClick={() => { setFilter("all"); setQuery(""); selectPatient(check.client_id); }}><time>{new Date(check.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span><strong>{check.client.name}</strong>{status(check).label}</span><ArrowRight size={13} /></button>) : <p>{loading ? "Waiting for the database…" : "Responses and handoffs appear here as they arrive."}</p>}</div>
      </section>
      <aside className="ops-evidence-panel">{patientPanel}</aside>
    </div>
    </>}
    <footer className="ops-footer"><span><i className={connection === "realtime" ? "connected" : ""} />{connection === "realtime" ? "Connected to patient records" : "Patient records"}{lastSync && <small>Updated {new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>}</span><span>{isFictional ? "Fictional patients · " : ""}People decide care, transport, and emergency response.</span><button onClick={() => exportReport(checks, event, isMock || isFictional || isReplayEvent)} disabled={!checks.length}><Download size={13} />Export assistance list</button></footer>
    <dialog ref={dialog} className="ops-start-dialog" onClose={() => setDialogOpen(false)} onClick={e => { if (e.target === e.currentTarget && !starting) setDialogOpen(false); }}><div><span className="ops-kicker">START CRISIS OUTREACH</span><button aria-label="Close outreach dialog" disabled={starting} onClick={() => setDialogOpen(false)}><X size={20} /></button></div><Radio size={30} /><h2>One message.<br />Every enrolled patient.</h2><p>The phone agent reads the coordinator’s message exactly, then records who needs assistance.</p><label htmlFor="ops-alert">{alertText === SAMPLE_ALERT ? "Fictional sample alert" : "Coordinator-provided alert"}</label><textarea id="ops-alert" value={alertText} maxLength={1400} rows={6} onChange={e => setAlertText(e.target.value)} /><small>{isMock ? "Demo mode: this creates simulated calls only." : "This requests real calls to the enrolled roster."} Humans decide and arrange any response.</small><button className="ops-button coral" disabled={starting || !alertText.trim()} onClick={() => { void startRound("crisis"); }}>{starting ? "Starting outreach…" : "Start crisis outreach"}<ArrowRight size={16} /></button>{error && <p className="ops-dialog-error" role="alert">{error}</p>}</dialog>
  </section>;
}
