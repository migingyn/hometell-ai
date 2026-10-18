// Read-only check of every outside service: what is set, what answers, what is wrong.
// Changes nothing. Usage: npx tsx scripts/check-setup.ts
import "./env";
import type Retell from "retell-sdk";
import { config } from "../lib/config";
import { DYNAMIC_VARIABLE_NAMES, E164, retell } from "../lib/retell";
import { supabaseAdmin } from "../lib/supabase";

type Level = "PASS" | "WARN" | "FAIL";
const results: { level: Level; area: string; text: string }[] = [];
const report = (level: Level, area: string, text: string) => results.push({ level, area, text });

// The 17 post-call fields the webhook reads. Names, types, and choices must match.
const ANALYSIS_FIELDS: Record<string, { type: string; choices?: string[] }> = {
  feels_ok: { type: "enum", choices: ["yes", "no", "unsure"] },
  danger_words_heard: { type: "boolean" },
  med_taken: { type: "enum", choices: ["yes", "no", "unsure", "not_asked"] },
  allergy_item_mentioned: { type: "boolean" },
  dose_question_asked: { type: "boolean" },
  needs_nurse: { type: "boolean" },
  needs_nurse_reason: { type: "string" },
  new_personal_fact: { type: "string" },
  answered_by: { type: "enum", choices: ["client", "someone_else", "voicemail", "no_answer"] },
  pain_level: { type: "number" },
  pain_location: { type: "string" },
  sleep_quality: { type: "enum", choices: ["good", "poor", "not_asked"] },
  ate_and_drank: { type: "enum", choices: ["yes", "no", "not_asked"] },
  steady_on_feet: { type: "enum", choices: ["yes", "no", "not_asked"] },
  mood: { type: "enum", choices: ["good", "okay", "low", "not_asked"] },
  new_swelling: { type: "boolean" },
  crisis_status: { type: "enum", choices: ["needs_help", "no_response", "safe", "not_crisis"] },
};
// Variables Retell fills in by itself, so we never send them.
const RETELL_SYSTEM_VARS = ["current_time", "current_calendar", "user_number", "agent_number", "call_id", "direction", "session_type", "session_duration"];

async function checkSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return report("FAIL", "Supabase", "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Every /api route needs these.");
  }
  for (const table of ["clients", "daily_entries", "calls", "alerts", "crisis_runs"]) {
    const { count, error } = await supabaseAdmin().from(table).select("*", { count: "exact", head: true });
    if (error) return report("FAIL", "Supabase", `table ${table}: ${error.message}. Run supabase/schema.sql.`);
    if (table === "clients") report(count ? "PASS" : "WARN", "Supabase", `${count ?? 0} residents${count ? "" : ". Run npx tsx scripts/seed.ts"}`);
  }
  report("PASS", "Supabase", "all 5 tables exist");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) report("WARN", "Supabase", "NEXT_PUBLIC_SUPABASE_ANON_KEY not set. Only needed if the frontend reads Supabase Realtime.");
}

function promptVars(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
}

