// The active crisis run and one crisis_state per resident.
import { connection } from "next/server";
import { handle, json } from "@/lib/api";
import { crisisCurrent } from "@/lib/status";

export async function GET() {
  await connection();
  return handle(async () => json(await crisisCurrent()));
}
