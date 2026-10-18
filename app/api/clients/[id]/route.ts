// One resident: today's entry, status, recent calls, open alerts, and a 7-day trend.
import { fail, handle, json, parseId } from "@/lib/api";
import { today } from "@/lib/config";
import { listCalls } from "@/lib/db";
import { loadBoardRow, sortAlerts } from "@/lib/status";

export async function GET(_req: Request, ctx: RouteContext<"/api/clients/[id]">) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!id) return fail("Bad client id");
    const row = await loadBoardRow(id);
    if (!row) return fail("Client not found", 404);

    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const calls = await listCalls({ clientId: id, since: weekAgo.toISOString() });

    // One point per day for the last 7 days, from that day's latest analyzed call. Null if none.
    const trend = Array.from({ length: 7 }, (_, i) => {
      const date = today(new Date(Date.now() - (6 - i) * 24 * 3600 * 1000));
      const call = calls.find((c) => c.status === "analyzed" && today(new Date(c.created_at)) === date);
      return {
        date,
        pain_level: call?.pain_level ?? null,
        mood: call?.mood ?? null,
        sleep_quality: call?.sleep_quality ?? null,
      };
    });

    return json({
      client: row.client,
      today_entry: row.entry,
      vitals_status: row.vitals.status,
      card_status: row.card.card_status,
      card_reason: row.card.card_reason,
      last_calls: calls.slice(0, 5),
      open_alerts: sortAlerts(row.openAlerts),
      trend,
    });
  });
}
