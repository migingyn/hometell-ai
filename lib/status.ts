// Card status per resident for the frontend. Plain rules, no AI.
import {
  activeCrisisRun,
  listAlertsForCalls,
  listCalls,
  listClients,
  listOpenAlerts,
  listRunCalls,
  startOfToday,
  todayEntries,
  type CallSummary,
} from "@/lib/db";
import { NO_VITALS_NOTE, vitalsStatus, type VitalsResult } from "@/lib/vitals";
import type { Alert, CardStatus, Client, CrisisRun, CrisisState, DailyEntry } from "@/lib/types";

// Open alert order: crisis_no_response, then other urgency now, then today. Newest first inside each.
function alertRank(a: Alert): number {
  if (a.type === "crisis_no_response") return 0;
  return a.urgency === "now" ? 1 : 2;
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => alertRank(a) - alertRank(b) || b.created_at.localeCompare(a.created_at));
}

const SHORT_REASON: Partial<Record<Alert["type"], string>> = {
  crisis_no_response: "Crisis. No response",
  crisis_needs_help: "Crisis. Needs help",
  open_line: "Line still open",
  danger: "Danger words heard",
  allergy: "Allergy item mentioned",
  dose_question: "Dose question",
  no_answer: "No answer",
};

export function alertReason(a: Alert): string {
  const short = SHORT_REASON[a.type];
  if (short) return short;
  return a.message.length > 48 ? `${a.message.slice(0, 45)}...` : a.message;
}

export type Card = { card_status: CardStatus; card_reason: string };

export function cardStatus(input: {
  vitals: VitalsResult;
  openAlerts: Alert[];
  lastCallToday: CallSummary | null;
}): Card {
  const top = sortAlerts(input.openAlerts)[0];
  if (top?.urgency === "now") return { card_status: "red", card_reason: alertReason(top) };
  if (top) return { card_status: "yellow", card_reason: alertReason(top) };

  if (input.vitals.status === "alert") return { card_status: "yellow", card_reason: "Vitals out of range" };
  if (input.vitals.status === "watch") {
    const reason = input.vitals.note === NO_VITALS_NOTE ? "No vitals entered today" : "Vitals watch";
    return { card_status: "yellow", card_reason: reason };
  }

  const call = input.lastCallToday;
  if (!call) return { card_status: "gray", card_reason: "No call yet today" };
  if (call.status === "registered" || call.status === "ongoing") return { card_status: "gray", card_reason: "Calling now" };
  if (call.status === "ended") return { card_status: "gray", card_reason: "Waiting for call results" };
  return { card_status: "green", card_reason: "Call fine today" };
}

export type BoardRow = {
  client: Client;
  entry: DailyEntry | null;
  vitals: VitalsResult;
  openAlerts: Alert[];
  lastCall: CallSummary | null;
  lastAnalyzed: CallSummary | null;
  card: Card;
};

// Everything the resident list needs, in a handful of queries.
export async function loadBoard(): Promise<BoardRow[]> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [clients, entries, alerts, calls] = await Promise.all([
    listClients(),
    todayEntries(),
    listOpenAlerts(),
    listCalls({ since: weekAgo }),
  ]);
  const todayStart = new Date(startOfToday());

  return clients.map((client) => {
    const entry = entries.find((e) => e.client_id === client.id) ?? null;
    const vitals = vitalsStatus(entry, client.vitals_ranges);
    const openAlerts = alerts.filter((a) => a.client_id === client.id);
    const mine = calls.filter((c) => c.client_id === client.id); // newest first
    const lastCall = mine[0] ?? null;
    const lastCallToday = lastCall && new Date(lastCall.created_at) >= todayStart ? lastCall : null;
    const lastAnalyzed = mine.find((c) => c.status === "analyzed") ?? null;
    return { client, entry, vitals, openAlerts, lastCall, lastAnalyzed, card: cardStatus({ vitals, openAlerts, lastCallToday }) };
  });
}

export async function loadBoardRow(clientId: number): Promise<BoardRow | null> {
  return (await loadBoard()).find((r) => r.client.id === clientId) ?? null;
}

export type CrisisResident = {
  client_id: number;
  name: string;
  room: string;
  crisis_state: CrisisState;
  quote: string | null;
  last_update_at: string | null;
};

export type CrisisCurrent = {
  run: CrisisRun | null;
  counts: Record<CrisisState, number>;
  residents: CrisisResident[];
};

// One crisis_state per resident for the active run.
export async function crisisCurrent(): Promise<CrisisCurrent> {
  const counts: Record<CrisisState, number> = { safe: 0, needs_help: 0, no_response: 0, calling: 0, not_reached: 0 };
  const run = await activeCrisisRun();
  if (!run) return { run: null, counts, residents: [] };

  const [clients, calls] = await Promise.all([listClients(), listRunCalls(run.id)]);
  const alerts = await listAlertsForCalls(calls.map((c) => c.call_id));

  const residents = clients.map((client): CrisisResident => {
    const mine = calls.filter((c) => c.client_id === client.id); // newest first
    const ids = new Set(mine.map((c) => c.call_id));
    const myAlerts = alerts
      .filter((a) => a.call_id && ids.has(a.call_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = mine[0];

    let state: CrisisState = "not_reached";
    if (myAlerts.some((a) => a.type === "crisis_needs_help") || latest?.crisis_status === "needs_help") state = "needs_help";
    else if (myAlerts.some((a) => a.type === "crisis_no_response")) state = "no_response";
    else if (latest?.crisis_status === "safe") state = "safe";
    else if (latest) state = "calling";
    counts[state]++;

    const times = [latest?.updated_at, myAlerts[0]?.created_at].filter(Boolean) as string[];
    return {
      client_id: client.id,
      name: client.name,
      room: client.room,
      crisis_state: state,
      quote: myAlerts.find((a) => a.quote)?.quote ?? latest?.summary ?? null,
      last_update_at: times.sort().at(-1) ?? null,
    };
  });

  return { run, counts, residents };
}
