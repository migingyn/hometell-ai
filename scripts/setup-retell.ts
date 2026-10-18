// Points the Retell agent at this server, through the Retell SDK. Owner: Mikey.
// Dry run by default: prints what it would change and changes nothing.
//   npx tsx scripts/setup-retell.ts             show the plan
//   npx tsx scripts/setup-retell.ts --apply     update the agent draft and its LLM
//   npx tsx scripts/setup-retell.ts --apply --publish   then publish that draft
// Needs RETELL_API_KEY. URL changes also need PUBLIC_BASE_URL (your ngrok https URL).
// A published version cannot be edited, so when the latest version is published the script
// makes a new draft from it, edits that, publishes it, and points the phone number at it.
import "./env";
import type Retell from "retell-sdk";
import { config } from "../lib/config";
import { DYNAMIC_VARIABLE_NAMES, retell } from "../lib/retell";

const apply = process.argv.includes("--apply");
const publish = process.argv.includes("--publish");
const MAX_CALL_MS = 5 * 60 * 1000;
const CONTEXT_MARKER = "## Call context";

type Tool = { type: string; name: string; url?: string; args_at_root?: boolean };

// A block at the top of the prompt, ended by a blank line so every variable reaches the agent as {{name}}.
function contextBlock(vars: string[]): string {
  return [
    CONTEXT_MARKER,
    "These values are filled in for this call. Use them in the steps below.",
    ...vars.map((v) => `- ${v}: {{${v}}}`),
  ].join("\n");
}

// Adds the block, or replaces an earlier one. Leaves the rest of the prompt alone.
// toolText covers variables only tools use, like {{nurse_phone}} in the transfer tool.
function withContext(prompt: string, toolText: string): string | null {
  const rest = prompt.startsWith(CONTEXT_MARKER) ? prompt.slice(prompt.indexOf("\n\n") + 2) : prompt;
  const missing = DYNAMIC_VARIABLE_NAMES.filter((v) => !`${rest}${toolText}`.includes(`{{${v}}}`));
  if (!missing.length) return prompt === rest ? null : rest;
  const next = `${contextBlock(missing)}\n\n${rest}`;
  return next === prompt ? null : next;
}

