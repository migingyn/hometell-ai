import type { EventMode } from "./types";

export function normalizeMode(type?: string): EventMode {
  return type === "daily" ? "daily" : "crisis";
}

export const SAMPLE_ALERT = "This is a demonstration message. Los Angeles County has issued an evacuation warning for west Altadena. Be ready to leave if an evacuation order is issued.";
