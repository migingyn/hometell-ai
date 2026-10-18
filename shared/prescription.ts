export type SourceRole = 'pharmacy' | 'insurer' | 'clinic';
export type CaseMode = 'replay' | 'live';
export type EvidenceKind =
  | 'pharmacy_blocked' | 'clinic_sent' | 'insurer_missing'
  | 'clinic_accepted' | 'clinic_resent' | 'insurer_received'
  | 'insurer_approved' | 'pharmacy_ready' | 'pharmacy_pending'
  | 'contact_unreachable' | 'promise_overdue';
export type EvidenceOrigin = 'scripted' | 'live-source' | 'retell';

export interface CaseEvidence {
  id: string;
  role: SourceRole;
  kind: EvidenceKind;
  text: string;
  createdAt: string;
  revision: number;
  origin: EvidenceOrigin;
  sourceLabel?: string;
  callId?: string;
}

export interface PrescriptionCase {
  id: string;
  mode: CaseMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: CaseEvidence[];
}

export interface CaseMilestone {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'active' | 'complete';
  evidenceIds: string[];
}

export interface CaseConflict {
  id: string;
  title: string;
  description: string;
  evidenceIds: string[];
  resolved: boolean;
}

export interface CaseSnapshot {
  status: 'blocked' | 'working' | 'awaiting_confirmation' | 'ready';
  headline: string;
  explanation: string;
  blocker: string;
  owner: SourceRole | null;
  nextAction: string;
  milestones: CaseMilestone[];
  conflicts: CaseConflict[];
  latestByRole: Partial<Record<SourceRole, CaseEvidence>>;
  activeEvidenceIds: string[];
  confirmedCount: number;
  unresolvedCount: number;
}

export interface ReplayBeat {
  at: number;
  event: Omit<CaseEvidence, 'createdAt'>;
  caption: string;
}

export interface SourceBrief {
  role: SourceRole;
  name: string;
  label: string;
  initials: string;
  instruction: string;
  options: { kind: EvidenceKind; label: string; text: string }[];
}

export const SOURCE_ROLES: SourceRole[] = ['pharmacy', 'insurer', 'clinic'];
