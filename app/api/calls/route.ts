// Latest calls with resident name and room.
import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { listCalls, listClients } from "@/lib/db";

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 200);
  return handle(async () => {
    const [calls, clients] = await Promise.all([listCalls({ limit }), listClients()]);
    const byId = new Map(clients.map((c) => [c.id, c]));
    return json(calls.map((c) => ({ ...c, client_name: byId.get(c.client_id)?.name ?? null, room: byId.get(c.client_id)?.room ?? null })));
  });
}
