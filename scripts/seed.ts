// Seeds 10 clients: 3 red, 4 yellow, 3 green. Owner: Pitch.
// Usage: npx tsx scripts/seed.ts
// Refuses a nonempty database unless --replace is supplied explicitly.
import "./env";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import type { Client } from "../lib/types";

// Display identities remain fictional even when private teammate numbers are used.
const CLIENTS: Omit<Client, "id">[] = [
  c("Margaret Ellis", "+15550000001", "red", true, true, "Dana Ellis", "+15550001001", "09:00"),
  c("Harold Kim", "+15550000002", "red", true, true, "Grace Kim", "+15550001002", "08:30"),
  c("Rosa Alvarez", "+15550000003", "red", true, false, "Luis Alvarez", "+15550001003", null),
  c("Walter Brooks", "+15550000004", "yellow", true, false, "Ann Brooks", "+15550001004", "10:00"),
  c("Evelyn Shah", "+15550000005", "yellow", false, true, "Ravi Shah", "+15550001005", null),
  c("Frank Novak", "+15550000006", "yellow", true, false, "Mia Novak", "+15550001006", "11:00"),
  c("Doris Chen", "+15550000007", "yellow", false, false, "Tom Chen", "+15550001007", null),
  c("George Okafor", "+15550000008", "green", false, false, "Ada Okafor", "+15550001008", null),
  c("Lillian Park", "+15550000009", "green", false, false, "Sam Park", "+15550001009", "09:30"),
  c("Arthur Reyes", "+15550000010", "green", false, false, "Nina Reyes", "+15550001010", null),
];

function c(
  name: string,
  phone: string,
  risk_tier: Client["risk_tier"],
  lives_alone: boolean,
  uses_powered_equipment: boolean,
  emergency_contact_name: string,
  emergency_contact_phone: string,
  usual_pickup_time: string | null,
): Omit<Client, "id"> {
  return {
    name,
    phone,
    risk_tier,
    lives_alone,
    uses_powered_equipment,
    emergency_contact_name,
    emergency_contact_phone,
    usual_pickup_time,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npx tsx scripts/seed.ts [--replace]\nReads scripts/seed.local.json, or uses fictional 555 numbers in mock mode. Default refuses nonempty clients/events. --replace explicitly clears clients, events, and dependent checks/logs.");
    return;
  }
  if (args.some((arg) => arg !== "--replace")) throw new Error("Unknown seed option. Use --help.");
  let local: unknown;
  if (existsSync("scripts/seed.local.json")) {
    try { local = JSON.parse(readFileSync("scripts/seed.local.json", "utf8")); }
    catch { throw new Error("seed.local.json is not valid JSON. No rows were changed."); }
  } else if (process.env.MOCK_RETELL !== "true") {
    throw new Error("Live seeding requires seed.local.json with consenting teammates. The 555 fallback requires MOCK_RETELL=true.");
  }
  const clients = buildSeedClients(local);
  const db = supabaseAdmin();
  const [existingClients, existingEvents] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }),
    db.from("events").select("id", { count: "exact", head: true }),
  ]);
  if (existingClients.error || existingEvents.error) throw new Error("Cannot inspect existing database records. No rows were changed.");
  if ((existingClients.count || existingEvents.count) && !args.includes("--replace")) throw new Error("Seed refused: clients/events already contain data. Review the project and use --replace only when intentionally clearing rehearsal data.");
  if (args.includes("--replace")) {
    const events = await db.from("events").delete().not("id", "is", null);
    if (events.error) throw new Error("Could not clear rehearsal events. Seed stopped.");
    const removed = await db.from("clients").delete().not("id", "is", null);
    if (removed.error) throw new Error("Could not clear rehearsal clients. Seed stopped.");
  }
  const { error } = await db.from("clients").insert(clients);
  if (error) throw new Error("Could not seed clients. Confirm the Heartbeat migration is applied.");
  console.log(`Seeded ${clients.length} fictional identities with ${local === undefined ? "mock 555 numbers" : "consenting teammate numbers from the private local file"}. No phone numbers were logged.`);
}

const E164 = /^\+[1-9]\d{7,14}$/;
const Participant = z.object({
  name: z.string().trim().min(1).max(100), phone: z.string().regex(E164), consent: z.literal(true),
  emergency_contact: z.object({ name: z.string().trim().min(1).max(100), phone: z.string().regex(E164), consent: z.literal(true) }).strict(),
  language: z.enum(["en", "ko"]).default("en"),
}).strict();
const LocalSeed = z.object({ clients: z.array(Participant).min(1).max(10) }).strict();

export function buildSeedClients(local?: unknown): Omit<Client, "id">[] {
  const result = local === undefined ? undefined : LocalSeed.safeParse(local);
  if (result && !result.success) throw new Error("seed.local.json requires 1–10 named teammates, E.164 phone numbers, and consent:true for each client and emergency contact. See docs/RETELL_AGENTS.md.");
  const people = result?.success ? result.data.clients : undefined;
  if (people && new Set(people.map((person) => person.phone)).size !== people.length) throw new Error("Each client must use a different consenting teammate number.");
  return CLIENTS.slice(0, people?.length ?? 10).map((client, index) => ({
    ...client,
    phone: people?.[index].phone ?? client.phone,
    emergency_contact_phone: people?.[index].emergency_contact.phone ?? client.emergency_contact_phone,
    language: people?.[index].language ?? "en", needs_ride: false, last_daily_at: null,
    // Approximate fictional map points, never participant home addresses.
    lat: 34.184 + Math.floor(index / 3) * 0.004, lng: -118.158 + (index % 3) * 0.004,
  }));
}

if (/seed\.(?:ts|js)$/.test(process.argv[1] ?? "")) void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed failed.");
  process.exitCode = 1;
});
