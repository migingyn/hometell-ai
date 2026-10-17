import type { Client, EventMode, RiskTier } from "./types";
const TIER_ORDER: Record<RiskTier, number> = { red: 0, yellow: 1, green: 2 };

export function sortClientsForEvent(clients: Client[], mode: EventMode): Client[] {
  return [...clients].sort((a, b) => TIER_ORDER[a.risk_tier] - TIER_ORDER[b.risk_tier] ||
    (mode === "crisis" ? Number(!!b.needs_ride) - Number(!!a.needs_ride) || Number(b.lives_alone) - Number(a.lives_alone) : 0) || a.name.localeCompare(b.name));
}
