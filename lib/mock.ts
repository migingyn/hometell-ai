// Demo scenarios that replay Retell events through the real handlers. No phone calls.
import { activeCrisisRun } from "@/lib/db";
import { crisisOrder, openCrisisRun, sleep } from "@/lib/crisis";
import { startCall } from "@/lib/retell";
import { handleFlagNurse, handleRetellEvent } from "@/lib/webhook";
import type { CallType, CrisisRun, CrisisType, DisconnectionReason, RetellCall } from "@/lib/types";

type Scenario = {
  call_type: CallType;
  transcript?: string; // "Agent:" and "User:" lines, like Retell sends
  analysis?: Record<string, unknown>;
  summary?: string;
  sentiment?: "Positive" | "Neutral" | "Negative" | "Unknown";
  disconnection_reason?: DisconnectionReason;
  duration_sec?: number;
  flag_nurse?: { reason: string; urgency: "now" | "today"; quote: string };
  started_only?: boolean; // Leave the line open
  no_analysis?: boolean; // Stop after call_ended
};

// Defaults for a call where nothing was asked. Scenarios override what they need.
const BLANK = {
  feels_ok: "unsure",
  danger_words_heard: false,
  med_taken: "not_asked",
  allergy_item_mentioned: false,
  dose_question_asked: false,
  needs_nurse: false,
  needs_nurse_reason: "",
  new_personal_fact: "",
  answered_by: "client",
  pain_level: "",
  pain_location: "",
  sleep_quality: "not_asked",
  ate_and_drank: "not_asked",
  steady_on_feet: "not_asked",
  mood: "not_asked",
  new_swelling: false,
  crisis_status: "not_crisis",
};

const DAILY_OK = {
  ...BLANK,
  feels_ok: "yes",
  med_taken: "yes",
  sleep_quality: "good",
  ate_and_drank: "yes",
  steady_on_feet: "yes",
  mood: "good",
  pain_level: 0,
};

export const SCENARIOS: Record<string, Scenario> = {
  ok: {
    call_type: "daily",
    transcript: "Agent: Good morning! How are you feeling today?\nUser: Good. I slept well.\nAgent: Did you take your morning pills?\nUser: Yes, with breakfast.",
    analysis: { ...DAILY_OK, new_personal_fact: "Granddaughter visits Sunday" },
    summary: "Resident feels well, slept well, took morning meds. Granddaughter visits Sunday.",
    sentiment: "Positive",
    duration_sec: 95,
  },
  dizzy: {
    call_type: "daily",
    transcript: "Agent: How are you feeling today?\nUser: I feel a little dizzy when I stand up.\nAgent: I'm going to let your nurse know right away.",
    analysis: { ...DAILY_OK, feels_ok: "no", danger_words_heard: true, needs_nurse: true, needs_nurse_reason: "Dizzy when standing", steady_on_feet: "no" },
    summary: "Resident reports dizziness when standing.",
    sentiment: "Negative",
    duration_sec: 70,
  },
  missed_med: {
    call_type: "daily",
    transcript: "Agent: Did you take your morning pills?\nUser: No. I forgot.",
    analysis: { ...DAILY_OK, med_taken: "no" },
    summary: "Resident did not take morning meds.",
    sentiment: "Neutral",
    duration_sec: 80,
  },
  dose_question: {
    call_type: "daily",
    transcript: "Agent: Did you take your pills?\nUser: Yes. Should I take two of the white ones now?\nAgent: I'll have your nurse call you about that.",
    analysis: { ...DAILY_OK, dose_question_asked: true },
    summary: "Resident asked whether to take two of a pill. Agent deferred to nurse.",
    sentiment: "Neutral",
    duration_sec: 85,
  },
  allergy: {
    call_type: "daily",
    transcript: "Agent: What did you have for breakfast?\nUser: Peanut butter toast. My neighbor brought it.",
    analysis: { ...DAILY_OK, allergy_item_mentioned: true, needs_nurse_reason: "Ate peanut butter toast" },
    summary: "Resident ate peanut butter toast from a neighbor.",
    sentiment: "Positive",
    duration_sec: 90,
  },
  pain_high: {
    call_type: "daily",
    transcript: "Agent: Any pain today?\nUser: My hip. It's bad.\nAgent: From zero to ten?\nUser: Eight.",
    analysis: { ...DAILY_OK, feels_ok: "no", pain_level: 8, pain_location: "hip", needs_nurse_reason: "My hip. It's bad." },
    summary: "Resident reports hip pain at 8 out of 10.",
    sentiment: "Negative",
    duration_sec: 100,
  },
  pain_mid: {
    call_type: "daily",
    transcript: "Agent: Any pain today?\nUser: My back, some.\nAgent: From zero to ten?\nUser: Five maybe.",
    analysis: { ...DAILY_OK, pain_level: 5, pain_location: "back" },
    summary: "Resident reports back pain at 5 out of 10.",
    sentiment: "Neutral",
    duration_sec: 95,
  },
  low_mood_not_eating: {
    call_type: "daily",
    transcript: "Agent: How are you feeling?\nUser: Eh.\nAgent: Did you eat breakfast?\nUser: Not really.\nAgent: How did you sleep?\nUser: Not good.",
    analysis: { ...DAILY_OK, feels_ok: "unsure", ate_and_drank: "no", mood: "low", sleep_quality: "poor" },
    summary: "Short answers. Resident did not eat, slept poorly, sounds low.",
    sentiment: "Negative",
    duration_sec: 75,
  },
  voicemail: {
    call_type: "daily",
    disconnection_reason: "voicemail_reached",
    analysis: { ...BLANK, answered_by: "voicemail", feels_ok: "" },
    summary: "Call reached voicemail.",
    sentiment: "Unknown",
    duration_sec: 20,
  },
  open_line: { call_type: "daily", started_only: true },
  crisis_safe: {
    call_type: "crisis",
    transcript: "Agent: We are checking on everyone during the heat wave. Are you okay?\nUser: Yes. I have my fan and water.",
    analysis: { ...BLANK, feels_ok: "yes", crisis_status: "safe" },
    summary: "Resident says they have a fan and water.",
    sentiment: "Positive",
    duration_sec: 50,
  },
  crisis_needs_help: {
    call_type: "crisis",
    transcript: "Agent: Are you okay right now?\nUser: It's hot in here. No water.",
    analysis: { ...BLANK, feels_ok: "no", crisis_status: "needs_help", needs_nurse: true, needs_nurse_reason: "It's hot in here, no water" },
    summary: "Resident is hot and has no water.",
    sentiment: "Negative",
    duration_sec: 45,
  },
  crisis_silent: {
    call_type: "crisis",
    flag_nurse: { reason: "CRISIS NO RESPONSE. Send staff to the room now.", urgency: "now", quote: "(silence)" },
    disconnection_reason: "inactivity",
    duration_sec: 40,
    no_analysis: true,
  },
  crisis_no_answer: {
    call_type: "crisis",
    disconnection_reason: "dial_no_answer",
    analysis: { ...BLANK, answered_by: "no_answer", feels_ok: "", crisis_status: "no_response" },
    summary: "No answer.",
    sentiment: "Unknown",
    duration_sec: 0,
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);
const STEP_MS = 1500;

// Places a mock call, then plays call_started, call_ended, and call_analyzed through the real handlers.
export async function runScenario(clientId: number, name: string, run?: CrisisRun | null): Promise<string> {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`Unknown scenario ${name}`);
  const crisisRun = s.call_type === "crisis" ? (run ?? (await activeCrisisRun())) : null;
  const { call_id } = await startCall({
    clientId,
    call_type: s.call_type,
    crisis_type: crisisRun?.crisis_type ?? (s.call_type === "crisis" ? "heat_wave" : null),
    crisis_run_id: crisisRun?.id ?? null,
    mock: true,
  });

  void playEvents(call_id, s).catch((e) => console.error(`[mock] ${name} failed`, e));
  return call_id;
}

