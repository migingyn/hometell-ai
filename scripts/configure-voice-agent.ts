import "./env";
import { buildRetellTools, VOICE_TOOL_PROMPT } from "../lib/voice/tool-definitions";

type JsonRecord = Record<string, unknown>;
const START = "[BEGIN LIVE VOICE TOOLS]";
const END = "[END LIVE VOICE TOOLS]";
const API = "https://api.retellai.com";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only managed tools and the marked prompt section are replaced on repeat runs. */
export function buildLlmUpdate(current: JsonRecord, tools: JsonRecord[]) {
  if (current.general_tools != null && !Array.isArray(current.general_tools)) {
    throw new Error("The existing Retell tools are malformed; configuration was not changed.");
  }
  if (current.general_prompt != null && typeof current.general_prompt !== "string") {
    throw new Error("The existing Retell prompt is malformed; configuration was not changed.");
  }
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (byName.size !== tools.length || tools.some((tool) => typeof tool.name !== "string")) {
    throw new Error("Voice tool names must be unique strings.");
  }
  const existing = (current.general_tools ?? []) as unknown[];
  const merged: unknown[] = [];
  const inserted = new Set<unknown>();
  for (const tool of existing) {
    const name = isRecord(tool) ? tool.name : undefined;
    if (byName.has(name)) {
      if (!inserted.has(name)) merged.push(byName.get(name));
      inserted.add(name);
    } else {
      merged.push(tool);
    }
  }
  for (const tool of tools) if (!inserted.has(tool.name)) merged.push(tool);

  const original = (current.general_prompt ?? "") as string;
  const section = `${START}\n${VOICE_TOOL_PROMPT}\n${END}`;
  const start = original.indexOf(START);
  const end = original.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) {
    throw new Error("The existing managed voice prompt section is incomplete; configuration was not changed.");
  }
  const generalPrompt = start < 0
    ? `${original}${original ? "\n\n" : ""}${section}`
    : original.slice(0, start) + section + original.slice(end + END.length);

  if (current.default_dynamic_variables != null && !isRecord(current.default_dynamic_variables)) {
    throw new Error("The existing Retell dynamic variables are malformed; configuration was not changed.");
  }
  const defaultVariables: JsonRecord = {
    ...(current.default_dynamic_variables ?? {}) as JsonRecord,
    call_role: "primary",
    voice_task: "No delegated task",
  };
  return {
    general_tools: merged,
    general_prompt: generalPrompt,
    default_dynamic_variables: defaultVariables,
  };
}

