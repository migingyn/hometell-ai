"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Headphones, MapPin, Pause, PhoneCall, SignalLow, Users } from "lucide-react";
import type { CheckStatus, CheckWithClient } from "@/lib/types";
import { OperationsMap } from "./OperationsMap";
import "./disaster-experience.css";

type DisasterExperienceProps = {
  checks: CheckWithClient[];
  selectedId: string | null;
  eventId: string | null;
  mapUrl?: string;
  onSelect: (clientId: string) => void;
  onOpenDashboard: () => void;
  children: ReactNode;
  playing: boolean;
  onPause: () => void;
};

const statusLabels: Record<CheckStatus, string> = {
  queued: "Outreach pending",
  calling: "Call in progress",
  ok: "Response received",
  needs_human: "Human follow-up",
  no_answer: "No answer yet",
  handled: "Handled by coordinator",
};

/**
 * A presentation of the enrolled roster, not a second source of call state.
 * All statuses and evidence come from the supplied checks and children.
 */
export function DisasterExperience({
  checks,
  selectedId,
  eventId,
  mapUrl,
  onSelect,
  onOpenDashboard,
  children,
  playing,
  onPause,
}: DisasterExperienceProps) {
  // The parent can key this component by eventId to replay its entrance.
  // A paused initial view is immediately usable, including when data arrives later.
  const [arrivalCount, setArrivalCount] = useState(() => playing ? 0 : Number.MAX_SAFE_INTEGER);

  useEffect(() => {
    if (!playing || !checks.length || arrivalCount >= checks.length) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      setArrivalCount(count => reduceMotion ? checks.length : Math.min(checks.length, count + Math.max(1, Math.ceil(checks.length / 7))));
    }, reduceMotion ? 0 : arrivalCount === 0 ? 280 : 680);
    return () => window.clearTimeout(timer);
  }, [playing, checks.length, arrivalCount]);

  const visibleChecks = useMemo(() => checks.filter((check, index) => index < arrivalCount || check.client_id === selectedId), [checks, arrivalCount, selectedId]);
  const selected = checks.find(check => check.client_id === selectedId);
  const arriving = playing && arrivalCount < checks.length;

  return <section className="de-experience" aria-labelledby="de-title">
    <header className="de-intro">
      <div>
        <p className="de-eyebrow"><span /> DISASTER DEMO <span className="de-eyebrow-divider">/</span> LOS ANGELES</p>
        <h1 id="de-title">An alert reaches a phone.<br /><span>A conversation reaches a person.</span></h1>
        <p className="de-intro-copy">A fictional wildfire threatens West Altadena. Heartbeat checks in with enrolled residents, listens to what they need, and brings unresolved cases to a coordinator.</p>
      </div>
      <div className="de-context">
        <span className="de-sample-label"><Users size={14} aria-hidden="true" /> Sample residents • one optional real rehearsal call</span>
        <p>Explore a person on the map, open their call evidence, then follow the next action.</p>
      </div>
    </header>

    <ol className="de-story" aria-label="Disaster demo steps">
      <li className="de-step-current"><span>01</span><MapPin size={15} aria-hidden="true" /><strong>See the people</strong></li>
      <li className={selected ? "de-step-current" : ""}><span>02</span><PhoneCall size={15} aria-hidden="true" /><strong>Open a person’s call</strong></li>
      <li><span>03</span><Headphones size={15} aria-hidden="true" /><strong>Bring a person in</strong></li>
    </ol>

    <div className="de-workspace">
      <div className="de-map-column">
        <div className="de-map-heading">
          <div><span className="de-roster-dot" /><strong>{arriving ? "Sample residents appearing" : "The enrolled community"}</strong><span>{visibleChecks.length} of {checks.length}</span></div>
          {playing && <button className="de-pause" onClick={onPause}><Pause size={13} aria-hidden="true" /> Pause walkthrough</button>}
        </div>
        <div className="de-map">
          <OperationsMap checks={visibleChecks} selectedId={selectedId} eventId={eventId} mode="crisis" mapUrl={mapUrl} onSelect={onSelect} />
          {!checks.length && <div className="de-map-empty"><Users size={22} aria-hidden="true" /><strong>The roster will appear here.</strong><p>Start a sample crisis to explore each resident’s check-in.</p></div>}
        </div>
        <div className="de-residents" aria-label="Choose a resident">
          <div className="de-residents-label"><Users size={14} aria-hidden="true" /><span>Choose a person</span><ArrowRight size={13} aria-hidden="true" /></div>
          <div className="de-residents-list">
            {visibleChecks.map(check => <button key={check.client_id} className={`de-resident de-resident-${check.status}`} aria-pressed={selectedId === check.client_id} onClick={() => onSelect(check.client_id)}>
              <span className="de-resident-marker" aria-hidden="true" />
              <span><strong>{check.client.name}</strong><small>{statusLabels[check.status]}</small></span>
            </button>)}
            {!visibleChecks.length && <span className="de-roster-wait">{checks.length ? "Revealing the sample roster…" : "No enrolled residents yet"}</span>}
          </div>
        </div>
        <div className="de-connection-note">
          <SignalLow size={18} aria-hidden="true" />
          <div><strong>A missed call is still an open case.</strong><span>Retry → text → listed contact → human follow-up. A missing response never means someone is safe.</span></div>
        </div>
      </div>

      <aside className="de-person-panel" aria-label="Selected resident call and next action">
        <div className="de-person-heading">
          <span className="de-panel-number">02</span>
          <div><span className="de-panel-eyebrow">THE CONVERSATION</span><h2>{selected ? `${selected.client.name}’s check-in` : "There’s a person behind every dot."}</h2></div>
          <PhoneCall size={19} aria-hidden="true" />
        </div>
        {!selected && <div className="de-select-hint"><MapPin size={26} aria-hidden="true" /><strong>Start with one person.</strong><p>Select a map marker or a name below the map to open their check-in and call evidence.</p></div>}
        <div className="de-person-content">{children}</div>
        <div className="de-dashboard-handoff">
          <div><span>03 · THE NEXT ACTION</span><p>{selected ? `Take ${selected.client.name.split(" ")[0]}’s case into the coordinator’s view.` : "See who needs follow-up and what happens next."}</p></div>
          <button onClick={onOpenDashboard}>Open coordinator dashboard <ArrowRight size={16} aria-hidden="true" /></button>
          <small>The selected person stays with you. A coordinator owns the next decision.</small>
        </div>
      </aside>
    </div>
    <p className="de-demo-footnote">Sample scenarios are labeled. Sample calls have transcripts only; audio appears when a real recording is available.</p>
  </section>;
}
