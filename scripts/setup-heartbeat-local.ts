// Copies only this local Supabase project's keys into a private rehearsal env.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";

const output = execFileSync("npx", ["--yes", "supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const status = JSON.parse(output) as Record<string, string>;
if (status.API_URL !== "http://127.0.0.1:55321" || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error("Start this project's local Supabase stack on port 55321 first. No env file was changed.");
}
const path = ".env.local";
const current = existsSync(path) ? readFileSync(path, "utf8") : "";
const existingUrl = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(current)?.[1]?.replace(/^['"]|['"]$/g, "");
if (existingUrl && existingUrl !== status.API_URL) throw new Error("An existing database URL is configured. It was preserved; use a separate rehearsal environment.");
const settings = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  MOCK_RETELL: "true", DEMO_TIME_SCALE: "0.05", FICTIONAL_CLIENTS: "true",
  APP_URL: "http://localhost:3017", AGENCY_NAME: "Sunrise Home Care", CLASSIFIER: "retell",
};
let result = current;
for (const [key, value] of Object.entries(settings)) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  result = pattern.test(result) ? result.replace(pattern, line) : `${result.trimEnd()}\n${line}\n`;
}
writeFileSync(path, result.trimStart(), { mode: 0o600 });
chmodSync(path, 0o600);
console.log("Local Supabase rehearsal configured in .env.local. MOCK_RETELL=true; no calls will be placed. No credentials printed.");
