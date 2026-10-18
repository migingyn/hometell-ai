import type { CaseEvidence, CaseSnapshot, EvidenceKind, SourceRole } from './prescription';

const KINDS: Record<SourceRole, readonly EvidenceKind[]> = {
  pharmacy: ['pharmacy_blocked', 'pharmacy_pending', 'pharmacy_ready', 'contact_unreachable', 'promise_overdue'],
  insurer: ['insurer_missing', 'insurer_received', 'insurer_approved', 'contact_unreachable', 'promise_overdue'],
  clinic: ['clinic_sent', 'clinic_accepted', 'clinic_resent', 'contact_unreachable', 'promise_overdue'],
};

export function kindAllowedForRole(role: SourceRole, kind: EvidenceKind): boolean {
  return KINDS[role]?.includes(kind) ?? false;
}

function valid(event: CaseEvidence): boolean {
  return Boolean(event && typeof event.id === 'string' && event.id.trim() &&
    typeof event.text === 'string' && event.text.trim() &&
    Number.isInteger(event.revision) && event.revision > 0 &&
    Number.isFinite(Date.parse(event.createdAt)) &&
    ['scripted', 'live-source', 'retell'].includes(event.origin) &&
    kindAllowedForRole(event.role, event.kind));
}

function accept(events: CaseEvidence[], event: CaseEvidence): CaseEvidence[] {
  if (!valid(event) || events.some((item) => item.id === event.id)) return events;
  const revision = events.reduce((latest, item) => item.role === event.role ? Math.max(latest, item.revision) : latest, 0);
  return event.revision > revision ? [...events, event] : events;
}

/** Arrival order is the shared case ledger; a stale source revision cannot rewrite it. */
export function appendCaseEvidence(events: CaseEvidence[], event: CaseEvidence): CaseEvidence[] {
  const ledger = events.reduce<CaseEvidence[]>((accepted, item) => accept(accepted, item), []);
  return accept(ledger, event);
}

