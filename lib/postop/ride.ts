import { callerUtterances } from "@/lib/classifier/priority";
import type { RetellCall } from "@/lib/types";

/** Only an explicit, attributed transport answer may replace the saved plan. */
export function reportedRideNeed(call: RetellCall): boolean | null {
  const data = call.call_analysis?.custom_analysis_data ?? {};
  if (typeof data.needs_ride !== "boolean" || typeof data.needs_ride_quote !== "string") return null;
  const quote = data.needs_ride_quote.trim();
  if (!quote || quote.length > 2000 || !callerUtterances(call).some((turn) => turn.trim() === quote)) return null;
  const text = quote.toLowerCase().replace(/[‘’]/g, "'");
  if (/\?|\b(?:maybe|might|not sure|unsure|think|don't know|do not know|yesterday|used to|if|unless|said|says|told|not true|not anymore)\b/.test(text)) return null;
  const needs = /\b(?:i|we) (?:do |will |would |still )?(?:need|require) (?:a |some )?(?:ride|transport|transportation)\b/.test(text) ||
    /\b(?:i|we) (?:do |will |would |still )?need (?:some )?(?:help|assistance) (?:getting out|leaving|evacuating)\b/.test(text) ||
    /\b(?:i|we) (?:can't|cannot|can not|am unable to|are unable to) (?:leave|get out|evacuate) (?:on (?:my|our) own|independently|by (?:myself|ourselves)|without help)\b/.test(text) ||
    /\b(?:i|we) (?:don't|do not) have (?:a ride|transportation|transport|a way to leave)\b/.test(text) ||
    /(?:나가|대피|이동|차량|차편)[^.!?]{0,35}(?:도움이 필요|지원이 필요|필요해|필요합니다)/.test(text);
  const independent = /\b(?:i|we) (?:can|am able to|are able to) (?:leave|get out|evacuate) (?:on (?:my|our) own|independently|by (?:myself|ourselves)|without help)\b/.test(text) ||
    /\b(?:i|we) (?:don't|do not|won't|will not) need (?:a )?(?:ride|transport|transportation)\b/.test(text) ||
    /\b(?:i|we) (?:don't|do not) need (?:help|assistance) (?:getting out|leaving|evacuating)\b/.test(text) ||
    /혼자[^.!?]{0,15}(?:나갈|대피할|이동할) 수 있/.test(text) ||
    /(?:차량|차편|이동 지원|대피 도움)[^.!?]{0,15}(?:필요 없|필요없|필요하지 않)/.test(text);
  if (needs === independent) return null;
  return data.needs_ride === needs ? needs : null;
}
