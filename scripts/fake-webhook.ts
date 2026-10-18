// Explicit simulated Retell payloads using the real post-call analysis contract.
import "./env";
import { supabaseAdmin } from "../lib/supabase";
import type { CallTarget, Check, CheckWithClient, RetellWebhookPayload } from "../lib/types";

const OUTCOMES = ["ok", "needs_human", "no_answer", "follow_up", "unclear", "needs_ride"] as const;
type Outcome = typeof OUTCOMES[number];
const UUID = /^[0-9a-f-]{36}$/i;

export function buildFakeWebhook(check: Pick<Check, "id" | "last_call_id"> & { client: { name: string; emergency_contact_name: string } }, outcome: Outcome, target: CallTarget, mode: "daily" | "crisis"): RetellWebhookPayload {
  if (!check.last_call_id) throw new Error("This check has no active call ID. Start the event or advance its ladder first.");
  const contact = check.client.emergency_contact_name;
  const person = check.client.name;
  const userText = outcome === "no_answer" ? "" : outcome === "ok"
    ? target === "emergency_contact" ? `Yes, I spoke to ${person} today. They are okay and with me.` : "I am okay. I can leave on my own."
    : outcome === "needs_human" ? "I feel dizzy and need a person to call me."
    : outcome === "follow_up" ? "I need help with groceries this week and a pharmacy ride Thursday."
    : outcome === "needs_ride" ? "I need a ride to leave."
    : "I am not sure what you mean. The connection is breaking up.";
  const agentText = target === "emergency_contact"
    ? `Hello ${contact}, this is Heartbeat, the automated check-in line. Have you spoken to ${person}, and are they okay?`
    : "This is Heartbeat, the automated check-in line. How are you feeling, and do you need anything?";
  const clientStatus = outcome === "ok" && target === "client" ? "ok" : ["needs_human", "follow_up", "needs_ride"].includes(outcome) ? "needs_help" : "unclear";
  const summary = outcome === "no_answer" ? "SIMULATED: reached voicemail."
    : target === "emergency_contact" && outcome === "ok" ? `SIMULATED: ${contact} said, "${userText}"`
    : `SIMULATED: ${userText}`;
  const turns: { role: "agent" | "user"; content: string }[] = userText
    ? [{ role: "agent", content: agentText }, { role: "user", content: userText }] : [];
  const analysis: Record<string, unknown> = {
    client_status: clientStatus,
    request: ["needs_human", "follow_up", "needs_ride"].includes(outcome) ? userText : "",
    needs_ride: outcome === "needs_ride",
    needs_ride_quote: target === "client" && ["ok", "needs_ride"].includes(outcome) ? userText : "",
    contact_confirms_ok: target === "emergency_contact" && outcome === "ok",
  };
  if (mode === "daily" && target === "client" && outcome !== "no_answer") {
    const identity = `Yes, this is ${person}.`;
    turns.splice(0, turns.length,
      { role: "agent", content: `This is Heartbeat, the automated check-in line. Is this ${person}?` },
      { role: "user", content: identity },
      { role: "agent", content: "May I ask your follow-up questions for the nurse to review?" },
      { role: "user", content: "Yes, you may ask the questions." });
    Object.assign(analysis, { postop_patient_confirmed: true, postop_identity_quote: identity, postop_pain_score: -1 });
    for (const field of ["pain", "incision", "fever", "breathing", "appetite", "weight", "medications", "falls"]) analysis[`postop_${field}_quote`] = "";
    if (["ok", "follow_up", "needs_ride"].includes(outcome)) {
      const answers = [
        ["pain", "What is your pain level from zero to ten?", "My pain is 2 out of 10."],
        ["incision", "Have you noticed changes around your incision?", "I have not noticed redness, swelling, drainage, or bleeding around the incision."],
        ["fever", "Have you felt feverish or had chills?", "I have not felt feverish or had chills."],
        ["breathing", "Have you had trouble breathing?", "My breathing feels the same as usual."],
        ["appetite", "Has your appetite or ability to eat and drink changed?", "My appetite is unchanged, and I am eating and drinking as usual."],
        ["weight", "Have you noticed a weight change?", "I have not noticed a weight change."],
        ["medications", "Any difficulty taking your medicines as directed or missed doses?", "I took my prescribed medicines as directed and have no concerns about them."],
        ["falls", "Have you fallen or nearly fallen?", "I have not fallen or nearly fallen."],
      ];
      for (const [field, question, answer] of answers) {
        turns.push({ role: "agent", content: question }, { role: "user", content: answer });
        analysis[`postop_${field}_quote`] = answer;
      }
      analysis.postop_pain_score = 2;
      const finalQuestion = outcome === "follow_up"
        ? "Is there anything else you want the nurse to know?"
        : "If you needed to leave home quickly, would you need help or could you leave independently?";
      turns.push({ role: "agent", content: finalQuestion }, { role: "user", content: userText });
    } else {
      // An urgent or unclear answer interrupts the questionnaire; all eight
      // fields remain unknown, and no invented mobility answer can clear a flag.
      turns.push({ role: "agent", content: "How are you feeling right now?" }, { role: "user", content: userText });
      analysis.needs_ride_quote = "";
    }
  }
  return {
    event: "call_analyzed",
    call: {
      call_id: check.last_call_id,
      call_status: "ended",
      disconnection_reason: outcome === "no_answer" ? "voicemail_reached" : "agent_hangup",
      transcript: turns.map((turn) => `${turn.role === "agent" ? "Agent" : "User"}: ${turn.content}`).join("\n"),
      transcript_object: turns,
      metadata: { check_id: check.id, target, mode },
      call_analysis: {
        call_summary: summary, in_voicemail: outcome === "no_answer",
        custom_analysis_data: analysis,
      },
    },
  };
}

