// The shared contract. Do not change without telling the team.
// Mirrors supabase/schema.sql.

export type RiskTier = "red" | "yellow" | "green";
export type EventMode = "daily" | "crisis";
export type Urgency = "urgent" | "follow_up";

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
// TODO(Mikey): confirm field names against Retell docs.
export type RetellCall = {
  call_id: string;
  call_status?: string;
  disconnection_reason?: string;
  transcript?: string;
  transcript_object?: { role: string; content: string }[];
  metadata?: CallMetadata;
  call_analysis?: {
    call_summary?: string;
    in_voicemail?: boolean;
    user_sentiment?: string;
    call_successful?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
};

export type RetellWebhookEvent = "call_started" | "call_ended" | "call_analyzed";

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
};

export type ClassifierContext = { mode: EventMode; target?: CallTarget; contactName?: string };

export interface Classifier {
  name: string;
  classify(call: RetellCall, context?: ClassifierContext): Promise<ClassifierResult>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