async function checkRetell() {
  if (!config.retellApiKey) return report("FAIL", "Retell", "RETELL_API_KEY not set. Real calls and signature checks need it.");
  const r = retell();

  let agent: Retell.AgentResponse;
  try {
    agent = await r.agent.retrieve(config.retellAgentId);
  } catch (e) {
    return report("FAIL", "Retell", `agent ${config.retellAgentId}: ${e instanceof Error ? e.message : e}. Check the key and RETELL_AGENT_ID.`);
  }
  report("PASS", "Retell", `key works. Agent "${agent.agent_name}" version ${agent.version}`);
  report(agent.is_published ? "PASS" : "WARN", "Retell agent", agent.is_published ? "published" : "not published. Run scripts/setup-retell.ts --apply --publish when ready");

  const base = config.publicBaseUrl;
  const wantWebhook = base ? `${base}/retell-webhook` : null;
  if (!agent.webhook_url) report("WARN", "Retell agent", "no agent webhook_url. Events go to the account-level webhook, if one is set in the dashboard");
  else if (wantWebhook && agent.webhook_url !== wantWebhook) report("FAIL", "Retell agent", `webhook_url is ${agent.webhook_url}, want ${wantWebhook}`);
  else report("PASS", "Retell agent", `webhook_url ${agent.webhook_url}`);
  const events = agent.webhook_events;
  if (events && !["call_started", "call_ended", "call_analyzed"].every((e) => events.includes(e as never))) {
    report("FAIL", "Retell agent", `webhook_events is ${events.join(", ")}. Needs call_started, call_ended, call_analyzed`);
  }

  const vm = agent.voicemail_option?.action?.type;
  report(vm === "hangup" ? "PASS" : "WARN", "Retell agent", `voicemail action: ${vm ?? "not set"}${vm === "hangup" ? "" : ". Want hangup so voicemail counts as no answer"}`);
  const silence = agent.end_call_after_silence_ms;
  report(silence && silence <= 30000 ? "PASS" : "WARN", "Retell agent", `end call after silence: ${silence ? silence / 1000 + "s" : "not set"}`);
  const max = agent.max_call_duration_ms;
  const maxOk = max != null && max >= 3 * 60000 && max <= 6 * 60000;
  report(maxOk ? "PASS" : "FAIL", "Retell agent", `max call duration: ${max ? Math.round(max / 1000) + "s" : "default"}${maxOk ? "" : ". Want about 5 minutes. A daily check cannot finish in less, and every cut-off raises open_line"}`);

  const fields = new Map((agent.post_call_analysis_data ?? []).map((f) => [f.name, f as { type: string; choices?: string[] }]));
  const bad: string[] = [];
  for (const [name, want] of Object.entries(ANALYSIS_FIELDS)) {
    const got = fields.get(name);
    if (!got) bad.push(`${name} missing`);
    else if (got.type !== want.type) bad.push(`${name} is ${got.type}, want ${want.type}`);
    else if (want.choices && want.choices.some((c) => !got.choices?.includes(c))) bad.push(`${name} choices ${got.choices?.join("/")}`);
  }
  report(bad.length ? "FAIL" : "PASS", "Retell analysis", bad.length ? bad.join("; ") : "all 17 post-call fields match");

  // Phone number bound to this agent for outbound calls.
  try {
    const pn = await r.phoneNumber.retrieve(config.retellFromNumber);
    const bound = pn.outbound_agents?.some((a) => a.agent_id === agent.agent_id);
    report(bound ? "PASS" : "WARN", "Retell number", `${config.retellFromNumber} ${bound ? "is bound to the agent" : "is not bound to this agent. override_agent_id still works per call"}`);
  } catch (e) {
    report("FAIL", "Retell number", `${config.retellFromNumber}: ${e instanceof Error ? e.message : e}. RETELL_FROM_NUMBER must be a number in this Retell account`);
  }

  const engine = agent.response_engine;
  if (engine.type !== "retell-llm") return report("WARN", "Retell LLM", `response engine is ${engine.type}. Tool and prompt checks only cover retell-llm`);
  const llm = await r.llm.retrieve(engine.llm_id);
  const tools = (llm.general_tools ?? []) as { type: string; name: string; url?: string; args_at_root?: boolean; transfer_destination?: { number?: string } }[];

  const flag = tools.find((t) => t.name === "flag_nurse");
  const wantFlag = base ? `${base}/retell/functions/flag-nurse` : null;
  if (!flag) report("FAIL", "Retell tools", "no flag_nurse custom function");
  else if (flag.args_at_root) report("FAIL", "Retell tools", "flag_nurse has args_at_root on. Turn it off so call metadata is sent");
  else if (!flag.url || flag.url.includes("example.com")) report("FAIL", "Retell tools", `flag_nurse URL is a placeholder (${flag.url}). Want ${wantFlag ?? "{PUBLIC_BASE_URL}/retell/functions/flag-nurse"}`);
  else if (wantFlag && flag.url !== wantFlag) report("FAIL", "Retell tools", `flag_nurse URL is ${flag.url}, want ${wantFlag}`);
  else report("PASS", "Retell tools", `flag_nurse URL ${flag.url}`);

  const transfer = tools.find((t) => t.type === "transfer_call");
  if (transfer) {
    const dest = transfer.transfer_destination?.number ?? "";
    const usesVar = dest.includes("{{nurse_phone}}");
    if (usesVar && !config.nursePhone) report("FAIL", "Retell tools", `${transfer.name} dials {{nurse_phone}} but NURSE_PHONE and FRONT_DESK_PHONE are empty, so the transfer has no number`);
    else report("PASS", "Retell tools", `${transfer.name} dials ${usesVar ? `{{nurse_phone}} = ${config.nursePhone}` : dest}`);
  }

  // Retell only fills in {{name}}. A bare "vitals_status" in the prompt is just text.
  const text = [llm.general_prompt ?? "", llm.begin_message ?? "", ...(llm.states ?? []).map((s) => s.state_prompt ?? ""), JSON.stringify(tools)].join("\n");
  const used = promptVars(text);
  const sent = new Set<string>(DYNAMIC_VARIABLE_NAMES);
  const unused = [...sent].filter((v) => !used.has(v));
  const unknown = [...used].filter((v) => !sent.has(v) && !RETELL_SYSTEM_VARS.some((s) => v.startsWith(s)));
  report(unused.length ? "FAIL" : "PASS", "Retell prompt", unused.length ? `never uses {{${unused.join("}}, {{")}}}. The agent cannot see these values. scripts/setup-retell.ts adds a call context block` : "uses every variable we send");
  if (unknown.length) report("FAIL", "Retell prompt", `uses {{${unknown.join("}}, {{")}}} which we never send`);
}

