"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock3, Heart, Moon, Radio, ShieldCheck, Sun, Users, X } from "lucide-react";
import { ClientCard } from "./ClientCard";
import { Counters } from "./Counters";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { normalizeMode, SAMPLE_ALERT } from "@/lib/mode";
import type { ApiResult, Check, CheckWithClient, Client, EventMode, HeartbeatEvent, RiskTier } from "@/lib/types";
import "./heartbeat.css";

type Data = { event: HeartbeatEvent | null; checks: CheckWithClient[] };
type Health = { database: boolean; mockMode: boolean; fictionalData: boolean; retell: { configured: boolean; missing: string[] }; sms: { configured: boolean; missing: string[] }; note: string };
const TIERS: Record<RiskTier, number> = { red: 0, yellow: 1, green: 2 };
async function post(url: string, body?: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as ApiResult<unknown>;
  if (!response.ok || !result.ok) throw new Error(!result.ok ? result.error : `Request failed (${response.status})`);
}
async function fetchDashboard(): Promise<Data> {
  const db = supabaseBrowser();
  const { data: event, error } = await db.from("events").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { event: null, checks: [] };
  const [{ data, error: checksError }, { data: clients, error: clientsError }] = await Promise.all([
    db.from("checks").select("*").eq("event_id", event.id),
    db.from("clients_public").select("*"),
  ]);
  if (checksError) throw new Error(checksError.message);
  if (clientsError) throw new Error(clientsError.message);
  const roster = new Map(((clients ?? []) as Omit<Client, "phone" | "emergency_contact_phone">[]).map((client) => [client.id, { ...client, phone: "", emergency_contact_phone: "" }]));
  return { event: event as HeartbeatEvent, checks: ((data ?? []) as Check[]).flatMap((check) => { const client = roster.get(check.client_id); return client ? [{ ...check, client }] : []; }) };
}

