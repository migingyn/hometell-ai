import type { RetellCall } from "@/lib/types";

export function redactPhoneNumbers(text: string): string {
  return text.replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[phone redacted]");
}

export function evidenceTurns(call: RetellCall): { role: "agent" | "user"; content: string }[] {
  const source = Array.isArray(call.transcript_object) ? call.transcript_object
    : Array.isArray(call.transcript_with_tool_calls) ? call.transcript_with_tool_calls : null;
  if (source) return source.filter((turn) => ["agent", "user"].includes(turn.role) && typeof turn.content === "string")
    .slice(0, 120).map((turn) => ({ role: turn.role as "agent" | "user", content: redactPhoneNumbers(turn.content!.slice(0, 6000)) }));
  const turns: { role: "agent" | "user"; content: string }[] = [];
  let previousRole: "agent" | "user" | null = null;
  for (const line of (call.transcript ?? "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z _-]*):\s*(.*)$/.exec(line);
    if (match) {
      const role = match[1].toLowerCase();
      previousRole = role === "user" || role === "agent" ? role : null;
      if (previousRole) turns.push({ role: previousRole, content: match[2] });
    } else if (previousRole && turns.length) turns[turns.length - 1].content += `\n${line}`;
  }
  return turns.slice(0, 120).map((turn) => ({ ...turn, content: redactPhoneNumbers(turn.content.slice(0, 6000)) }));
}
