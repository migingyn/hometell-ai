"use client";
// Live dashboard. Owner: Frontend.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientCard } from "@/components/ClientCard";
import { Counters } from "@/components/Counters";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { ApiResult, Check, CheckWithClient, HeartbeatEvent, RiskTier } from "@/lib/types";

const TIER_ORDER: Record<RiskTier, number> = { red: 0, yellow: 1, green: 2 };
const TICK_MS = 5000;

async function post<T>(url: string): Promise<ApiResult<T>> {
  const res = await fetch(url, { method: "POST" });
  return res.json();
}

type DashboardData = { event: HeartbeatEvent | null; checks: CheckWithClient[] };

// Latest event is the active one.
async function fetchDashboard(): Promise<DashboardData> {
  const db = supabaseBrowser();
  const { data: event, error } = await db
    .from("events")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { event: null, checks: [] };
  const { data: checks, error: checksError } = await db
    .from("checks")
    .select("*, client:clients(*)")
    .eq("event_id", event.id);
  if (checksError) throw new Error(checksError.message);
  return { event, checks: (checks ?? []) as CheckWithClient[] };
}

export function Dashboard({ agencyName }: { agencyName: string }) {
  const [event, setEvent] = useState<HeartbeatEvent | null>(null);
  const [checks, setChecks] = useState<CheckWithClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const apply = useCallback((d: DashboardData) => {
    setEvent(d.event);
    setChecks(d.checks);
  }, []);
  const showError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);

  const load = useCallback(() => fetchDashboard().then(apply, showError), [apply, showError]);

  useEffect(() => {
    fetchDashboard().then(apply, showError);
  }, [apply, showError]);

  // Realtime: merge each changed check row into state.
  useEffect(() => {
    if (!event) return;
    const db = supabaseBrowser();
    const channel = db
      .channel(`checks:${event.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checks", filter: `event_id=eq.${event.id}` },
        (payload) => {
          const row = payload.new as Check;
          setChecks((prev) => prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)));
        },
      )
      .subscribe();
    // TODO(Frontend): if subscribe reports CHANNEL_ERROR, fall back to polling load() every 3s.
    return () => {
      db.removeChannel(channel);
    };
  }, [event]);

  // Drive the ladder while an event is active. No cron.
  useEffect(() => {
    if (!event) return;
    const id = setInterval(() => post("/api/ladder/tick"), TICK_MS);
    return () => clearInterval(id);
  }, [event]);

  async function start() {
    setStarting(true);
    const res = await post("/api/events/start");
    setStarting(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    await load();
  }

  async function act(url: string) {
    const res = await post(url);
    setError(res.ok ? null : res.error);
  }

  // needs_human pinned to top, then red, yellow, green tier.
  const sorted = [...checks].sort(
    (a, b) =>
      Number(b.status === "needs_human") - Number(a.status === "needs_human") ||
      TIER_ORDER[a.client.risk_tier] - TIER_ORDER[b.client.risk_tier],
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{agencyName}</h1>
        <div className="flex items-center gap-4">
          {event && <EventTimer startedAt={event.started_at} />}
          <Button onClick={start} disabled={starting}>
            {starting ? "Starting..." : "Start heat wave check"}
          </Button>
        </div>
      </header>

      {error && <p className="rounded bg-red-100 p-3 text-sm text-red-900">{error}</p>}

      <Counters checks={checks} />

      <section className="grid grid-cols-3 gap-4">
        {sorted.map((c) => (
          <ClientCard
            key={c.id}
            check={c}
            onAdvance={(id) => act(`/api/ladder/advance/${id}`)}
            onHandled={(id) => act(`/api/checks/${id}/handled`)}
          />
        ))}
      </section>

      {!event && <p className="text-sm text-zinc-500">No active event. Press start.</p>}
    </main>
  );
}

function EventTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return <span className="font-mono text-sm">{mm}:{ss}</span>;
}
