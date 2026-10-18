import type { NurseTransfer } from "./types";

export const NURSE_TRANSFER_EVENTS = ["transfer_started", "transfer_bridged", "transfer_cancelled", "transfer_ended"] as const;
export type NurseTransferEvent = typeof NURSE_TRANSFER_EVENTS[number];

export function isNurseTransferEvent(event: string): event is NurseTransferEvent {
  return (NURSE_TRANSFER_EVENTS as readonly string[]).includes(event);
}

/** Retell's bridge event is the only positive connection evidence. */
export function nextNurseTransferStatus(prior: NurseTransfer["status"] | null, event: NurseTransferEvent): NurseTransfer["status"] {
  if (prior === "connected" || event === "transfer_bridged") return "connected";
  if (prior === "failed" || event === "transfer_cancelled") return "failed";
  if (prior === "ended_unconfirmed" || event === "transfer_ended") return "ended_unconfirmed";
  return "started";
}
