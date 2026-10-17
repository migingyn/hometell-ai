import "./env";
import { supabaseAdmin } from "../lib/supabase";
import { approvedContacts } from "../lib/voice/actions";
import { researchWeb } from "../lib/voice/research";
import { configureVoiceAgent } from "./configure-voice-agent";

// Performs real read-only provider checks and one public search. Never dials.
async function main() {
  const required = ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_FROM_NUMBER", "EXA_API_KEY", "VOICE_PUBLIC_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length || process.env.MOCK_RETELL === "true") {
    console.error(JSON.stringify({ ready: false, missing, mockMode: process.env.MOCK_RETELL === "true", note: "No live requests or phone calls were made." }, null, 2));
    process.exitCode = 1;
    return;
  }
  const configuration = await configureVoiceAgent();
  const { error } = await supabaseAdmin().from("voice_actions").select("id").limit(1);
  if (error) throw new Error("Voice action storage is unavailable. Apply supabase/voice-actions.sql to the configured project.");
  const research = await researchWeb({ query: "What is the official website for the City of Los Angeles? Cite the city website." });
  if (research.status !== "grounded") throw new Error("The real internet lookup did not return usable sources.");
  const base = process.env.VOICE_PUBLIC_URL!.replace(/\/$/, "");
  const publicTool = await fetch(`${base}/api/retell/tools`, {
    method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000), cache: "no-store",
  });
  if (publicTool.status !== 401) throw new Error("The public tool endpoint is not reachable with signature authentication enabled.");
  console.log(JSON.stringify({
    ready: !configuration.changed,
    toolsConfigured: !configuration.changed,
    draftOnly: !configuration.published,
    approvedContacts: approvedContacts().length,
    liveResearch: research.status,
    sourceUrls: research.sources.map((source) => source.url),
    note: "Real search, provider configuration, database access and public endpoint checked. No phone call was placed; a caller-authorized call is still required to verify audio end to end.",
  }, null, 2));
  if (configuration.changed) process.exitCode = 1;
}

void main().catch(() => {
  console.error("Live voice verification failed. Check configured providers and the setup guide; no phone call was placed.");
  process.exitCode = 1;
});