export function Dashboard({ agencyName, mockMode, fictionalData }: { agencyName: string; mockMode: boolean; fictionalData: boolean }) {
  const [event, setEvent] = useState<HeartbeatEvent | null>(null);
  const [checks, setChecks] = useState<CheckWithClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<EventMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connecting" | "realtime" | "polling">("connecting");
  const [health, setHealth] = useState<Health | null>(null);
  const [alertText, setAlertText] = useState(SAMPLE_ALERT);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention" | "unreached">("all");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const mode = event ? normalizeMode(event.type) : "daily";
  const crisis = mode === "crisis";
  const eventId = event?.id;
  const isMock = health?.mockMode ?? mockMode;
  const isFictional = health?.fictionalData ?? fictionalData;
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const data = await fetchDashboard();
      if (generation.current === current) { setEvent(data.event); setChecks(data.checks); setError(null); setLastSync(new Date().toISOString()); }
    } catch (err) { if (generation.current === current) setError(err instanceof Error ? err.message : "The roster could not be loaded."); }
    finally { if (generation.current === current) setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const grace = window.setTimeout(() => setConnection((value) => value === "connecting" ? "polling" : value), 5000);
    let remove: (() => void) | undefined;
    try {
      const db = supabaseBrowser();
      const channel = db.channel("heartbeat-dashboard")
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => { void load(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "checks" }, () => { void load(); })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") { setConnection("realtime"); void load(); }
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setConnection("polling");
        });
      remove = () => { void db.removeChannel(channel); };
    } catch { queueMicrotask(() => setConnection("polling")); }
    return () => { window.clearTimeout(initial); window.clearTimeout(grace); remove?.(); };
  }, [load]);
  useEffect(() => {
    let active = true;
    void fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).then((result: ApiResult<Health>) => { if (active && result.ok) setHealth(result.data); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => { if (connection !== "polling") return; const timer = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(timer); }, [connection, load]);
  useEffect(() => {
    if (!eventId) return;
    let ticking = false;
    const timer = window.setInterval(async () => {
      if (ticking) return; ticking = true;
      try { await post("/api/ladder/tick"); }
      catch (err) { setError(err instanceof Error ? err.message : "Follow-up scheduling could not run."); }
      finally { ticking = false; }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [eventId]);
  useEffect(() => { if (dialogOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [dialogOpen]);
  async function start(type: EventMode) {
    setStarting(type); setError(null);
    const requestId = crypto.randomUUID();
    try { await post("/api/events/start", { type, request_id: requestId, ...(type === "crisis" ? { alert_text: alertText } : {}) }); setDialogOpen(false); setFilter("all"); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Check-ins could not start."); }
    finally { setStarting(null); }
  }
  async function act(url: string, id: string) {
    setPending(id); setError(null);
    try { await post(url); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "This action could not complete."); }
    finally { setPending(null); }
  }
  const rank = (check: CheckWithClient) => check.status === "needs_human" ? (crisis || check.urgency === "urgent" ? 0 : 1) : ({ no_answer: 2, calling: 3, queued: 4, ok: 5, handled: 6 }[check.status]);
  const sorted = [...checks].filter((check) => filter === "attention" ? check.status === "needs_human" : filter === "unreached" ? ["no_answer", "queued", "calling"].includes(check.status) : true).sort((a, b) => rank(a) - rank(b) || TIERS[a.client.risk_tier] - TIERS[b.client.risk_tier] || a.client.name.localeCompare(b.client.name));
  const attention = checks.filter((check) => check.status === "needs_human").length;
  return <main className={`hb-app ${crisis ? "hb-crisis" : "hb-daily"}`}>
    <header className="hb-topbar"><Link href="/" className="hb-brand"><span><Heart size={19} /></span>heartbeat<span className="hb-brand-dot">.</span></Link><span className="hb-product-label">A little care. Every day.</span><div className="hb-topbar-right">{isMock && <span className="hb-badge hb-mock"><i />MOCK MODE · NO REAL CALLS</span>}{isFictional && <span className="hb-badge">FICTIONAL CLIENTS</span>}<span className="hb-agency">{agencyName}</span></div></header>
    <div className="hb-content"><section className="hb-heading"><div><div className="hb-eyebrow">THE PEOPLE BEHIND YOUR PHONE TREE</div><h1>{crisis ? <>When it matters,<br /><span>keep reaching out.</span></> : <>An ordinary morning.<br /><span>A meaningful check-in.</span></>}</h1><p>{crisis ? "One official message. Highest-risk clients first. A person for every concern." : "A familiar voice for every client. Your time for the people who need it."}</p></div><div className="hb-launch-actions"><button className="hb-button hb-button-primary" disabled={starting !== null} onClick={() => start("daily")}><Sun size={17} />{starting === "daily" ? "Starting check-ins…" : "Run morning check-ins"}<ArrowRight size={16} /></button><button className="hb-button hb-button-crisis" disabled={starting !== null} onClick={() => setDialogOpen(true)}><Radio size={17} />Start crisis check<ArrowRight size={16} /></button><span>Same people. Same phone tree. Ready for either day.</span></div></section>
      {error && <div className="hb-error" role="alert"><span>{error}</span><button onClick={() => { void load(); }}>Retry connection</button><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
      <section className="hb-session-strip"><span className="hb-session-icon">{crisis ? <Moon size={20} /> : <Sun size={20} />}</span><div><span>{event ? "CURRENT CHECK-IN" : "READY WHEN YOU ARE"}</span><strong>{event ? crisis ? "Crisis response" : "Morning check-ins" : "Your next round starts here"}</strong></div>{event ? <><span className="hb-session-time"><Clock3 size={13} /><EventTimer startedAt={event.started_at} /></span><span className="hb-session-date">Started {new Date(event.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>{crisis && event.alert_text && <button className="hb-read-alert" onClick={() => setShowAlert(!showAlert)}>Read exact alert<ArrowRight size={13} /></button>}</> : <span className="hb-session-date">Morning support and crisis outreach, in one place.</span>}<span className={`hb-connection hb-${connection}`}><i />{connection === "realtime" ? "Realtime connected" : connection === "polling" ? "Polling every 3 seconds" : "Connecting…"}</span></section>
      {showAlert && event?.alert_text && <div className="hb-alert-receipt"><span>{event.alert_text === SAMPLE_ALERT ? "FICTIONAL SAMPLE ALERT" : "COORDINATOR-PROVIDED ALERT"} · READ WORD FOR WORD</span><blockquote>{event.alert_text}</blockquote></div>}
      {health && <div className="hb-health"><span><i className={health.database ? "hb-health-ready" : ""} />Database {health.database ? "connected" : "unavailable"}</span><span>{isMock ? "Voice transport simulated" : health.retell.configured ? "Retell configured" : "Retell not configured"}</span><span>{isMock ? "SMS simulated" : health.sms.configured ? "SMS configured" : "Text not sent (SMS not configured)"}</span></div>}
      <Counters checks={checks} mode={mode} />
      <section className="hb-roster"><div className="hb-roster-heading"><div><span className="hb-eyebrow">EVERY PERSON COUNTS</span><h2>Your check-in board<span>{checks.length}</span></h2></div><div className="hb-filters" aria-label="Filter check-ins">{([['all', 'Everyone'], ['attention', `Needs attention${attention ? ` · ${attention}` : ''}`], ['unreached', 'Not yet reached']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div><div className="hb-card-grid">{sorted.map((check) => <ClientCard key={check.id} check={check} mode={mode} mockMode={isMock} busy={pending === check.id} onAdvance={(id) => act(`/api/ladder/advance/${id}`, id)} onHandled={(id) => act(`/api/checks/${id}/handled`, id)} />)}</div>
      {loading && <div className="hb-empty"><Users size={27} /><h3>Connecting to your client list</h3><p>Source records will appear when the database responds.</p></div>}
      {!loading && !event && <div className="hb-empty"><Users size={30} /><h3>A phone call can make the difference.</h3><p>Run your morning round to ask about medications, groceries, and rides.<br />If an alert comes, switch to crisis outreach with the same enrolled list.</p><span>No app for clients to install. Just their phone.</span></div>}
      {!loading && event && !sorted.length && <div className="hb-empty"><Users size={26} /><h3>{checks.length ? "No check-ins in this view" : "No check-ins to display"}</h3><p>{checks.length ? "Choose Everyone to return to the full board." : "Confirm the enrolled client roster and this event’s check records."}</p></div>}</section>
      <section className="hb-ladder-explainer"><div><span className="hb-eyebrow">A MISSED CALL IS THE START, NOT THE END.</span><h2>Keep going until a person takes over.</h2></div><div>{["Call", "Retry", "Text", "Emergency contact", "Human coordinator"].map((label, index) => <span key={label}><b>{String(index + 1).padStart(2, "0")}</b>{label}{index < 4 && <ArrowRight size={13} />}</span>)}</div></section>
      <footer className="hb-footer"><span><ShieldCheck size={14} />Check-ins and human handoffs. No automated medical or evacuation decisions.</span><span>{lastSync ? `Last synced ${new Date(lastSync).toLocaleTimeString()}` : "Waiting for database connection"}</span></footer></div>
    <dialog ref={dialog} className="hb-alert-dialog" onClose={() => setDialogOpen(false)} onClick={(event) => { if (event.target === event.currentTarget && !starting) setDialogOpen(false); }}><div className="hb-dialog-top"><span className="hb-eyebrow">CRISIS CHECK-IN</span><button aria-label="Close crisis check dialog" disabled={starting !== null} onClick={() => setDialogOpen(false)}><X size={20} /></button></div><span className="hb-dialog-symbol"><Radio size={25} /></span><h2>One message.<br />Every enrolled client.</h2><p>Paste the official alert exactly as issued. The automated line reads this text word for word, then asks whether the client needs a person.</p><label htmlFor="hb-alert-text">{alertText === SAMPLE_ALERT ? "FICTIONAL SAMPLE ALERT — FOR DEMONSTRATION" : "COORDINATOR-PROVIDED OFFICIAL ALERT"}</label><textarea id="hb-alert-text" rows={5} value={alertText} maxLength={1400} onChange={(event) => setAlertText(event.target.value)} /><small>The prefilled message is fictional. Heartbeat adds no evacuation or medical advice.</small>{isMock && <div className="hb-dialog-mock">MOCK MODE · Starting this check creates simulated calls only.</div>}<button className="hb-button hb-button-primary" disabled={!alertText.trim() || starting !== null} onClick={() => start("crisis")}>{starting === "crisis" ? "Starting crisis check…" : "Start crisis check"}<ArrowRight size={17} /></button>{error && <p className="hb-dialog-error" role="alert">{error}</p>}</dialog>
  </main>;
}

function EventTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const update = () => setNow(Date.now()); const initial = window.setTimeout(update, 0); const timer = window.setInterval(update, 1000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, []);
  const seconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return <time>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")} elapsed</time>;
}
