// Env config in one place. Server only: never import from a client component.

export const config = {
  mockRetell: process.env.MOCK_RETELL === "true",
  classifier: (process.env.CLASSIFIER ?? "retell") as "retell" | "llm",
  demoTimeScale: Number(process.env.DEMO_TIME_SCALE ?? "1") || 1,
  agencyName: process.env.AGENCY_NAME ?? "Sunrise Home Care",
  coordinatorPhone: process.env.COORDINATOR_PHONE ?? "",
};

// Every ladder step waits 5 minutes, scaled for the demo.
export const LADDER_DELAY_MS = 5 * 60 * 1000;

export function nextActionAt(from = new Date()): string {
  return new Date(from.getTime() + LADDER_DELAY_MS * config.demoTimeScale).toISOString();
}
