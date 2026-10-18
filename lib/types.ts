import type { AcousticAssessment } from "@/lib/acoustic/types";
import type { NurseTransfer, PostOpAssessment } from "@/lib/postop/types";

// The shared contract. Do not change without telling the team.
// Mirrors supabase/schema.sql.

export type RiskTier = "red" | "yellow" | "green";
export type EventMode = "daily" | "crisis";
export type Urgency = "urgent" | "follow_up";

// Suggested operator review order, never an automated medical/dispatch decision.
export type CallerAssessment = {
  priority: "immediate" | "urgent" | "follow_up" | "review";
  situation: "immediate_danger" | "needs_assistance" | "routine" | "unknown";
  distress: "high" | "moderate" | "unknown";
  audible_distress: "unavailable" | "elevated" | "uncertain";
  transcript_sentiment: "Positive" | "Negative" | "Neutral" | "Unknown" | null;
  evidence: { kind: "situation" | "distress"; quote: string }[];
  reasons: string[];
  stage: "live" | "post_call";
};

export type CheckStatus =
  | "queued"
  | "calling"
  | "ok"
  | "needs_human"
  | "no_answer"
  | "handled";

export type CallTarget = "client" | "emergency_contact";

// 0 = first call placed. 1 retry client, 2 SMS client, 3 call emergency contact, 4 flag unreachable.
export type LadderStep = 0 | 1 | 2 | 3 | 4;

export type Client = {
  id: string;
  name: string;
  phone: string;
  risk_tier: RiskTier;
  lives_alone: boolean;
  uses_powered_equipment: boolean;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  usual_pickup_time: string | null;
  language?: string;
  needs_ride?: boolean;
  last_daily_at?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type HeartbeatEvent = {
  id: string;
  type: string;
  started_at: string;
  alert_text: string | null;
};

export type Check = {
  id: string;
  event_id: string;
  client_id: string;
  status: CheckStatus;
  ladder_step: LadderStep;
  next_action_at: string | null;
  last_call_id: string | null;
  summary: string | null;
  flag_reason: string | null;
  handled_at: string | null;
  updated_at: string;
  urgency: Urgency | null;
  sms_status: string | null;
  priority_assessment?: CallerAssessment | null;
  acoustic_assessment?: AcousticAssessment | null;
  postop_assessment?: PostOpAssessment | null;
  nurse_transfer?: NurseTransfer | null;
};

export type CheckWithClient = Check & { client: Client };

// Fields a ladder or webhook step is allowed to change on a check.
export type CheckPatch = Partial<
  Pick<
    Check,
    | "status"
    | "ladder_step"
    | "next_action_at"
    | "last_call_id"
    | "summary"
    | "flag_reason"
    | "handled_at"
    | "urgency"
    | "sms_status"
    | "priority_assessment"
  >
>;

export type CallLog = {
  id: string;
  check_id: string;
  retell_call_id: string;
  target: CallTarget;
  outcome: string;
  transcript: string | null;
  raw: unknown;
  created_at: string;
};

// What we send as Retell call metadata. Retell echoes it back on every webhook.
export type CallMetadata = {
  check_id: string;
  target: CallTarget;
  mode?: EventMode;
  // Only read when MOCK_RETELL=true. Lets scripts/fake-webhook.ts force an outcome.
  mock_outcome?: ClassifierStatus;
};

// The subset of the Retell webhook call object we read.
// Retell transcript updates can contain tool entries; only user turns are evidence.
export type RetellCall = {
  call_id: string;
  call_status?: string;
  disconnection_reason?: string;
  recording_multi_channel_url?: string;
  transcript?: string;
  transcript_object?: { role: string; content: string; words?: { start?: number; end?: number; word?: string }[] }[];
  transcript_with_tool_calls?: { role: string; content?: string }[];
  metadata?: CallMetadata;
  call_analysis?: {
    call_summary?: string;
    in_voicemail?: boolean;
    user_sentiment?: string;
    call_successful?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
};

export type RetellWebhookEvent = "call_started" | "transcript_updated" | "call_ended" | "call_analyzed";

export type RetellWebhookPayload = {
  event: RetellWebhookEvent;
  call: RetellCall;
};

export type ClassifierStatus = "ok" | "needs_human" | "no_answer";

export type ClassifierResult = {
  status: ClassifierStatus;
  summary: string;
  flag_reason: string | null;
  urgency?: Urgency | null;
  priority_assessment?: CallerAssessment;
};

export type ClassifierContext = { mode: EventMode; target?: CallTarget; contactName?: string };

export interface Classifier {
  name: string;
  classify(call: RetellCall, context?: ClassifierContext): Promise<ClassifierResult>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
