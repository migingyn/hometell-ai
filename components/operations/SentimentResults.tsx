"use client";

import { AudioLines, ArrowUpRight, MessageSquareText, Play, Quote, ShieldAlert } from "lucide-react";
import type { CallerAssessment } from "@/lib/types";
import type { AcousticAssessment } from "@/lib/acoustic/types";
import { voiceAnalysisCopy, type VoiceAnalysisState } from "./voice-analysis";
import "./sentiment-results.css";

type Props = {
  assessment: CallerAssessment | null | undefined;
  voice: VoiceAnalysisState | null;
  acoustic: AcousticAssessment | null;
  sample: boolean;
  loading: boolean;
  error?: string;
  onQuoteSelect?: (quote: string) => void;
  onSeek?: (seconds: number) => void;
};

const SEVERITY = {
  immediate_danger: "Immediate danger",
  needs_assistance: "Assistance needed",
  routine: "Routine report",
  unknown: "Not established",
};

const DISTRESS = {
  high: "High distress",
  moderate: "Worry expressed",
  unknown: "Not established",
};

function timestamp(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function SentimentResults({ assessment, voice, acoustic, sample, loading, error, onQuoteSelect, onSeek }: Props) {
  const situation = assessment?.situation ?? "unknown";
  const distress = assessment?.distress ?? "unknown";
  const sentiment = assessment?.transcript_sentiment;
  const textAvailable = Boolean(sentiment && sentiment !== "Unknown");
  const voiceCopy = voice ? voiceAnalysisCopy(voice) : null;
  const pending = Boolean(voice && (voice.status === "processing" || voice.status === "waiting_for_recording" || voice.retryPending));
  const voiceTitle = voiceCopy?.title ?? (sample ? "No sample voice recording" : error ? "Voice status unavailable" : loading ? "Loading voice analysis…" : "Waiting for a recorded call");
  const voiceDetail = voiceCopy?.detail ?? (sample ? "A real phone rehearsal supplies the caller’s audio." : error ? "Refresh the call evidence to check its analysis status." : "The recorded caller’s voice is analyzed after the call.");
  const evidence = assessment?.evidence ?? [];
  // Display only recorded analysis windows belonging to the current call. The
  // job state takes precedence over any earlier available acoustic assessment.
  const moments = voice?.status === "available" && acoustic?.result.status === "available" && onSeek
    ? acoustic.result.segments.filter(segment => Number.isFinite(segment.start_seconds) && Number.isFinite(segment.end_seconds) && segment.start_seconds >= 0 && segment.end_seconds > segment.start_seconds).slice(0, 6)
    : [];

  return <section className="sr-card" aria-label="Sentiment results">
    <header className="sr-header">
      <div><h3><MessageSquareText size={17} aria-hidden="true" />Sentiment results</h3><p>The caller’s situation, words, and voice.</p></div>
      <span className={`sr-stage ${assessment?.stage === "live" && !sample ? "sr-stage-live" : ""}`}>{sample ? "Sample call" : assessment?.stage === "live" ? "Updating live" : "Call analysis"}</span>
    </header>

    <div className="sr-result-grid">
      <div className={`sr-result sr-severity sr-severity-${situation}`}>
        <span className="sr-label"><ShieldAlert size={13} aria-hidden="true" />Reported severity</span>
        <strong>{!assessment && loading ? "Loading…" : SEVERITY[situation]}</strong>
        <span className="sr-source">From the reported situation</span>
      </div>
      <div className={`sr-result sr-distress-${distress}`}>
        <span className="sr-label"><MessageSquareText size={13} aria-hidden="true" />Expressed distress</span>
        <strong>{!assessment && loading ? "Loading…" : DISTRESS[distress]}</strong>
        <span className="sr-source">From the caller’s words</span>
      </div>
      <div className="sr-result sr-text-sentiment">
        <span className="sr-label"><Quote size={13} aria-hidden="true" />Text sentiment</span>
        <strong>{textAvailable ? sentiment : assessment?.stage === "live" ? "Available after the call" : "Not established"}</strong>
        <span className="sr-source">{sample ? "Sample transcript result" : "Retell’s after-call transcript analysis"}</span>
      </div>
      <div className={`sr-result sr-voice ${voice?.status === "available" && voice.signal === "elevated" ? "sr-voice-elevated" : ""}`}>
        <span className="sr-label"><AudioLines size={13} aria-hidden="true" />Voice expression</span>
        <div className="sr-voice-status" role="status" aria-live="polite" aria-atomic="true"><strong>{pending && <span className="sr-progress" aria-hidden="true" />}{voiceTitle}</strong><p>{voiceDetail}</p></div>
        <span className="sr-source">Experimental · recorded audio</span>
      </div>
    </div>

    <div className="sr-evidence">
      <div className="sr-evidence-heading"><h4>Supporting statements</h4>{evidence.length > 0 && onQuoteSelect && <span>Select to find in transcript</span>}</div>
      {evidence.length > 0 ? <div className="sr-quotes">{evidence.map((item, index) => {
        const content = <><span className="sr-quote-heading"><span><Quote size={12} aria-hidden="true" />{item.kind === "situation" ? "Situation" : "Expressed distress"}</span>{onQuoteSelect && <ArrowUpRight size={13} aria-hidden="true" />}</span><span className="sr-quote-text">“{item.quote}”</span></>;
        return onQuoteSelect
          ? <button type="button" className="sr-quote sr-quote-button" key={`${item.kind}-${index}`} onClick={() => onQuoteSelect(item.quote)} aria-label={`Find ${item.kind === "situation" ? "situation" : "distress"} statement in transcript: ${item.quote}`}>{content}</button>
          : <blockquote className="sr-quote" key={`${item.kind}-${index}`}>{content}</blockquote>;
      })}</div> : <p className="sr-empty">{loading ? "Loading the caller’s supporting statements…" : "No supporting caller statement is recorded yet."}</p>}

      {moments.length > 0 && <div className="sr-moments"><span>Jump to a recorded voice moment</span><div>{moments.map((segment, index) => <button type="button" key={`${segment.start_seconds}-${index}`} onClick={() => onSeek?.(segment.start_seconds)} aria-label={`Jump recording to ${timestamp(segment.start_seconds)}, ${segment.signal === "elevated" ? "elevated expression" : "expression uncertain"}`}><Play size={10} aria-hidden="true" /><time>{timestamp(segment.start_seconds)}</time><span>{segment.signal === "elevated" ? "Elevated" : "Uncertain"}</span></button>)}</div></div>}
    </div>

    <p className="sr-note">Severity comes first. Calm or uncertain voice expression never confirms safety.</p>
  </section>;
}
