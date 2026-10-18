// Danger words that always raise a danger alert. No classifier or model may downgrade a match.
import type { RetellCall } from "@/lib/types";

export const DANGER_WORDS = [
  "chest pain",
  "can't breathe",
  "fell",
  "fall",
  "dizzy",
  "confused",
  "help",
  "emergency",
];

// Only the resident's words count. The agent saying "how can I help" must not match.
function residentText(call: RetellCall): string {
  if (call.transcript_object?.length) {
    return call.transcript_object
      .filter((u) => u.role === "user")
      .map((u) => u.content)
      .join("\n");
  }
  return (call.transcript ?? "")
    .split("\n")
    .filter((line) => /^user:/i.test(line.trim()))
    .join("\n");
}

// Returns the first danger word the resident said, or null.
export function dangerWordIn(call: RetellCall): string | null {
  const text = residentText(call).toLowerCase().replace(/[‘’]/g, "'");
  for (const word of DANGER_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/'/g, "'?")}\\b`);
    if (pattern.test(text)) return word;
  }
  return null;
}
