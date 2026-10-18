// Seeds 5 fake residents, today's nurse entry for 4 of them, and 6 days of past check-ins. Owner: Pitch.
// Usage: npx tsx scripts/seed.ts
// Wipes all residents first, which also clears their entries, calls, and alerts.
// SEED_PHONES is a comma separated list of teammates' numbers (E.164). Fake 555 numbers otherwise.
// All people and details here are made up. Never put real resident data in this file.
import "./env";
import { today } from "../lib/config";
import { supabaseAdmin } from "../lib/supabase";
import type { CallAnalysis, Client, DailyEntry, VitalsRanges } from "../lib/types";

const phones = (process.env.SEED_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const phone = (i: number) => phones[i] ?? `+1555000000${i + 1}`;

const STANDARD: VitalsRanges = {
  bp_sys: { min: 100, max: 150 },
  bp_dia: { min: 60, max: 95 },
  heart_rate: { min: 55, max: 100 },
  temp_f: { min: 96.8, max: 99.8 },
  spo2: { min: 92, max: 100 },
};

// personal_note is what the agent may bring up for one friendly exchange. Keep it light and specific.
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
    personal_note: "Grows tomatoes in the courtyard bed. Daughter Dana calls every Sunday. Loves Wheel of Fortune at 7.",
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
    personal_note: "Retired LA Metro bus driver. Big Dodgers fan. Right hip replaced last spring and still walks with a cane.",
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
    personal_note: "Prefers simple yes or no questions. Hard of hearing on the left. Grandson Mateo just started college in San Diego.",
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
    personal_note: "Has an orange cat named Biscuit. Watches baseball every afternoon. Served in the Navy.",
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
    personal_note: "Type 2 diabetic. Sings alto in the Tuesday choir. Likes to talk about her garden roses.",
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
  // Watch: oxygen at the low limit
  { client_id: 3, bp_sys: 130, bp_dia: 80, heart_rate: 76, temp_f: 98.4, spo2: 92, vitals_watch_note: "Oxygen a little low. Ask if breathing feels harder.", med_schedule_now: "Morning: metformin 500 mg with breakfast.", entered_by: "Nurse Patel" },
  // Normal
  { client_id: 4, bp_sys: 118, bp_dia: 74, heart_rate: 68, temp_f: 98.0, spo2: 98, vitals_watch_note: null, med_schedule_now: "Noon: one aspirin 81 mg with lunch.", entered_by: "Nurse Patel" },
];

// --- Past check-ins: one analyzed daily call per resident per day, 6 days back. ---

// One past day. Fields left out mean the agent did not ask.
type Day = Partial<CallAnalysis> & { summary: string; sentiment?: "Positive" | "Neutral" | "Negative" };
const fine = { feels_ok: "yes", med_taken: "yes", sleep_quality: "good", ate_and_drank: "yes", steady_on_feet: "yes", mood: "good" } as const;

// Oldest first. Index 0 is 6 days ago, index 5 is yesterday.
const HISTORY: Record<number, Day[]> = {
  1: [
    { ...fine, pain_level: 2, pain_location: "knee", summary: "Feels well. Mild knee stiffness in the morning." },
    { ...fine, pain_level: 2, pain_location: "knee", summary: "Doing well. Watered the tomatoes." },
    { ...fine, pain_level: 1, summary: "Good day. Talked about Wheel of Fortune." },
    { ...fine, pain_level: 3, pain_location: "knee", sleep_quality: "poor", summary: "Knee ached overnight and she slept poorly.", sentiment: "Neutral" },
    { ...fine, pain_level: 2, pain_location: "knee", summary: "Better today. Slept well." },
    { ...fine, pain_level: 1, new_personal_fact: "First ripe tomato of the season this week", summary: "Feels good. Picked her first ripe tomato." },
  ],
  2: [
    { ...fine, mood: "okay", pain_level: 3, pain_location: "hip", summary: "Hip a little sore. Took meds." },
    { ...fine, mood: "okay", pain_level: 3, pain_location: "hip", summary: "Same hip soreness. Walked to the dining room with his cane." },
    { ...fine, mood: "okay", pain_level: 4, pain_location: "hip", sleep_quality: "poor", summary: "Hip pain 4. Did not sleep well.", sentiment: "Neutral" },
    { ...fine, mood: "okay", pain_level: 5, pain_location: "hip", sleep_quality: "poor", summary: "Hip pain up to 5. Nurse followed up.", sentiment: "Negative" },
    { ...fine, mood: "okay", pain_level: 4, pain_location: "hip", summary: "Hip pain 4 after the nurse adjusted his pillow setup." },
    { ...fine, pain_level: 4, pain_location: "hip", new_personal_fact: "Excited the Dodgers are in the playoffs", summary: "Hip pain 4. In good spirits about the Dodgers." },
  ],
  3: [
    { ...fine, mood: "okay", summary: "Short answers. Says she is fine." },
    { ...fine, mood: "low", ate_and_drank: "no", summary: "Sounds low. Did not want breakfast.", sentiment: "Negative" },
    { ...fine, mood: "low", summary: "Still a little down. Ate lunch.", sentiment: "Neutral" },
    { ...fine, mood: "okay", summary: "Better today. Talked about her grandson." },
    { ...fine, mood: "okay", med_taken: "unsure", summary: "Unsure if she took her morning pill. Aide checked.", sentiment: "Neutral" },
    { ...fine, new_personal_fact: "Mateo called her from his dorm on Sunday", summary: "Happy. Her grandson Mateo called her." },
  ],
  4: [
    { ...fine, summary: "Feels good. Watched the game." },
    { ...fine, summary: "All fine. Biscuit slept on his lap all afternoon." },
    { ...fine, pain_level: 2, pain_location: "lower back", summary: "Slight back ache from sitting." },
    { ...fine, summary: "Doing well. Took aspirin with lunch." },
    { ...fine, summary: "Good day. Talked about his Navy ship." },
    { ...fine, new_personal_fact: "Biscuit knocked his reading glasses off the table again", summary: "Doing well. Laughed about Biscuit." },
  ],
  5: [
    { ...fine, summary: "Feels well. Choir practice was fun." },
    { ...fine, sleep_quality: "poor", summary: "Slept poorly. Otherwise fine.", sentiment: "Neutral" },
    { ...fine, summary: "Good. Checked her sugar with the aide." },
    { ...fine, new_swelling: true, summary: "Mentioned new ankle swelling. Nurse checked it.", sentiment: "Neutral" },
    { ...fine, summary: "Swelling better. Feels good." },
    { ...fine, new_personal_fact: "Her roses won a ribbon at the garden club", summary: "Happy. Her roses won a ribbon." },
  ],
};