/** Derive the administrative outcome only from explicit, current source reports. */
export function deriveCase(events: CaseEvidence[]): CaseSnapshot {
  const ledger = events.reduce<CaseEvidence[]>((accepted, item) => accept(accepted, item), []);
  const latestByRole: CaseSnapshot['latestByRole'] = {};
  const positions = new Map(ledger.map((event, i) => [event.id, i]));
  for (const event of ledger) latestByRole[event.role] = event;
  const last = (kind: EvidenceKind) => [...ledger].reverse().find((event) => event.kind === kind);
  const after = (a: CaseEvidence | undefined, b: CaseEvidence | undefined) => Boolean(a && (!b || positions.get(a.id)! > positions.get(b.id)!));
  const ids = (...items: (CaseEvidence | undefined)[]) => [...new Set(items.filter((item): item is CaseEvidence => Boolean(item)).map((item) => item.id))];
  const pharmacy = latestByRole.pharmacy;
  const clinic = latestByRole.clinic;
  const insurer = latestByRole.insurer;
  const sent = last('clinic_sent');
  const missing = last('insurer_missing');
  const ownerReport = last('clinic_accepted');
  const accepted = ownerReport && after(ownerReport, missing) ? ownerReport : undefined;
  const resent = clinic?.kind === 'clinic_resent' && after(clinic, missing) ? clinic : undefined;
  const receiptReport = last('insurer_received');
  const receipt = resent && receiptReport && after(receiptReport, resent) && after(receiptReport, missing) &&
    (insurer?.kind === 'insurer_received' || insurer?.kind === 'insurer_approved') ? receiptReport : undefined;
  const approval = receipt && insurer?.kind === 'insurer_approved' && after(insurer, receipt) ? insurer : undefined;
  const pickup = approval && pharmacy?.kind === 'pharmacy_ready' && after(pharmacy, approval) ? pharmacy : undefined;
  const blockerReport = last('pharmacy_blocked') ?? last('pharmacy_pending');
  const hasOwner = clinic?.kind === 'clinic_accepted' || Boolean(resent);
  const conflicts: CaseSnapshot['conflicts'] = sent && missing ? [{
    id: 'sent-without-receipt',
    title: 'The clinic says sent. The insurer says missing.',
    description: receipt
      ? 'Resolved by an explicit insurer receipt for the corrected form. A dispatch claim alone did not resolve this conflict.'
      : 'The clinic dispatch and the insurer intake record disagree. Obtain a corrected dispatch and a separate insurer receipt.',
    evidenceIds: ids(sent, missing, ...(receipt ? [resent, receipt] : [])),
    resolved: Boolean(receipt),
  }] : [];

  const milestones: CaseSnapshot['milestones'] = [
    {
      id: 'pharmacy-blocker', label: 'Find the pharmacy blocker',
      detail: blockerReport?.text ?? 'Ask the pharmacy which administrative item is preventing pickup.',
      status: blockerReport || pickup ? 'complete' : 'active', evidenceIds: ids(blockerReport ?? pickup),
    },
    {
      id: 'clinic-owner', label: 'Get a clinic owner and deadline',
      detail: accepted?.text ?? (resent?.text || 'No current clinic owner or resend commitment has been confirmed.'),
      status: hasOwner ? 'complete' : missing ? 'active' : 'pending', evidenceIds: hasOwner ? ids(accepted, resent) : [],
    },
    {
      id: 'clinic-resend', label: 'Send the corrected form',
      detail: resent?.text ?? 'A promise or an original “sent” claim is not a corrected dispatch confirmation.',
      status: resent ? 'complete' : hasOwner || sent ? 'active' : 'pending', evidenceIds: ids(resent),
    },
    {
      id: 'insurer-receipt', label: 'Confirm insurer receipt',
      detail: receipt?.text ?? 'The insurer must explicitly confirm receipt of the current corrected form.',
      status: receipt ? 'complete' : resent ? 'active' : 'pending', evidenceIds: ids(receipt),
    },
    {
      id: 'insurer-decision', label: 'Confirm the insurer decision',
      detail: approval?.text ?? 'Receipt alone does not establish an insurer decision.',
      status: approval ? 'complete' : receipt ? 'active' : 'pending', evidenceIds: ids(receipt, approval),
    },
    {
      id: 'pharmacy-pickup', label: 'Get pharmacy pickup confirmation',
      detail: pickup?.text ?? 'An insurer approval is not a pharmacy pickup confirmation.',
      status: pickup ? 'complete' : approval ? 'active' : 'pending', evidenceIds: ids(resent, receipt, approval, pickup),
    },
  ];

  let status: CaseSnapshot['status'] = 'blocked';
  let headline = 'The prescription is still blocked';
  let explanation = blockerReport?.text ?? 'No source has yet confirmed the administrative blocker or the steps needed to clear it.';
  let blocker = 'The paperwork and pickup status have not been verified.';
  let owner: SourceRole | null = ledger.length ? 'clinic' : null;
  let nextAction = 'Ask the pharmacy for the blocker, then check clinic dispatch and insurer receipt.';
  const overdue = [...ledger].reverse().find((event) => event.kind === 'promise_overdue' && latestByRole[event.role]?.id === event.id);
  const unreachable = [...ledger].reverse().find((event) => event.kind === 'contact_unreachable' && latestByRole[event.role]?.id === event.id);

  if (overdue) {
    headline = 'The promised deadline passed'; explanation = overdue.text;
    blocker = 'The promised action has no current completion receipt.'; owner = overdue.role;
    nextAction = `Follow up with the ${overdue.role}'s named owner and obtain a new commitment plus evidence of completion.`;
  } else if (unreachable) {
    headline = `Waiting for the ${unreachable.role}`; explanation = unreachable.text;
    blocker = 'A required source could not be reached; its current confirmation is unknown.'; owner = unreachable.role;
    nextAction = `Reconnect with the ${unreachable.role} or hand the unresolved task to a person.`;
  } else if (pickup) {
    status = 'ready'; headline = 'Ready for pickup'; explanation = pickup.text;
    blocker = 'No open administrative blocker remains in the current source reports.'; owner = null;
    nextAction = 'Share the pharmacy’s confirmed pickup update and the supporting receipt trail.';
  } else if (!resent && clinic?.kind === 'clinic_accepted') {
    status = 'working'; headline = 'The clinic owns the next step'; explanation = clinic.text;
    blocker = 'The corrected form has been promised, but its dispatch and receipt are still unconfirmed.'; owner = 'clinic';
    nextAction = 'Follow up with the named clinic owner by the stated deadline, then verify insurer receipt.';
  } else if (!resent && missing) {
    headline = 'The signed form is missing'; explanation = missing.text;
    blocker = 'The insurer has not confirmed the corrected form. “Sent” is not a receipt.'; owner = 'clinic';
    nextAction = 'Get a named clinic owner to resend the signed form to the insurer’s confirmed intake destination.';
  } else if (!resent && sent) {
    status = 'awaiting_confirmation'; headline = 'Sent needs a receipt'; explanation = sent.text;
    blocker = 'The clinic reports sending paperwork, but no insurer receipt has been confirmed.'; owner = 'insurer';
    nextAction = 'Ask the insurer to locate the form and identify anything missing.';
  } else if (resent && !receipt) {
    status = 'awaiting_confirmation'; headline = 'Resent. Receipt still needed.'; explanation = resent.text;
    blocker = 'The corrected form was sent; the insurer has not confirmed receiving it.'; owner = 'insurer';
    nextAction = 'Obtain an explicit insurer receipt for the corrected form.';
  } else if (receipt && !approval) {
    status = 'awaiting_confirmation'; headline = 'Received. Decision still pending.'; explanation = receipt.text;
    blocker = 'The insurer received the form; its decision remains unconfirmed.'; owner = 'insurer';
    nextAction = 'Check the insurer’s documented decision without promising approval or coverage.';
  } else if (approval) {
    status = pharmacy?.kind === 'pharmacy_blocked' && after(pharmacy, approval) ? 'blocked' : 'awaiting_confirmation';
    headline = pharmacy?.kind === 'pharmacy_pending' ? 'Pickup confirmation has reopened' : 'Approved is not ready for pickup';
    explanation = pharmacy && after(pharmacy, approval) ? pharmacy.text : approval.text;
    blocker = 'The insurer decision is confirmed; the pharmacy must confirm processing and pickup readiness.'; owner = 'pharmacy';
    nextAction = 'Ask the pharmacy to process the updated decision and explicitly confirm whether pickup is ready.';
  }

  const support = new Set([
    ...Object.values(latestByRole).map((event) => event!.id),
    ...milestones.flatMap((milestone) => milestone.evidenceIds),
    ...conflicts.flatMap((conflict) => conflict.evidenceIds),
  ]);
  const confirmedCount = milestones.filter((milestone) => milestone.status === 'complete').length;
  return {
    status, headline, explanation, blocker, owner, nextAction, milestones, conflicts, latestByRole,
    activeEvidenceIds: ledger.filter((event) => support.has(event.id)).map((event) => event.id),
    confirmedCount, unresolvedCount: milestones.length - confirmedCount + conflicts.filter((conflict) => !conflict.resolved).length,
  };
}
