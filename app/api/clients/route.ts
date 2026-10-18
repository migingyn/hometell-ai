// Resident list with computed card status.
import { handle, json } from "@/lib/api";
import { loadBoard } from "@/lib/status";

export async function GET() {
  return handle(async () => {
    const board = await loadBoard();
    return json(
      board.map(({ client, vitals, card, lastCall, lastAnalyzed, openAlerts }) => ({
        id: client.id,
        name: client.name,
        preferred_name: client.preferred_name,
        room: client.room,
        aide_name: client.aide_name,
        nurse_name: client.nurse_name,
        vitals_status: vitals.status,
        card_status: card.card_status,
        card_reason: card.card_reason,
        last_call_at: lastCall ? (lastCall.started_at ?? lastCall.created_at) : null,
        last_pain_level: lastAnalyzed?.pain_level ?? null,
        last_mood: lastAnalyzed?.mood ?? null,
        open_alert_count: openAlerts.length,
      })),
    );
  });
}
