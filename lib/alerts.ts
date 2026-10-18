// Creates alerts: save, log, push to /api/events, and text the front desk if Twilio is set.
import { getClient } from "@/lib/db";
import { publish, pushClientStatus, pushCrisis, pushQuietly } from "@/lib/events";
import { sendFrontDeskSms, smsConfigured } from "@/lib/sms";
import { supabaseAdmin } from "@/lib/supabase";
import type { Alert, AlertType, Client, Urgency } from "@/lib/types";

export { sortAlerts } from "@/lib/status";

export type NewAlert = {
  client_id: number;
  call_id?: string | null;
  type: AlertType;
  urgency: Urgency;
  message: string;
  quote?: string | null;
  crisis?: boolean; // Also refresh the crisis board
};

// Returns the new alert, or null if this call already has an alert of this type.
// flag_nurse alerts are never deduped: the agent may flag twice for different reasons.
export async function createAlert(input: NewAlert): Promise<Alert | null> {
  const callId = input.call_id ?? null;
  const dedupKey = callId && input.type !== "flag_nurse" ? `${callId}:${input.type}` : null;

  const { data, error } = await supabaseAdmin()
    .from("alerts")
    .insert({
      client_id: input.client_id,
      call_id: callId,
      type: input.type,
      urgency: input.urgency,
      message: input.message,
      quote: input.quote ?? null,
      dedup_key: dedupKey,
    })
    .select()
    .single();
  if (error?.code === "23505") return null; // Duplicate, already alerted
  if (error) throw new Error(error.message);

  const alert = data as Alert;
  const client = await getClient(alert.client_id);
  console.log(`[alert] ${alert.urgency.toUpperCase()} ${alert.type} room ${client?.room ?? "?"}: ${alert.message}`);

  publish("alert", { alert, client });
  pushQuietly(pushClientStatus(alert.client_id));
  if (input.crisis || alert.type.startsWith("crisis_")) pushQuietly(pushCrisis());

  if (client && smsConfigured()) {
    sendFrontDeskSms(smsText(alert, client)).catch((e) => console.error("[sms] failed", e));
  }
  return alert;
}

export function crisisNoResponseMessage(room: string): string {
  return `CRISIS. No response. Send staff to Room ${room} now.`;
}

// "HEARTBEAT {URGENCY}. Room {room}, {name}. {message}", cut to 160 characters.
export function smsText(alert: Alert, client: Client): string {
  const text = `HEARTBEAT ${alert.urgency.toUpperCase()}. Room ${client.room}, ${client.name}. ${alert.message}`;
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}

export async function ackAlert(id: number, by: string): Promise<Alert | null> {
  const { data, error } = await supabaseAdmin()
    .from("alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: by })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  const alert = data as Alert | null;
  if (alert) {
    publish("alert_ack", { alert_id: alert.id, acknowledged_by: by });
    pushQuietly(pushClientStatus(alert.client_id));
  }
  return alert;
}
