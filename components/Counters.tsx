// Four summary counters. Owner: Frontend.
import type { CheckWithClient } from "@/lib/types";

export function Counters({ checks }: { checks: CheckWithClient[] }) {
  const count = (s: string) => checks.filter((c) => c.status === s).length;
  // TODO(Frontend): style with shadcn Card and status colors.
  const items = [
    { label: "Okay", value: count("ok"), className: "bg-green-100 text-green-900" },
    { label: "No answer", value: count("no_answer"), className: "bg-yellow-100 text-yellow-900" },
    { label: "Needs a human", value: count("needs_human"), className: "bg-red-100 text-red-900" },
    { label: "Handled", value: count("handled"), className: "bg-zinc-100 text-zinc-900" },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map((i) => (
        <div key={i.label} className={`rounded-lg p-4 ${i.className}`}>
          <div className="text-3xl font-semibold">{i.value}</div>
          <div className="text-sm">{i.label}</div>
        </div>
      ))}
    </div>
  );
}
