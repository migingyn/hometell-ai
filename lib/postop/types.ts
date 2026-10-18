export const POSTOP_FIELDS = ["pain", "incision", "fever", "breathing", "appetite", "weight", "medications", "falls"] as const;
export type PostOpField = typeof POSTOP_FIELDS[number];
export const POSTOP_LABELS: Record<PostOpField, string> = {
  pain: "Pain (0–10)", incision: "Incision", fever: "Fever", breathing: "Breathing",
  appetite: "Appetite", weight: "Weight", medications: "Medications", falls: "Falls",
};

export type PostOpAnswer = { status: "reported" | "unknown"; value: string | number | null; quote: string | null };
export type PostOpAssessment = {
  version: 1;
  call_id: string;
  recorded_at: string;
  patient_confirmed: boolean;
  identity_quote: string | null;
  answers: Record<PostOpField, PostOpAnswer>;
  changes: { field: PostOpField; previous: string | number; current: string | number; previous_quote: string; current_quote: string }[];
  comparison: { previous_call_id: string | null; status: "compared" | "no_previous_check"; unavailable_fields: PostOpField[] };
  suggested_next_step: {
    action: "nurse_review";
    label: string;
    reason: string;
    status: "proposed" | "approved";
    approved_at: string | null;
    reviewer: string | null;
  };
};

export type NurseTransfer = {
  call_id: string;
  status: "started" | "connected" | "failed" | "ended_unconfirmed";
  updated_at: string;
};
