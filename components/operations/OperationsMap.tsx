"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, MapPin, RefreshCw } from "lucide-react";
import type { CheckWithClient, EventMode } from "@/lib/types";

type Props = { checks: CheckWithClient[]; selectedId: string | null; eventId: string | null; mode: EventMode; mapUrl?: string; onSelect: (id: string) => void };

export function OperationsMap({ checks, selectedId, eventId, mode, mapUrl, onSelect }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState("");
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => setOrigin(window.location.origin), 0); return () => window.clearTimeout(timer); }, []);
  const source = useMemo(() => {
    if (!origin || !mapUrl) return null;
    try { const url = new URL(mapUrl, origin); if (!["http:", "https:"].includes(url.protocol)) return null; url.searchParams.set("embed", "1"); url.searchParams.set("parentOrigin", origin); return url; }
    catch { return null; }
  }, [mapUrl, origin]);
  const visible = useMemo(() => checks.map((check) => check.client_id), [checks]);
  const sendFocus = () => frame.current?.contentWindow?.postMessage({ type: "heartbeat:focus", clientId: selectedId, visibleClientIds: visible, eventId }, source!.origin);
  useEffect(() => {
    if (!source) return;
    function message(event: MessageEvent) {
      if (event.origin !== source!.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "heartbeat:ready") { setReady(true); setFallback(false); }
      if (data?.type === "heartbeat:select" && typeof data.clientId === "string" && visible.includes(data.clientId)) onSelect(data.clientId);
    }
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [source, visible, onSelect, attempt]);
  useEffect(() => {
    if (!source || ready) return;
    const timeout = window.setTimeout(() => setFallback(true), 10000);
    return () => window.clearTimeout(timeout);
  }, [source, attempt, ready]);
  useEffect(() => {
    if (!source || !ready) return;
    frame.current?.contentWindow?.postMessage({ type: "heartbeat:focus", clientId: selectedId, visibleClientIds: visible, eventId }, source.origin);
  }, [source, ready, selectedId, visible, eventId]);
  const points = checks.filter(({ client }) => Number.isFinite(client.lat) && Number.isFinite(client.lng) && Math.abs(client.lat!) <= 90 && Math.abs(client.lng!) <= 180);
  const lats = points.map(p => p.client.lat!); const lngs = points.map(p => p.client.lng!);
  const bounds = { minLat: Math.min(34.16, ...lats) - .005, maxLat: Math.max(34.22, ...lats) + .005, minLng: Math.min(-118.18, ...lngs) - .005, maxLng: Math.max(-118.10, ...lngs) + .005 };
  return <div className="ops-map-canvas">
    {source && <iframe key={attempt} ref={frame} title="Interactive LA patient map" src={source.href} onLoad={() => { if (ready) sendFocus(); }} allow="fullscreen" className={fallback && !ready ? "ops-map-hidden" : ""} />}
    {(!source || (fallback && !ready)) && <div className="ops-map-fallback">
      <svg viewBox="0 0 700 620" role="img" aria-label="Coordinate plot of enrolled patients; satellite map unavailable">
        <defs><pattern id="ops-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#29404b" strokeWidth=".6" /></pattern></defs>
        <rect width="700" height="620" fill="#101f29" /><rect width="700" height="620" fill="url(#ops-grid)" />
        <text x="350" y="80" textAnchor="middle" fill="#a1b9c3" fontSize="12" letterSpacing="3">LOS ANGELES · COORDINATE VIEW</text>
        {points.map(check => { const x = 50 + (check.client.lng! - bounds.minLng) / (bounds.maxLng - bounds.minLng) * 600; const y = 570 - (check.client.lat! - bounds.minLat) / (bounds.maxLat - bounds.minLat) * 450; const danger = check.status === "needs_human" && (check.priority_assessment?.situation === "immediate_danger" || check.urgency === "urgent"); return <g key={check.id} role="button" tabIndex={0} aria-label={`Select ${check.client.name}`} onClick={() => onSelect(check.client_id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(check.client_id); } }}><circle cx={x} cy={y} r={selectedId === check.client_id ? 18 : 13} fill={danger ? "#fb826a" : check.status === "handled" || check.status === "ok" ? "#5dd5b8" : "#e7bd70"} fillOpacity=".2" stroke={selectedId === check.client_id ? "white" : "#82a5b0"} /><circle cx={x} cy={y} r="4" fill={danger ? "#fb826a" : check.status === "handled" || check.status === "ok" ? "#5dd5b8" : "#e7bd70"} /><title>{check.client.name}</title></g>; })}
      </svg><p>{points.length ? `${points.length} recorded positions · no imagery` : "No patient coordinates in this view"}</p>
      {source && <button onClick={() => { setReady(false); setFallback(false); setAttempt(a => a + 1); }}><RefreshCw size={14} /> Retry satellite map</button>}
    </div>}
    {!ready && source && !fallback && <div className="ops-map-loading"><span />Connecting the LA map…</div>}
    <div className="ops-map-location"><MapPin size={15} /><div><strong>West Altadena</strong><span>Los Angeles, California</span></div></div>
    <div className="ops-map-title"><span>{mode === "crisis" ? "RESPONSE NETWORK" : "CARE NETWORK"}</span><h2>{mode === "crisis" ? "Every call changes the picture." : "Care that carries forward."}</h2></div>
    {source && <a className="ops-map-expand" href={mapUrl} target="_blank" rel="noreferrer" aria-label="Open full LA map"><Expand size={16} /></a>}
    <div className="ops-map-legend"><span><i className="urgent" />Human attention</span><span><i className="waiting" />Outreach pending</span><span><i className="settled" />Response / handled</span></div>
    <div className="ops-map-disclaimer">Approximate fictional patient locations. No incident boundary or evacuation route inferred.</div>
  </div>;
}