async function main() {
  const r = retell();
  const base = config.publicBaseUrl;
  const agent = await r.agent.retrieve(config.retellAgentId);
  if (agent.response_engine.type !== "retell-llm") throw new Error(`Agent uses ${agent.response_engine.type}. This script only edits retell-llm agents`);
  const llm = await r.llm.retrieve(agent.response_engine.llm_id, { version: agent.response_engine.version ?? undefined });

  const agentChanges: Retell.AgentUpdateParams = {};
  const llmChanges: Retell.LlmUpdateParams = {};
  const plan: string[] = [];

  if (base) {
    const webhook = `${base}/retell-webhook`;
    if (agent.webhook_url !== webhook) {
      agentChanges.webhook_url = webhook;
      plan.push(`agent webhook_url: ${agent.webhook_url ?? "(none)"} -> ${webhook}`);
    }
  } else {
    plan.push("skip URLs: PUBLIC_BASE_URL is not set");
  }

  const max = agent.max_call_duration_ms;
  if (max == null || max < 3 * 60000 || max > 6 * 60000) {
    agentChanges.max_call_duration_ms = MAX_CALL_MS;
    plan.push(`agent max_call_duration_ms: ${max ?? "(default)"} -> ${MAX_CALL_MS}`);
  }

  const tools = (llm.general_tools ?? []) as Tool[];
  const flagUrl = base ? `${base}/retell/functions/flag-nurse` : null;
  let toolsChanged = false;
  const nextTools = tools.map((t) => {
    if (t.name !== "flag_nurse") return t;
    const next = { ...t, args_at_root: false, ...(flagUrl ? { url: flagUrl } : {}) };
    if (next.url !== t.url || t.args_at_root) {
      toolsChanged = true;
      plan.push(`flag_nurse url: ${t.url} -> ${next.url}${t.args_at_root ? ", args_at_root off" : ""}`);
    }
    return next;
  });
  if (!tools.some((t) => t.name === "flag_nurse")) plan.push("WARNING: no flag_nurse tool on the LLM. Add it in the Retell dashboard");
  if (toolsChanged) llmChanges.general_tools = nextTools as Retell.LlmUpdateParams["general_tools"];

  const prompt = withContext(llm.general_prompt ?? "", JSON.stringify(tools));
  if (prompt !== null) {
    llmChanges.general_prompt = prompt;
    plan.push(`prompt: add "${CONTEXT_MARKER}" block at the top:\n${prompt.slice(0, prompt.indexOf("\n\n"))}`);
  }

  console.log(`Agent "${agent.agent_name}" version ${agent.version}, ${agent.is_published ? "published" : "draft"}. LLM ${llm.llm_id}.`);
  console.log(plan.length ? plan.map((p) => `- ${p}`).join("\n") : "- nothing to change");
  if (!config.nursePhone) console.log("- note: set NURSE_PHONE so transfer_to_nurse has a number to dial");

  const changes = Object.keys(llmChanges).length + Object.keys(agentChanges).length > 0;
  if (changes && agent.is_published) console.log(`- version ${agent.version} is published, so a new draft is made from it`);
  if (!apply) return console.log("\nDry run. Add --apply to make these changes.");
  if (!changes && !publish) return console.log("\nNothing to apply.");
  if (!changes && agent.is_published) return console.log("\nNothing to apply. The published version is current.");

  // Published versions are read-only. Edit a new draft made from the latest version instead.
  let draft = agent;
  if (changes && agent.is_published) {
    draft = (await r.agent.createVersion(agent.agent_id, { base_version: agent.version })) as Retell.AgentResponse;
    console.log(`\nCreated draft version ${draft.version} from version ${agent.version}.`);
  }
  const llmVersion = draft.response_engine.type === "retell-llm" ? (draft.response_engine.version ?? undefined) : undefined;
  if (Object.keys(llmChanges).length) await r.llm.update(llm.llm_id, { ...llmChanges, version: llmVersion });
  if (Object.keys(agentChanges).length) await r.agent.update(agent.agent_id, { ...agentChanges, version: draft.version });
  if (changes) console.log(`Applied to version ${draft.version}.`);

  if (!publish) return console.log("Not published. Add --publish, or publish in the Retell dashboard.");
  // retell-sdk 6.2.8 throws "Unexpected end of JSON input" on publish's empty reply,
  // even when it worked. Re-read the agent to see what really happened.
  await r.agent
    .publish(agent.agent_id, { version: draft.version, version_description: "Heartbeat backend URLs and call context" })
    .catch((e) => console.log(`publish reply: ${e instanceof Error ? e.message : e}`));
  const after = await r.agent.retrieve(agent.agent_id, { version: draft.version });
  if (!after.is_published) throw new Error(`Version ${draft.version} is not published. Publish it in the Retell dashboard`);
  console.log(`Published version ${draft.version}.`);

  // A number bound to "latest_published" follows the publish on its own. One pinned to an
  // older version number would keep using it, so point it at the one just published.
  const pn = await r.phoneNumber.retrieve(config.retellFromNumber);
  const bound = pn.outbound_agents?.find((a) => a.agent_id === agent.agent_id);
  if (bound && typeof bound.agent_version === "number" && bound.agent_version !== draft.version) {
    await r.phoneNumber.update(config.retellFromNumber, {
      outbound_agents: (pn.outbound_agents ?? []).map((a) => (a.agent_id === agent.agent_id ? { ...a, agent_version: draft.version } : a)),
    });
    console.log(`${config.retellFromNumber} now uses version ${draft.version} (was ${bound.agent_version}).`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