// 10:00 local time on the day n days ago.
function daysAgo(n: number, minutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, minutes, 0, 0);
  return d;
}

function historyRows() {
  const calls: Record<string, unknown>[] = [];
  for (const [clientId, days] of Object.entries(HISTORY)) {
    days.forEach((day, i) => {
      const ago = 6 - i;
      const start = daysAgo(ago, Number(clientId) * 3);
      const { summary, sentiment, ...fields } = day;
      calls.push({
        // mock_ so the watchdog never looks these up in Retell
        call_id: `mock_seed_${clientId}_${ago}`,
        client_id: Number(clientId),
        call_type: "daily",
        status: "analyzed",
        started_at: start.toISOString(),
        ended_at: new Date(start.getTime() + 150_000).toISOString(),
        duration_sec: 150,
        disconnection_reason: "agent_hangup",
        summary,
        sentiment: sentiment ?? "Positive",
        call_successful: true,
        answered_by: "client",
        danger_words_heard: false,
        allergy_item_mentioned: false,
        dose_question_asked: false,
        needs_nurse: false,
        new_swelling: false,
        crisis_status: "not_crisis",
        ...fields,
        created_at: start.toISOString(),
      });
    });
  }
  return calls;
}

// A few past alerts, already handled, so alert history is not empty.
const PAST_ALERTS = [
  { client_id: 2, ago: 3, type: "pain", urgency: "today", message: "Pain 5, hip", quote: "It's worse at night.", by: "Nurse Kim" },
  { client_id: 3, ago: 5, type: "wellness", urgency: "today", message: "Not eating or drinking, low mood", quote: "Not really hungry.", by: "Nurse Patel" },
  { client_id: 3, ago: 2, type: "missed_med", urgency: "today", message: "Unsure about meds", quote: "Morning: metformin 500 mg with breakfast.", by: "Rosa (aide)" },
  { client_id: 5, ago: 3, type: "wellness", urgency: "today", message: "New swelling", quote: "My ankles look puffy.", by: "Nurse Kim" },
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

  const calls = historyRows();
  const history = await db.from("calls").insert(calls);
  if (history.error) throw new Error(history.error.message);

  const alerts = await db.from("alerts").insert(
    PAST_ALERTS.map((a) => {
      const at = daysAgo(a.ago, 30);
      return {
        client_id: a.client_id,
        call_id: `mock_seed_${a.client_id}_${a.ago}`,
        type: a.type,
        urgency: a.urgency,
        message: a.message,
        quote: a.quote,
        dedup_key: `mock_seed_${a.client_id}_${a.ago}:${a.type}`,
        created_at: at.toISOString(),
        acknowledged_at: new Date(at.getTime() + 20 * 60_000).toISOString(),
        acknowledged_by: a.by,
      };
    }),
  );
  if (alerts.error) throw new Error(alerts.error.message);

  console.log(`Seeded ${data.length} residents, ${ENTRIES.length} entries for ${date}, ${calls.length} past calls, ${PAST_ALERTS.length} handled alerts`);
  console.table(data.map((c) => ({ ...c, phone: c.phone.replace(/^(\+1)\d{6}/, "$1******") })));
  if (!phones.length) console.log("No SEED_PHONES set, so phones are fake 555 numbers. Real calls will fail.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
