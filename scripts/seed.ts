// Seeds 5 fake residents and today's nurse entry for 4 of them. Owner: Pitch.
// Usage: npx tsx scripts/seed.ts
// Wipes all residents first, which also clears their entries, calls, and alerts.
// SEED_PHONES is a comma separated list of teammates' numbers (E.164). Fake 555 numbers otherwise.
import "./env";
import { today } from "../lib/config";
import { supabaseAdmin } from "../lib/supabase";
import type { Client, DailyEntry, VitalsRanges } from "../lib/types";

const phones = (process.env.SEED_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const phone = (i: number) => phones[i] ?? `+1555000000${i + 1}`;

const STANDARD: VitalsRanges = {
  bp_sys: { min: 100, max: 150 },
  bp_dia: { min: 60, max: 95 },
  heart_rate: { min: 55, max: 100 },
  temp_f: { min: 96.8, max: 99.8 },
  spo2: { min: 92, max: 100 },
};

type SeedClient = Omit<Client, "created_at">;
const CLIENTS: SeedClient[] = [
  {
    id: 1,
    name: "Margaret Ellis",
    preferred_name: "Maggie",
    room: "101",
    phone: phone(0),
    aide_name: "Rosa",
    nurse_name: "Nurse Kim",
    allergies: "penicillin, peanuts",
    personal_note: "Loves gardening. Daughter Dana calls on Sundays.",
    vitals_ranges: STANDARD,
  },
  {
    id: 2,
    name: "Harold Kim",
    preferred_name: "Harold",
    room: "104",
    phone: phone(1),
    aide_name: "James",
    nurse_name: "Nurse Kim",
    allergies: "shellfish",
    personal_note: "Retired bus driver. Hip replacement last spring.",
    vitals_ranges: { ...STANDARD, bp_sys: { min: 110, max: 160 } },
  },
  {
    id: 3,
    name: "Rosa Alvarez",
    preferred_name: "Rosita",
    room: "112",
    phone: phone(2),
    aide_name: "Rosa",
    nurse_name: "Nurse Patel",
    allergies: null,
    personal_note: "Prefers simple yes or no questions. Hard of hearing on the left.",
    vitals_ranges: STANDARD,
  },
  {
    id: 4,
    name: "Walter Brooks",
    preferred_name: "Walt",
    room: "118",
    phone: phone(3),
    aide_name: "Lena",
    nurse_name: "Nurse Patel",
    allergies: "latex",
    personal_note: "Watches baseball every afternoon.",
    vitals_ranges: STANDARD,
  },
  {
    id: 5,
    name: "Evelyn Shah",
    preferred_name: "Evie",
    room: "203",
    phone: phone(4),
    aide_name: "James",
    nurse_name: "Nurse Kim",
    allergies: "sulfa drugs",
    personal_note: "Diabetic. Sings in the Tuesday choir.",
    vitals_ranges: { ...STANDARD, heart_rate: { min: 60, max: 95 } },
  },
];

type SeedEntry = Omit<DailyEntry, "id" | "created_at" | "date">;
// Evelyn (5) has no entry on purpose: the "no vitals entered" case.
const ENTRIES: SeedEntry[] = [
  // Normal
  { client_id: 1, bp_sys: 124, bp_dia: 78, heart_rate: 72, temp_f: 98.2, spo2: 97, vitals_watch_note: null, med_schedule_now: "Morning: lisinopril 10 mg with breakfast. Evening: none.", entered_by: "Nurse Kim" },
  // Alert: blood pressure over range
  { client_id: 2, bp_sys: 168, bp_dia: 92, heart_rate: 84, temp_f: 98.6, spo2: 95, vitals_watch_note: "BP high this morning. Ask about headache or blurry vision.", med_schedule_now: "Morning: amlodipine 5 mg. Take with water.", entered_by: "Nurse Kim" },
  // Watch: oxygen near the low limit
  { client_id: 3, bp_sys: 130, bp_dia: 80, heart_rate: 76, temp_f: 98.4, spo2: 92, vitals_watch_note: "Oxygen a little low. Ask if breathing feels harder.", med_schedule_now: "Morning: metformin 500 mg with breakfast.", entered_by: "Nurse Patel" },
  // Normal
  { client_id: 4, bp_sys: 118, bp_dia: 74, heart_rate: 68, temp_f: 98.0, spo2: 98, vitals_watch_note: null, med_schedule_now: "Noon: one aspirin 81 mg with lunch.", entered_by: "Nurse Patel" },
];

async function main() {
  const db = supabaseAdmin();
  const runs = await db.from("crisis_runs").delete().not("id", "is", null);
  if (runs.error) throw new Error(runs.error.message);
  const del = await db.from("clients").delete().not("id", "is", null);
  if (del.error) throw new Error(del.error.message);

  const { data, error } = await db.from("clients").insert(CLIENTS).select("id, name, room, phone");
  if (error) throw new Error(error.message);
  const date = today();
  const entries = await db.from("daily_entries").insert(ENTRIES.map((e) => ({ ...e, date })));
  if (entries.error) throw new Error(entries.error.message);

  console.log(`Seeded ${data.length} residents and ${ENTRIES.length} entries for ${date}`);
  console.table(data);
  if (!phones.length) console.log("No SEED_PHONES set, so phones are fake 555 numbers. Real calls will fail.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
