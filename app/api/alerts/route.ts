// Alerts with resident name and room. ?open=true (default) returns only unacknowledged, sorted.
import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { listClients, listOpenAlerts } from "@/lib/db";
import { sortAlerts } from "@/lib/status";
import { supabaseAdmin } from "@/lib/supabase";
import type { Alert } from "@/lib/types";

export async function GET(req: NextRequest) {
  const openOnly = req.nextUrl.searchParams.get("open") !== "false";
  return handle(async () => {
    let alerts: Alert[];
    if (openOnly) {
      alerts = sortAlerts(await listOpenAlerts());
    } else {
      const { data, error } = await supabaseAdmin().from("alerts").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      alerts = data as Alert[];
    }
    const byId = new Map((await listClients()).map((c) => [c.id, c]));
    return json(alerts.map((a) => ({ ...a, client_name: byId.get(a.client_id)?.name ?? null, room: byId.get(a.client_id)?.room ?? null })));
  });
}