async function playEvents(callId: string, s: Scenario) {
  const start = Date.now();
  const durationMs = (s.duration_sec ?? 60) * 1000;
  const call: RetellCall = { call_id: callId, start_timestamp: start, transcript: s.transcript };

  const connected = s.disconnection_reason !== "dial_no_answer";
  if (connected) {
    await sleep(STEP_MS);
    await handleRetellEvent({ event: "call_started", call });
  }
  if (s.started_only) return;

  if (s.flag_nurse) {
    await sleep(STEP_MS);
    await handleFlagNurse({ args: s.flag_nurse, call });
  }

  await sleep(STEP_MS);
  const ended: RetellCall = {
    ...call,
    end_timestamp: start + durationMs,
    duration_ms: durationMs,
    disconnection_reason: s.disconnection_reason ?? "user_hangup",
  };
  await handleRetellEvent({ event: "call_ended", call: ended });
  if (s.no_analysis) return;

  await sleep(STEP_MS);
  await handleRetellEvent({
    event: "call_analyzed",
    call: {
      ...ended,
      call_analysis: {
        call_summary: s.summary,
        user_sentiment: s.sentiment,
        call_successful: connected && s.analysis?.answered_by === "client",
        in_voicemail: s.disconnection_reason === "voicemail_reached",
        custom_analysis_data: s.analysis,
      },
    },
  });
}

// A full crisis across every resident: needs help, silent, no answer, safe, still calling.
const CRISIS_MIX = ["crisis_needs_help", "crisis_silent", "crisis_no_answer", "crisis_safe", "still_calling"];

export async function runMockCrisis(crisisType: CrisisType): Promise<CrisisRun> {
  const run = await openCrisisRun(crisisType);
  void (async () => {
    const clients = await crisisOrder();
    for (const [i, client] of clients.entries()) {
      if (i > 0) await sleep(2000 + Math.random() * 1000);
      const name = CRISIS_MIX[i % CRISIS_MIX.length];
      try {
        if (name === "still_calling") {
          const { call_id } = await startCall({
            clientId: client.id,
            call_type: "crisis",
            crisis_type: crisisType,
            crisis_run_id: run.id,
            mock: true,
          });
          await sleep(STEP_MS);
          await handleRetellEvent({ event: "call_started", call: { call_id, start_timestamp: Date.now() } });
        } else {
          await runScenario(client.id, name, run);
        }
      } catch (e) {
        console.error(`[mock-crisis] room ${client.room} failed`, e);
      }
    }
  })();
  return run;
}
