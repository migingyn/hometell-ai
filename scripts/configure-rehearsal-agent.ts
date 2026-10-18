import "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import Retell from "retell-sdk";
import { matchesRehearsalSettings, rehearsalAgentPlan, REHEARSAL_AGENT_NAME, REHEARSAL_PROMPT } from "./rehearsal-agent-plan";
import { validatePublicUrl } from "./configure-voice-agent";

const statePath = ".local/rehearsal-agent.json";
let phase = "settings";
type State = { llmId?: string; llmVersion?: number; agentId?: string; version?: number; publicUrl?: string; published?: boolean };
function saveState(state: State) { mkdirSync(".local", { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); }
function saveEnv(values: Record<string, string>) {
  let text = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(value)) throw new Error("Invalid configuration value");
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(".env.local", text, { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npx tsx scripts/configure-rehearsal-agent.ts [--apply] [--public-url=https://callback.example]\nCreates only this rehearsal's own agent. --apply configures and publishes that private agent; never makes a phone call. Leaves all other agents and global mock mode unchanged."); return;
  }
  if (args.some(a => a !== "--apply" && !a.startsWith("--public-url="))) throw new Error("Unknown option");
  const publicValue = args.find(a => a.startsWith("--public-url="))?.slice(13) || process.env.HEARTBEAT_REHEARSAL_PUBLIC_URL;
  const publicUrl = publicValue ? validatePublicUrl(publicValue) : undefined;
  const missing = [!process.env.RETELL_API_KEY && "RETELL_API_KEY", !process.env.RETELL_VOICE_ID && "RETELL_VOICE_ID", !publicUrl && "HEARTBEAT_REHEARSAL_PUBLIC_URL"].filter(Boolean);
  if (!args.includes("--apply")) { console.log(JSON.stringify({ mode: "dry-run", missing, callsPlaced: 0, agent: REHEARSAL_AGENT_NAME, onlyTool: "end_call", signedCallbacks: true, realRecipientConfigured: Boolean(process.env.HEARTBEAT_REHEARSAL_PHONE) }, null, 2)); return; }
  if (missing.length || !publicUrl) throw new Error(`Missing ${missing.join(", ")}`);
  const api = new Retell({ apiKey: process.env.RETELL_API_KEY!, maxRetries: 0, timeout: 20_000 });
  const plan = rehearsalAgentPlan(publicUrl, process.env.RETELL_VOICE_ID!);
  const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  let existing = state.agentId ? await api.agent.retrieve(state.agentId, typeof state.version === "number" ? { version: state.version } : undefined) : undefined;
  if (existing && existing.agent_name !== REHEARSAL_AGENT_NAME) throw new Error("Saved agent is not owned by the rehearsal setup");
  const engine = existing?.response_engine;
  const currentLlm = engine?.type === "retell-llm" ? await api.llm.retrieve(engine.llm_id, engine.version == null ? undefined : { version: engine.version }) : undefined;
  if (existing?.is_published && matchesRehearsalSettings(existing, plan.agent) && matchesRehearsalSettings(currentLlm, plan.llm)) {
    state.llmId = currentLlm!.llm_id; state.llmVersion = currentLlm!.version;
    state.publicUrl = publicUrl;
    state.published = true; saveState(state);
    console.log("Published rehearsal prompt and settings already match. No calls placed.");
  } else {
    if (existing?.is_published) {
      const draft = await api.agent.createVersion(existing.agent_id, { base_version: existing.version });
      existing = await api.agent.retrieve(existing.agent_id, { version: draft.version });
      state.version = draft.version; state.published = false; saveState(state);
    }
    const draftEngine = existing?.response_engine;
    if (existing) {
      if (existing.is_published || draftEngine?.type !== "retell-llm" || draftEngine.version !== existing.version) throw new Error("Expected an unpublished rehearsal response engine matching the agent version");
      phase = "update draft language model";
      // Creating an agent version also creates its matching engine version.
      // Update that draft only; the previous published engine stays intact.
      const llm = await api.llm.update(draftEngine.llm_id, { ...plan.llm, version: existing.version });
      state.llmId = llm.llm_id; state.llmVersion = llm.version; saveState(state);
    } else if (!state.llmId || !matchesRehearsalSettings(await api.llm.retrieve(state.llmId, state.llmVersion == null ? undefined : { version: state.llmVersion }), plan.llm)) {
      phase = "create language model";
      const llm = await api.llm.create(plan.llm);
      state.llmId = llm.llm_id; state.llmVersion = llm.version; saveState(state);
    }
    if (!state.llmId) throw new Error("Rehearsal response engine is missing");
    const response_engine = { type: "retell-llm" as const, llm_id: state.llmId, version: state.llmVersion };
    phase = "create or update rehearsal agent";
    const agent = existing
      ? await api.agent.update(existing.agent_id, { ...plan.agent, response_engine, version: existing.version })
      : await api.agent.create({ ...plan.agent, response_engine });
    state.agentId = agent.agent_id; state.version = agent.version; state.publicUrl = publicUrl; state.published = false; saveState(state);
    phase = "publish rehearsal agent";
    // This endpoint may return an empty/non-JSON success body. Confirm the
    // publication by retrieving it below instead of parsing that body.
    await api.agent.publish(agent.agent_id, { version: agent.version }).asResponse();
    let verified = await api.agent.retrieve(agent.agent_id, { version: agent.version });
    for (let attempt = 0; !verified.is_published && attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      verified = await api.agent.retrieve(agent.agent_id, { version: agent.version });
    }
    const verifiedEngine = verified.response_engine;
    const verifiedLlm = verifiedEngine.type === "retell-llm" ? await api.llm.retrieve(verifiedEngine.llm_id, verifiedEngine.version == null ? undefined : { version: verifiedEngine.version }) : undefined;
    if (!verified.is_published || !matchesRehearsalSettings(verified, plan.agent) || !matchesRehearsalSettings(verifiedLlm, plan.llm)) throw new Error("Published rehearsal prompt and settings could not be verified");
    state.llmId = verifiedLlm!.llm_id; state.llmVersion = verifiedLlm!.version;
    state.published = true; saveState(state);
  }
  const token = process.env.HEARTBEAT_REHEARSAL_TOKEN || randomBytes(32).toString("base64url");
  saveEnv({ RETELL_REHEARSAL_AGENT_ID: state.agentId!, RETELL_REHEARSAL_AGENT_VERSION: String(state.version!), HEARTBEAT_REHEARSAL_PUBLIC_URL: publicUrl, HEARTBEAT_REHEARSAL_TOKEN: token, HEARTBEAT_REHEARSAL_ENABLED: "true" });
  writeFileSync(".local/rehearsal-presenter-token", token, { mode: 0o600 });
  mkdirSync("output/rehearsal", { recursive: true });
  writeFileSync("output/rehearsal/agent-prompt.txt", REHEARSAL_PROMPT);
  writeFileSync("output/rehearsal/provider-setup.json", JSON.stringify({ agentConfigured: true, published: true, callbackConfigured: true, callsPlaced: 0, recipientConfigured: Boolean(process.env.HEARTBEAT_REHEARSAL_PHONE), verifiedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ agentConfigured: true, published: true, callbackConfigured: true, callsPlaced: 0, recipientConfigured: Boolean(process.env.HEARTBEAT_REHEARSAL_PHONE), presenterTokenFile: ".local/rehearsal-presenter-token", promptFile: "output/rehearsal/agent-prompt.txt" }, null, 2));
}
void main().catch((error: unknown) => {
  const status = typeof error === "object" && error && "status" in error ? error.status : undefined;
  if (status === 400 && error instanceof Error) {
    let detail = error.message;
    for (const [key, value] of Object.entries(process.env)) if (value && value.length >= 6 && /KEY|TOKEN|SECRET|PASSWORD|PHONE|NUMBER|URL/.test(key)) detail = detail.split(value).join("[redacted]");
    console.error(`Provider validation: ${detail.replace(/https?:\/\/[^\s"<>]+/g, "[URL]").slice(0, 700)}`);
  }
  console.error(`Rehearsal agent setup did not complete during ${phase}${status ? ` (provider HTTP ${status})` : ""} (${error instanceof Error ? error.name : "error"}). Saved setup state is retained. No calls were placed; check required settings and the provider dashboard.`);
  process.exitCode = 1;
});
