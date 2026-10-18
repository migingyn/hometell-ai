'use client';

import { useState } from 'react';
import { useCare } from './care-context';

export const labels = { red: 'Urgent', yellow: 'Check soon', green: 'Outcome recorded', gray: 'No outcome recorded', safe: 'Safe', needs_help: 'Needs help', no_response: 'No response', calling: 'Calling', not_reached: 'Not reached yet' };
export const words = value => String(value ?? 'Not documented').replaceAll('_', ' ');
export const time = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded';
export const alertSort = (a, b) => Number(b.type === 'crisis_no_response') - Number(a.type === 'crisis_no_response') || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0);

export function Badge({ status, children }) {
  const color = ['red', 'yellow', 'green', 'gray', 'normal', 'watch', 'alert'].includes(status) ? status : '';
  return <span className={`badge ${color}`}>{children || labels[status] || words(status)}</span>;
}
export function ActionButton({ action, children, ...props }) {
  const [pending, setPending] = useState(false);
  const { setError } = useCare();
  return <button {...props} disabled={pending || props.disabled} onClick={async () => {
    setPending(true);
    try { await action(); } catch (err) { setError(err.message); } finally { setPending(false); }
  }}>{pending ? 'Please wait…' : children}</button>;
}
export function AlertCard({ alert, urgent = false }) {
  const { setAckId, setSelected } = useCare();
  const noResponse = alert.type === 'crisis_no_response';
  const title = noResponse ? `NO RESPONSE. GO TO ROOM ${alert.room}` : `Room ${alert.room} · ${alert.name}`;
  return <article className={`${urgent ? 'urgent-card' : 'alert-item'} ${noResponse ? 'no-response' : ''}`}>
    <div><span className="eyebrow">{alert.urgency === 'now' ? 'IMMEDIATE STAFF RESPONSE' : 'FOLLOW UP TODAY'}</span>
      {urgent ? <h2>{title}</h2> : <h3>{title}</h3>}
      {noResponse && <strong>{alert.name}</strong>}
      <p>{alert.reason || alert.message || words(alert.type)}</p>
      {alert.quote && <blockquote>“{alert.quote}”</blockquote>}<small>{time(alert.created_at)}</small>
    </div>
    <div className="alert-actions"><button onClick={() => setAckId(alert.id)}>Acknowledge</button><button onClick={() => setSelected(alert.client_id)}>View resident</button></div>
  </article>;
}