async function main() {
  const [checkArg, value, requestedTarget] = process.argv.slice(2);
  if (!checkArg || !OUTCOMES.includes(value as Outcome) || (requestedTarget && !["client", "emergency_contact"].includes(requestedTarget))) {
    throw new Error("Usage: npx tsx scripts/fake-webhook.ts <checkId|fictional name> <ok|needs_human|no_answer|follow_up|unclear|needs_ride> [client|emergency_contact]");
  }
  if (process.env.MOCK_RETELL !== "true") throw new Error("Fake webhooks require MOCK_RETELL=true. No live result will be forged.");
  const db = supabaseAdmin();
  const { data: latest, error: eventError } = await db.from("events").select("id,type").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (eventError || !latest) throw new Error("No event yet. Start morning or crisis checks first.");
  let query = db.from("checks").select("*,client:clients!inner(*)");
  query = UUID.test(checkArg) ? query.eq("id", checkArg) : query.eq("event_id", latest.id).ilike("client.name", `%${checkArg}%`);
  const { data, error } = await query;
  if (error || data?.length !== 1) throw new Error(`Expected one matching check; found ${data?.length ?? 0}. Use its UUID or a more specific fictional name.`);
  const check = data[0] as unknown as CheckWithClient;
  const { data: event } = await db.from("events").select("type").eq("id", check.event_id).maybeSingle();
  const mode = event?.type === "daily" ? "daily" : "crisis";
  const target: CallTarget = requestedTarget as CallTarget || (check.ladder_step >= 3 ? "emergency_contact" : "client");
  const payload = buildFakeWebhook(check, value as Outcome, target, mode);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const response = await fetch(`${base.replace(/\/$/, "")}/api/retell/webhook`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Mock webhook failed (${response.status}). Check the app logs.`);
  console.log(`SIMULATED ${value}: HTTP ${response.status}; used the check's current call ID (${target}, ${mode}).`);
}

if (/fake-webhook\.(?:ts|js)$/.test(process.argv[1] ?? "")) void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Mock webhook failed.");
  process.exitCode = 1;
});
