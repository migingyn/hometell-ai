import { redactPhoneNumbers } from "@/lib/demo/evidence";
import type { RetellCall } from "@/lib/types";

export type TranscriptTurn = {
  id: string;
  role: "agent" | "user";
  content: string;
  startSeconds: number | null;
  endSeconds: number | null;
};
export type TranscriptSnapshot = {
  turns: TranscriptTurn[];
  turnCount: number;
  endSeconds: number | null;
  characterCount: number;
  truncated: boolean;
};
export type TranscriptStatus = "ongoing" | "ended" | "analyzed";
export type TranscriptEvent = "call_started" | "transcript_updated" | "call_ended" | "call_analyzed";
const MAX_TURNS = 1_000;
const MAX_CHARACTERS = 500_000;

export function transcriptStatus(event: TranscriptEvent): TranscriptStatus {
  return event === "call_analyzed" ? "analyzed" : event === "call_ended" ? "ended" : "ongoing";
}

function seconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400 ? value : null;
}

// Retell sends cumulative snapshots, including a growing last utterance. Tool
// entries are never speech evidence. Raw provider payloads/URLs are not stored here.
export function transcriptSnapshot(call: RetellCall): TranscriptSnapshot {
  const structured = Array.isArray(call.transcript_object) ? call.transcript_object
    : Array.isArray(call.transcript_with_tool_calls) ? call.transcript_with_tool_calls : null;
  const source: { role: string; content?: string; words?: { start?: number; end?: number }[] }[] = [];
  if (structured) source.push(...structured);
  else {
    let previous: (typeof source)[number] | null = null;
    for (const line of (typeof call.transcript === "string" ? call.transcript : "").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z][A-Za-z _-]*):\s*(.*)$/.exec(line);
      if (match) {
        const role = match[1].toLowerCase();
        previous = role === "agent" || role === "user" ? { role, content: match[2] } : null;
        if (previous) source.push(previous);
      } else if (previous) previous.content += `\n${line}`;
    }
  }
  const speech = source.filter((turn) => turn && ["agent", "user"].includes(turn.role) && typeof turn.content === "string");
  const turns: TranscriptTurn[] = [];
  let characterCount = 0, endSeconds: number | null = null;
  let truncated = speech.length > MAX_TURNS;
  for (const turn of speech.slice(0, MAX_TURNS)) {
    const remaining = MAX_CHARACTERS - characterCount;
    if (remaining <= 0) { truncated = true; break; }
    const redacted = redactPhoneNumbers(turn.content!);
    const content = redacted.slice(0, Math.min(6_000, remaining));
    if (content.length < redacted.length) truncated = true;
    characterCount += content.length;
    const starts = (Array.isArray(turn.words) ? turn.words : []).map((word) => seconds(word?.start)).filter((n): n is number => n !== null);
    const ends = (Array.isArray(turn.words) ? turn.words : []).map((word) => seconds(word?.end)).filter((n): n is number => n !== null);
    const start = starts.length ? Math.min(...starts) : null;
    const candidateEnd = ends.length ? Math.max(...ends) : null;
    const end = candidateEnd !== null && (start === null || candidateEnd >= start) ? candidateEnd : null;
    if (end !== null) endSeconds = Math.max(endSeconds ?? 0, end);
    turns.push({ id: `${call.call_id}:turn:${turns.length}`, role: turn.role as "agent" | "user", content,
      startSeconds: start, endSeconds: end });
  }
  return { turns, turnCount: turns.length, endSeconds, characterCount, truncated };
}

// Mirrors the database's conservative cumulative ordering policy. Arrival time
// is not provider ordering. Equal-count/equal-time rewrites cannot be ordered;
// retain the first unless it is a strict text-prefix extension. A later terminal
// event may supply a same-position correction, but never fewer complete turns.
export function transcriptAdvances(previous: TranscriptSnapshot, next: TranscriptSnapshot, terminalAdvance = false): boolean {
  if (next.turnCount < previous.turnCount) return false;
  if (previous.endSeconds !== null && next.endSeconds !== null && next.endSeconds < previous.endSeconds) return false;
  if (next.turnCount > previous.turnCount) return true;
  if (next.endSeconds !== null && (previous.endSeconds === null || next.endSeconds > previous.endSeconds)) return true;
  if (terminalAdvance && next.characterCount >= previous.characterCount) return true;
  return next.characterCount > previous.characterCount && previous.turns.every((turn, index) =>
    turn.role === next.turns[index]?.role && next.turns[index].content.startsWith(turn.content));
}
