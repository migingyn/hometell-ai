// Vitals status from today's nurse entry. Plain rules, no AI.
// The AI agent never sees the numbers, only the status and the nurse's note.
import type { DailyEntry, VitalName, VitalsRanges, VitalsStatus } from "@/lib/types";

export const NO_VITALS_NOTE = "No vitals entered today. Ask how they feel.";

const VITALS: VitalName[] = ["bp_sys", "bp_dia", "heart_rate", "temp_f", "spo2"];

export type VitalsResult = { status: VitalsStatus; note: string | null };

export function vitalsStatus(entry: DailyEntry | null, ranges: VitalsRanges): VitalsResult {
  const values = VITALS.filter((v) => entry?.[v] != null);
  if (!entry || values.length === 0) return { status: "watch", note: NO_VITALS_NOTE };

  let status: VitalsStatus = "normal";
  for (const v of values) {
    const value = entry[v] as number;
    const range = ranges[v];
    if (!range) continue;
    if (value < range.min || value > range.max) return { status: "alert", note: entry.vitals_watch_note };
    // Within 5% of either limit, measured on the range width. 5% of the limit value itself
    // would flag every normal temperature (96.8 to 99.8) and most oxygen readings.
    const margin = (range.max - range.min) * 0.05;
    if (value - range.min <= margin || range.max - value <= margin) {
      status = "watch";
    }
  }
  return { status, note: entry.vitals_watch_note };
}

// Sort key for crisis calls: alert first, then watch, then normal.
export const VITALS_ORDER: Record<VitalsStatus, number> = { alert: 0, watch: 1, normal: 2 };