async function checkTwilio() {
  const t = config.twilio;
  const set = [t.sid, t.token, t.from, config.frontDeskPhone].filter(Boolean).length;
  if (set === 0) return report("WARN", "Twilio", "not set. Alerts still save, log, and stream. They are just not texted");
  if (set < 4) return report("FAIL", "Twilio", "only some of TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, FRONT_DESK_PHONE are set. SMS needs all four");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${t.sid}:${t.token}`).toString("base64")}` },
  });
  report(res.ok ? "PASS" : "FAIL", "Twilio", res.ok ? `account works. Texts go to ${config.frontDeskPhone}` : `account check returned ${res.status}`);
}

function checkEnv() {
  report(config.mockRetell ? "WARN" : "PASS", "Env", `MOCK_RETELL=${config.mockRetell}${config.mockRetell ? ". No real calls are placed" : ""}`);
  if (!config.publicBaseUrl) report("WARN", "Env", "PUBLIC_BASE_URL not set. Retell cannot reach the webhook or flag_nurse. Run ngrok http 3000");
  else report(config.publicBaseUrl.startsWith("https://") ? "PASS" : "FAIL", "Env", `PUBLIC_BASE_URL ${config.publicBaseUrl}`);
  if (config.skipSignatureCheck) report("WARN", "Env", "SKIP_SIGNATURE_CHECK=true. Anyone can post fake webhooks. Local testing only");
  const phones = (process.env.SEED_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const badPhones = phones.filter((p) => !E164.test(p));
  if (!phones.length) report("WARN", "Env", "SEED_PHONES not set. Seeded residents get fake 555 numbers that cannot be called");
  else report(badPhones.length ? "FAIL" : "PASS", "Env", badPhones.length ? `SEED_PHONES not E.164: ${badPhones.join(", ")}` : `${phones.length} seed phones`);
}

async function main() {
  checkEnv();
  for (const [name, fn] of [["Supabase", checkSupabase], ["Retell", checkRetell], ["Twilio", checkTwilio]] as const) {
    try {
      await fn();
    } catch (e) {
      report("FAIL", name, e instanceof Error ? e.message : String(e));
    }
  }
  for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.area.padEnd(16)} ${r.text}`);
  const fails = results.filter((r) => r.level === "FAIL").length;
  console.log(`\n${fails} failing, ${results.filter((r) => r.level === "WARN").length} warnings`);
  process.exit(fails ? 1 : 0);
}

main();
