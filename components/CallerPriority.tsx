import type { CallerAssessment } from "@/lib/types";
import type { AcousticAssessment } from "@/lib/acoustic/types";

const PRIORITY_LABEL = {
  immediate: "Immediate attention",
  urgent: "Urgent attention",
  follow_up: "Follow up",
  review: "Needs review",
} as const;
const SITUATION_LABEL = {
  immediate_danger: "Immediate danger reported",
  needs_assistance: "Assistance needed",
  routine: "Routine request",
  unknown: "Not established",
} as const;
const DISTRESS_LABEL = { high: "High", moderate: "Moderate", unknown: "Not established" } as const;

function AcousticEvidence({ acoustic }: { acoustic: AcousticAssessment }) {
  const { result } = acoustic;
  const available = result.status === "available";
  const scores = available ? Object.entries(result.scores).filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  const inspectedSeconds = result.segments.reduce((total, segment) => total + Math.max(0, segment.end_seconds - segment.start_seconds), 0);
  const summary = available ? result.signal === "elevated" ? "Elevated expression signal" : "Expression signal uncertain"
    : result.status === "insufficient_audio" ? "Insufficient usable caller audio" : "Recording analysis unavailable";
  return <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--hb-border)" }} aria-label="Post-call acoustic evidence">
    <p className="font-medium">{summary}</p>
    <p className="mt-1 text-[10px]" style={{ color: "var(--hb-faint)" }}>{acoustic.source === "local_test" ? "Local audio test" : "Retell call recording"} · post-call analysis</p>
    {available ? <>
      <p className="mt-2 text-[10px]" style={{ color: "var(--hb-muted)" }}>Speech-expression model output for operator review. It does not establish panic, a diagnosis, or safety.</p>
      {scores.length ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Model class scores">
        {scores.map(([label, score]) => <span key={label}>{label}: <span className="font-mono">{score.toFixed(2)}</span></span>)}
      </div> : null}
      <p className="mt-1 text-[10px]" style={{ color: "var(--hb-faint)" }}>Class scores are not probabilities of panic.</p>
      <p className="mt-2 text-[10px]" style={{ color: "var(--hb-faint)" }}>{result.quality.speech_seconds.toFixed(1)} s speech-like audio · {result.quality.caller_channel === null ? "Caller channel not established" : "Caller channel isolated"}</p>
      <p className="mt-1 text-[10px]" style={{ color: "var(--hb-faint)" }}>{inspectedSeconds.toFixed(1)} of {result.quality.duration_seconds.toFixed(1)} s inspected</p>
    </> : null}
    {result.warnings.length ? <p className="mt-2 break-words text-[10px]" style={{ color: "var(--hb-amber)" }}>{available ? result.warnings[0] : result.warnings.at(-1)}</p> : null}
    {result.model.id ? <p className="mt-2 break-words text-[10px]" style={{ color: "var(--hb-faint)" }}>Model: {result.model.id}{result.model.revision ? ` · ${result.model.revision}` : ""}</p> : null}
  </div>;
}

export function CallerPriority({ assessment, acoustic }: { assessment?: CallerAssessment | null; acoustic?: AcousticAssessment | null }) {
  if (!assessment && !acoustic) return null;
  const immediate = assessment?.priority === "immediate";
  const accent = immediate ? "var(--hb-red)" : "var(--hb-amber)";
  const available = acoustic?.result.status === "available";
  const voiceLabel = available ? acoustic.result.signal === "elevated" ? "Elevated expression signal · post-call" : "Uncertain expression signal · post-call"
    : acoustic?.result.status === "insufficient_audio" ? "Unavailable · insufficient caller audio" : "Unavailable · no usable audio assessment";
  const reasons = (assessment?.reasons ?? []).filter((reason) => !reason.startsWith("Acoustic expression:") &&
    !(available && reason.startsWith("Audible distress is unavailable:")));

  return (
    <section aria-label="Suggested operator priority" className="mb-4 rounded border p-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--hb-border)", background: "#101e254d" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span style={{ color: "var(--hb-muted)" }}>Suggested operator priority</span>
        <strong className="font-medium" style={{ color: accent }}>{assessment ? PRIORITY_LABEL[assessment.priority] : "Not assessed"}</strong>
      </div>
      <p className="mt-1 text-[10px]" style={{ color: "var(--hb-faint)" }}>
        {assessment ? assessment.stage === "live" ? "Live transcript snapshot · provisional" : "Post-call transcript" : "No transcript assessment"}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: "var(--hb-muted)" }}>View assessment and evidence</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
          <dt style={{ color: "var(--hb-faint)" }}>Reported severity</dt>
          <dd>{assessment ? SITUATION_LABEL[assessment.situation] : "Not established"}</dd>
          <dt style={{ color: "var(--hb-faint)" }}>Reported distress</dt>
          <dd>{assessment ? DISTRESS_LABEL[assessment.distress] : "Not established"}{assessment && assessment.distress !== "unknown" ? " · caller’s words" : ""}</dd>
          <dt style={{ color: "var(--hb-faint)" }}>Acoustic expression</dt>
          <dd>{voiceLabel}</dd>
          {assessment?.transcript_sentiment && assessment.transcript_sentiment !== "Unknown" ? <>
            <dt style={{ color: "var(--hb-faint)" }}>Text sentiment</dt>
            <dd>{assessment.transcript_sentiment} · transcript only</dd>
          </> : null}
        </dl>
        {assessment?.evidence.length ? <ul className="mt-3 space-y-2" aria-label="Caller evidence">
          {assessment.evidence.map((item, index) => <li key={`${item.kind}-${index}`}>
            <span className="text-[10px]" style={{ color: "var(--hb-faint)" }}>{item.kind === "situation" ? "Situation evidence" : "Distress evidence"}</span>
            <blockquote className="mt-1 break-words border-l-2 pl-2" style={{ borderColor: accent }}>“{item.quote}”</blockquote>
          </li>)}
        </ul> : <p className="mt-3" style={{ color: "var(--hb-faint)" }}>No supporting caller quote recorded.</p>}
        {reasons.length ? <ul className="mt-3 list-disc space-y-1 pl-4" aria-label="Priority reasons">
          {reasons.map((reason, index) => <li className="break-words" key={index}>{reason}</li>)}
        </ul> : null}
        {acoustic ? <AcousticEvidence acoustic={acoustic} /> : null}
        <p className="mt-3 text-[10px]" style={{ color: "var(--hb-faint)" }}>Reported severity comes first. Distress only changes review order within the same tier; calm does not establish wellbeing. A person decides the response.</p>
      </details>
    </section>
  );
}
