// Seeds 10 clients: 3 red, 4 yellow, 3 green. Owner: Pitch.
// Usage: npx tsx scripts/seed.ts
// Deletes all clients first, which also clears their checks and call logs.
import "./env";
import { supabaseAdmin } from "../lib/supabase";
import type { Client } from "../lib/types";

// TODO(Pitch): replace the 555 numbers with teammates' real phones (E.164) and real names.
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
  const db = supabaseAdmin();
  // Events go too so the dashboard starts empty.
  const delEvents = await db.from("events").delete().not("id", "is", null);
  if (delEvents.error) throw new Error(delEvents.error.message);
  const delClients = await db.from("clients").delete().not("id", "is", null);
  if (delClients.error) throw new Error(delClients.error.message);

  const { data, error } = await db.from("clients").insert(CLIENTS).select("name, risk_tier");
  if (error) throw new Error(error.message);
  console.log(`Seeded ${data.length} clients`);
  console.table(data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
