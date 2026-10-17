import type { CheckWithClient, EventMode } from "@/lib/types";
export function Counters({ checks, mode }: { checks: CheckWithClient[]; mode: EventMode }) {
  const urgent = checks.filter((check) => check.status === "needs_human" && (mode === "crisis" || check.urgency === "urgent")).length;
  const items = [
    { label: "Confirmed okay", value: checks.filter((check) => check.status === "ok").length, note: "Client or contact confirmed", tone: "okay" },
    { label: "Needs a human now", value: urgent, note: "Prioritize these calls", tone: "urgent" },
    { label: "Follow up", value: checks.filter((check) => check.status === "needs_human").length - urgent, note: "Everyday requests for a person", tone: "amber" },
    { label: "No answer", value: checks.filter((check) => check.status === "no_answer").length, note: "Keep the phone tree moving", tone: "amber" },
    { label: "Handled", value: checks.filter((check) => check.status === "handled").length, note: "A person has taken over", tone: "quiet" },
  ];
  return <section className="hb-counters" aria-label="Check-in totals">{items.map((item) => <div className={`hb-counter hb-counter-${item.tone}`} key={item.label}><span><i />{item.label}</span><strong>{String(item.value).padStart(2, "0")}</strong><small>{item.note}</small></div>)}</section>;
}
