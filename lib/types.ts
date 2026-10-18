// The shared contract. Do not change without telling the team.
// Mirrors supabase/schema.sql and API.md.
import type Retell from "retell-sdk";

export type CallType = "daily" | "crisis";

export const CRISIS_TYPES = ["heat_wave", "power_outage", "wildfire", "earthquake", "flood"] as const;
export type CrisisType = (typeof CRISIS_TYPES)[number];

export type VitalsStatus = "normal" | "watch" | "alert";
export type CardStatus = "red" | "yellow" | "green" | "gray";
export type CrisisState = "safe" | "needs_help" | "no_response" | "calling" | "not_reached";

export type Urgency = "now" | "today";
export type AlertType =
  | "needs_nurse"
  | "danger"
  | "open_line"
  | "no_answer"
  | "allergy"
  | "dose_question"
  | "missed_med"
  | "flag_nurse"
  | "pain"
  | "crisis_needs_help"
  | "crisis_no_response"
  | "wellness";

export type VitalName = "bp_sys" | "bp_dia" | "heart_rate" | "temp_f" | "spo2";
// Set by the nurse per resident. A missing vital is not checked.
export type VitalsRanges = Partial<Record<VitalName, { min: number; max: number }>>;

export type Client = {
  id: number;
  name: string;
  preferred_name: string;
  room: string;
  phone: string;
  aide_name: string;
  nurse_name: string;
  allergies: string | null;
  personal_note: string | null;
  vitals_ranges: VitalsRanges;
  created_at: string;
};

export type DailyEntry = {
  id: number;
  client_id: number;
  date: string; // YYYY-MM-DD
  bp_sys: number | null;
  bp_dia: number | null;
  heart_rate: number | null;
  temp_f: number | null;
  spo2: number | null;
  vitals_watch_note: string | null;
  med_schedule_now: string | null; // Exactly as the nurse wrote it
  entered_by: string | null;
  created_at: string;
};

// Post-call extraction fields from the Retell agent. Every one may be null.
export type CallAnalysis = {
  feels_ok: "yes" | "no" | "unsure" | null;
  danger_words_heard: boolean | null;
  med_taken: "yes" | "no" | "unsure" | "not_asked" | null;
  allergy_item_mentioned: boolean | null;
  dose_question_asked: boolean | null;
  needs_nurse: boolean | null;
  needs_nurse_reason: string | null;
  new_personal_fact: string | null;
  answered_by: "client" | "someone_else" | "voicemail" | "no_answer" | null;
  pain_level: number | null;
  pain_location: string | null;
  sleep_quality: "good" | "poor" | "not_asked" | null;
  ate_and_drank: "yes" | "no" | "not_asked" | null;
  steady_on_feet: "yes" | "no" | "not_asked" | null;
  mood: "good" | "okay" | "low" | "not_asked" | null;
  new_swelling: boolean | null;
  crisis_status: "needs_help" | "no_response" | "safe" | "not_crisis" | null;
};

export type CallStatus = "registered" | "ongoing" | "ended" | "analyzed";

export type Call = CallAnalysis & {
  call_id: string;
  client_id: number;
  call_type: CallType;
  crisis_type: CrisisType | null;
  crisis_run_id: number | null;
  status: CallStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  disconnection_reason: string | null;
  summary: string | null;
  sentiment: string | null;
  call_successful: boolean | null;
  transcript: string | null;
  raw_json: unknown;
  created_at: string;
  updated_at: string;
};

export type Alert = {
  id: number;
  client_id: number;
  call_id: string | null;
  type: AlertType;
  urgency: Urgency;
  message: string;
  quote: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export type CrisisRun = {
  id: number;
  crisis_type: CrisisType;
  started_at: string;
  ended_at: string | null;
};

// What we send as Retell call metadata. Retell echoes it back on every webhook.
export type CallMetadata = {
  client_id: number;
  call_type: CallType;
  crisis_type: CrisisType | null;
  crisis_run_id: number | null;
};

// Retell's own call type from retell-sdk. Every field optional except call_id,
// because webhooks and our mock replays only send part of it.
type SdkCall = Retell.PhoneCallResponse;
export type DisconnectionReason = NonNullable<SdkCall["disconnection_reason"]>;
export type RetellCallStatus = SdkCall["call_status"];

export type RetellCall = Partial<Omit<SdkCall, "call_id" | "metadata" | "call_analysis">> & {
  call_id: string;
  metadata?: Partial<CallMetadata>;
  call_analysis?: Partial<Omit<NonNullable<SdkCall["call_analysis"]>, "custom_analysis_data">> & {
    custom_analysis_data?: Record<string, unknown>;
  };
};

// Retell webhook body. We act on call_started, call_ended, and call_analyzed.
export type RetellWebhookPayload = {
  event: "call_started" | "call_ended" | "call_analyzed" | (string & {});
  call: RetellCall;
};
