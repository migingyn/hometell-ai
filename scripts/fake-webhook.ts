// Sends a fake Retell call_analyzed webhook to the local app. Owner: Pitch.
// Usage: npx tsx scripts/fake-webhook.ts <checkId|client name> <ok|needs_human|no_answer> [client|emergency_contact]
// A client name (or part of one) picks that client's check in the latest event.
// Needs MOCK_RETELL=true on the app so the forced outcome is used.
import "./env";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";
import type { CallTarget, ClassifierStatus, RetellWebhookPayload } from "../lib/types";

const OUTCOMES: ClassifierStatus[] = ["ok", "needs_human", "no_answer"];
const TARGETS: CallTarget[] = ["client", "emergency_contact"];

// Realistic payloads so the real classifier can be tested with the same script later.
const SAMPLES: Record<ClassifierStatus, { transcript: string; disconnection_reason: string; summary: string; in_voicemail: boolean }> = {
  ok: {
    transcript: "Agent: Do you have air conditioning?\nUser: Yes, the AC is on and I have water. I feel fine.",
    disconnection_reason: "agent_hangup",
    summary: "Client has AC and water, feels fine.",
    in_voicemail: false,
  },
  needs_human: {
    transcript: "Agent: Are you feeling dizzy, sick, or confused?\nUser: I feel a bit dizzy and my fan stopped.",
    disconnection_reason: "agent_hangup",
    summary: "Client reports feeling dizzy, fan stopped.",
    in_voicemail: false,
  },
  no_answer: {
    transcript: "",
    disconnection_reason: "voicemail_reached",
    summary: "Reached voicemail.",
    in_voicemail: true,
  },
};

const UUID = /^[0-9a-f-]{36}$/i;

async function resolveCheckId(arg: string): Promise<string> {
  if (UUID.test(arg)) return arg;
  const db = supabaseAdmin();
  const { data: event } = await db.from("events").select("id").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!event) throw new Error("No event yet. Press start on the dashboard first.");
  const { data, error } = await db
    .from("checks")
    .select("id, client:clients!inner(name)")
    .eq("event_id", event.id)
    .ilike("client.name", `%${arg}%`);
  if (error) throw new Error(error.message);
  if (data.length !== 1) throw new Error(`"${arg}" matched ${data.length} clients. Be more specific.`);
  return data[0].id;
}

async function main() {
  const [checkArg, outcome, target = "client"] = process.argv.slice(2) as [string, ClassifierStatus, CallTarget];
  if (!checkArg || !OUTCOMES.includes(outcome) || !TARGETS.includes(target)) {
    console.error("Usage: npx tsx scripts/fake-webhook.ts <checkId|client name> <ok|needs_human|no_answer> [client|emergency_contact]");
    process.exit(1);
  }

  const checkId = await resolveCheckId(checkArg);
  const sample = SAMPLES[outcome];
  const payload: RetellWebhookPayload = {
    event: "call_analyzed",
    call: {
      // New id every run so repeated runs are not deduped.
      call_id: `fake_${randomUUID()}`,
      call_status: "ended",
      disconnection_reason: sample.disconnection_reason,
      transcript: sample.transcript,
      metadata: { check_id: checkId, target, mock_outcome: outcome },
      call_analysis: { call_summary: sample.summary, in_voicemail: sample.in_voicemail },
    },
  };

  const base = process.env.APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/retell/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log(res.status, await res.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
