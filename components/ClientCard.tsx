// One card per client check. Owner: Frontend.
import { Button } from "@/components/ui/button";
import type { CheckStatus, CheckWithClient } from "@/lib/types";

const STATUS_STYLE: Record<CheckStatus, string> = {
  queued: "border-zinc-300",
  calling: "border-blue-400",
  ok: "border-green-500 bg-green-50",
  needs_human: "border-red-500 bg-red-50",
  no_answer: "border-yellow-500 bg-yellow-50",
  handled: "border-zinc-300 opacity-60",
};

type Props = {
  check: CheckWithClient;
  onAdvance: (id: string) => void;
  onHandled: (id: string) => void;
};

export function ClientCard({ check, onAdvance, onHandled }: Props) {
  const { client } = check;
  const actionable = check.status === "needs_human" || check.status === "no_answer";
  // TODO(Frontend): tier badge with shadcn Badge, pulse on needs_human, final layout.
  return (
    <div className={`rounded-lg border-2 p-4 ${STATUS_STYLE[check.status]}`}>
      <div className="flex items-center justify-between">
        <div className="font-semibold">{client.name}</div>
        <span className="text-xs uppercase">{client.risk_tier}</span>
      </div>
      <div className="mt-1 text-sm">
        {check.status} · step {check.ladder_step}
      </div>
      {check.summary && <p className="mt-2 text-sm text-zinc-600">{check.summary}</p>}
      {check.flag_reason && <p className="mt-1 text-sm text-red-700">{check.flag_reason}</p>}
      {actionable && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onAdvance(check.id)}>
            Advance
          </Button>
          <Button size="sm" onClick={() => onHandled(check.id)}>
            Mark handled
          </Button>
        </div>
      )}
    </div>
  );
}