export function validatePublicUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.includes(":") || host === "[::1]" || host === "0.0.0.0" ||
    /^(?:127|10|0)\./.test(host) || /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol !== "https:" || url.username || url.password || privateHost || url.search || url.hash) {
    throw new Error("The voice public URL must be public HTTPS without credentials, query parameters, or a fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

async function request(path: string, apiKey: string, method = "GET", body?: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Retell configuration request failed (${response.status}); no response body was logged.`);
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error("Retell returned invalid configuration data."); }
  if (!isRecord(result)) throw new Error("Retell returned invalid configuration data.");
  return result;
}

/** Dry-run reads the current agent and LLM; only --apply sends a mutation. */
export async function configureVoiceAgent(options: { apply?: boolean; publicUrl?: string; agentId?: string } = {}) {
  const required = ["RETELL_API_KEY", ...(!options.agentId?.trim() ? ["RETELL_AGENT_ID"] : [])];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}. No agent was changed.`);
  const publicValue = options.publicUrl || process.env.VOICE_PUBLIC_URL || process.env.APP_URL;
  if (!publicValue) throw new Error("Missing VOICE_PUBLIC_URL. Set the public HTTPS app address; no agent was changed.");
  const publicUrl = validatePublicUrl(publicValue);
  const apiKey = process.env.RETELL_API_KEY!.trim();
  const agentId = options.agentId?.trim() || process.env.RETELL_AGENT_ID!.trim();
  const agentBase = `/get-agent/${encodeURIComponent(agentId)}`;
  const agent = await request(agentBase, apiKey);
  const engine = agent.response_engine;
  if (!isRecord(engine) || engine.type !== "retell-llm" || typeof engine.llm_id !== "string") {
    throw new Error("This agent uses a custom LLM or conversation flow. Configure its tools explicitly; no configuration was changed.");
  }
  const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const engineQuery = isVersion(engine.version) ? `?version=${engine.version}` : "";
  const llmBase = `/get-retell-llm/${encodeURIComponent(engine.llm_id)}`;
  const current = await request(`${llmBase}${engineQuery}`, apiKey);
  const resolvedVersion = isVersion(engine.version) ? engine.version : current.version;
  const versionQuery = isVersion(resolvedVersion) ? `?version=${resolvedVersion}` : "";
  const llmPath = `${llmBase}${versionQuery}`;
  const tools = buildRetellTools(publicUrl);
  const update = buildLlmUpdate(current, tools);
  const llmChanged = JSON.stringify(update) !== JSON.stringify({
    general_tools: current.general_tools,
    general_prompt: current.general_prompt,
    default_dynamic_variables: current.default_dynamic_variables,
  });
  const webhookUrl = `${new URL(publicUrl).origin}/api/retell/webhook`;
  const existingEvents = agent.webhook_events;
  if (existingEvents != null && (!Array.isArray(existingEvents) || existingEvents.some((event) => typeof event !== "string"))) {
    throw new Error("Existing Retell webhook events are malformed; no configuration was changed.");
  }
  const webhookEvents = existingEvents == null
    ? null
    : [...new Set([...(existingEvents as string[]), "call_ended", "call_analyzed"])];
  const agentUpdate = {
    webhook_url: webhookUrl,
    ...(webhookEvents ? { webhook_events: webhookEvents } : {}),
  };
  const webhookConfigured = agent.webhook_url === webhookUrl &&
    (existingEvents == null || ["call_ended", "call_analyzed"].every((event) => (existingEvents as string[]).includes(event)));
  const changed = llmChanged || !webhookConfigured;
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    changed,
    webhookConfigured,
    managedTools: tools.map((tool) => tool.name),
    preservedTools: (Array.isArray(current.general_tools) ? current.general_tools : [])
      .filter((tool) => !isRecord(tool) || !tools.some((managed) => managed.name === tool.name)).length,
    published: agent.is_published === true || current.is_published === true,
  };
  if (!options.apply || !changed) return summary;
  if (summary.published) {
    throw new Error("The configured agent or LLM is published. Create an editable draft in Retell, review the dry-run, and apply to that draft before publishing.");
  }
  const latest = await request(llmPath, apiKey);
  const agentQuery = isVersion(agent.version) ? `?version=${agent.version}` : "";
  const latestAgent = await request(`${agentBase}${agentQuery}`, apiKey);
  if (latest.last_modification_timestamp !== current.last_modification_timestamp ||
      latestAgent.last_modification_timestamp !== agent.last_modification_timestamp) {
    throw new Error("The Retell configuration changed during this run. Run the dry-run again; no update was sent.");
  }
  if (llmChanged) await request(`/update-retell-llm/${encodeURIComponent(engine.llm_id)}${versionQuery}`, apiKey, "PATCH", update);
  if (!webhookConfigured) {
    try {
      await request(`/update-agent/${encodeURIComponent(agentId)}${agentQuery}`, apiKey, "PATCH", agentUpdate);
    } catch {
      throw new Error("The draft LLM may have updated, but the agent webhook could not be saved. Run the dry-run again before publishing.");
    }
  }
  return { ...summary, webhookConfigured: true };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run voice:configure -- [--apply] [--public-url=https://your-app.example] [--agent-id=agent_id]\nDefault: dry-run; reads configuration and prints a summary with no secrets. Requires RETELL_API_KEY, RETELL_AGENT_ID (or --agent-id), and VOICE_PUBLIC_URL (or public HTTPS APP_URL). --apply patches tools, prompt, and the webhook on the existing draft; publish the reviewed draft in Retell to activate it. Configure a separate delegate agent by running again with --agent-id.");
    return;
  }
  const unknown = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--public-url=") && !arg.startsWith("--agent-id="));
  if (unknown.length) throw new Error("Unknown option. Use --help for supported options.");
  const publicUrl = args.find((arg) => arg.startsWith("--public-url="))?.slice("--public-url=".length);
  const agentId = args.find((arg) => arg.startsWith("--agent-id="))?.slice("--agent-id=".length);
  const result = await configureVoiceAgent({ apply: args.includes("--apply"), publicUrl, agentId });
  console.log(JSON.stringify(result, null, 2));
  if (!args.includes("--apply")) console.log("Dry-run only. Run with --apply to update the reviewed draft configuration.");
}

if (/configure-voice-agent\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  void main().catch((error: unknown) => {
    // Error text is limited to our own messages; never log API responses or credentials.
    console.error(error instanceof Error ? error.message : "Voice agent configuration failed.");
    process.exitCode = 1;
  });
}
