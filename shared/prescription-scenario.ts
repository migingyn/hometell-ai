import type { PrescriptionCase, ReplayBeat, SourceBrief, SourceRole } from './prescription';

export const SOURCE_BRIEFS: Record<SourceRole, SourceBrief> = {
  pharmacy: {
    role: 'pharmacy', name: 'Pine Street Pharmacy', label: 'Pharmacy · fictional organization', initials: 'PS',
    instruction: 'Act as the pharmacy source for this fictional administrative case. Confirm only your processing and pickup state. Insurer approval alone does not mean pickup is ready. Do not enter patient names, drug details, or real contact information.',
    options: [
      { kind: 'pharmacy_blocked', label: 'Pickup is blocked', text: 'The prescription cannot be processed yet. We are waiting for the insurer’s authorization paperwork to be cleared.' },
      { kind: 'pharmacy_pending', label: 'Still processing / reopen', text: 'Pickup is not confirmed. The pharmacy still needs to process the updated insurer decision; please keep the case open.' },
      { kind: 'pharmacy_ready', label: 'Confirm ready for pickup', text: 'The insurer decision is on file and pharmacy processing is complete. We explicitly confirm that the prescription is ready for pickup.' },
      { kind: 'contact_unreachable', label: 'Pharmacy unreachable', text: 'The pharmacy could not be reached. Its current processing and pickup state are unknown.' },
      { kind: 'promise_overdue', label: 'Processing promise overdue', text: 'The pharmacy’s promised processing deadline passed without a pickup confirmation. The pharmacy still owns this follow-up.' },
    ],
  },
  insurer: {
    role: 'insurer', name: 'Harbor Health Plan', label: 'Insurer · fictional organization', initials: 'HH',
    instruction: 'Act as insurer intake for this fictional administrative case. Distinguish a missing form, an explicit receipt, and a documented decision. Only report your source’s state. Do not promise actual coverage or enter any real member or medical details.',
    options: [
      { kind: 'insurer_missing', label: 'Signed form is missing', text: 'We cannot locate the completed signed form in intake. The clinic’s original dispatch claim is not an insurer receipt.' },
      { kind: 'insurer_received', label: 'Confirm corrected form received', text: 'Insurer intake explicitly confirms receipt of the corrected signed form. The administrative request is now awaiting a decision.' },
      { kind: 'insurer_approved', label: 'Confirm administrative approval', text: 'The corrected request has a documented approval in this fictional case. This is not pharmacy processing or pickup confirmation.' },
      { kind: 'contact_unreachable', label: 'Insurer unreachable', text: 'Insurer intake could not be reached. Receipt and decision status are not currently confirmed.' },
      { kind: 'promise_overdue', label: 'Insurer deadline overdue', text: 'The insurer’s stated follow-up deadline passed without the promised confirmation. Insurer intake still owns this follow-up.' },
    ],
  },
  clinic: {
    role: 'clinic', name: 'Willow Clinic', label: 'Clinic · fictional organization', initials: 'WC',
    instruction: 'Act as the clinic source for this fictional administrative case. Distinguish the original “sent” claim, a named owner’s commitment, and an actual corrected resend. Sending does not establish receipt. Do not enter patient, prescription, or real contact details.',
    options: [
      { kind: 'clinic_sent', label: 'Original form was sent', text: 'The clinic’s dispatch log says the original form was sent. We have not confirmed an insurer receipt.' },
      { kind: 'clinic_accepted', label: 'Sarah owns the fix by 3 PM', text: 'Sarah at Willow Clinic accepts ownership. She will send the completed signed form to the confirmed insurer intake destination by 3:00 PM local time.' },
      { kind: 'clinic_resent', label: 'Confirm corrected form resent', text: 'Sarah confirms the completed signed form was resent to the insurer’s confirmed intake destination. We still need the insurer’s receipt.' },
      { kind: 'contact_unreachable', label: 'Clinic unreachable', text: 'The clinic could not be reached. A current owner, dispatch, or new commitment could not be confirmed.' },
      { kind: 'promise_overdue', label: 'Sarah’s 3 PM deadline passed', text: 'Sarah’s 3:00 PM deadline passed without a confirmed corrected dispatch. Sarah at the clinic still owns the unresolved form.' },
    ],
  },
};

function beat(at: number, role: SourceRole, kind: ReplayBeat['event']['kind'], revision: number, caption: string): ReplayBeat {
  const option = SOURCE_BRIEFS[role].options.find((item) => item.kind === kind)!;
  return {
    at, caption,
    event: {
      id: `replay-${role}-${revision}-${kind}`, role, kind, revision, origin: 'scripted', text: option.text,
      sourceLabel: `Scripted replay · ${SOURCE_BRIEFS[role].name} · fictional organization`,
    },
  };
}

export const REPLAY_DURATION = 80;
export const REPLAY_BEATS: ReplayBeat[] = [
  beat(4, 'pharmacy', 'pharmacy_blocked', 1, 'The pharmacy names the administrative blocker.'),
  beat(12, 'clinic', 'clinic_sent', 1, 'The clinic says it sent the form. That is a dispatch claim.'),
  beat(20, 'insurer', 'insurer_missing', 1, 'The insurer cannot locate the signed form. The reports conflict.'),
  beat(29, 'clinic', 'clinic_accepted', 2, 'Sarah takes ownership and commits to a 3 PM deadline.'),
  beat(40, 'clinic', 'clinic_resent', 3, 'The corrected signed form is resent. The case stays open.'),
  beat(50, 'insurer', 'insurer_received', 2, 'An explicit insurer receipt resolves the dispatch conflict.'),
  beat(61, 'insurer', 'insurer_approved', 3, 'The insurer confirms its decision. Pickup is still unconfirmed.'),
  beat(73, 'pharmacy', 'pharmacy_ready', 2, 'The pharmacy confirms processing and pickup. Only now is the case ready.'),
];

const REPLAY_START = Date.parse('2026-10-17T18:00:00.000Z');

export function createReplayCase(elapsed: number): PrescriptionCase {
  const seconds = Number.isFinite(elapsed) ? Math.min(REPLAY_DURATION, Math.max(0, elapsed)) : 0;
  const events = REPLAY_BEATS.filter((item) => item.at <= seconds).map((item) => ({
    ...item.event, createdAt: new Date(REPLAY_START + item.at * 1_000).toISOString(),
  }));
  return {
    id: 'prescription-replay', mode: 'replay', title: 'Clear the paperwork. Confirm pickup.',
    createdAt: new Date(REPLAY_START).toISOString(),
    updatedAt: events.at(-1)?.createdAt ?? new Date(REPLAY_START).toISOString(), events,
  };
}
