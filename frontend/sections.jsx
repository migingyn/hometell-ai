'use client';
import PreparedContext from './PreparedContext';
import {useState} from 'react';
import {useCare} from './care-context';
import {ActionButton,AlertCard,Badge,alertSort,labels,time,words} from './ui';

export function ResidentDirectory() {
  const { clients, loading, setSelected, callResident, account } = useCare();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = clients.filter(c => (filter === 'all' || c.card_status === filter) && [c.name, c.preferred_name, c.room, c.aide_name, c.nurse_name].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Resident directory"><div className="section-heading"><div><h2>Residents <span className="count">{clients.length}</span></h2><p className="muted">Your next action starts here.</p></div></div>
    <div className="filters"><label className="search"><span className="sr-only">Search residents, rooms, or staff</span><input placeholder="Search name, room, or staff…" type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span className="sr-only">Filter status</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All residents</option>{['red','yellow','green','gray'].map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label></div>
    <div className="resident-grid">{loading ? <p>Loading residents…</p> : visible.length ? visible.map(c => <article className={`resident-card ${c.card_status}`} key={c.id}>
      <div className="card-top"><div><span className="eyebrow">ROOM</span><div className="room">{c.room}</div></div><Badge status={c.card_status} /></div>
      <button className="resident-name" onClick={() => setSelected(c.id)}>{c.name}</button><p className="staff">{c.nurse_name || 'Nurse unassigned'} · Aide {c.aide_name || 'unassigned'}</p>
      <div className="card-vitals"><Badge status="gray">{c.rounds?.recorded ? `Vitals: ${c.rounds.recorded}/${c.rounds.total} recorded today` : 'Vitals: not recorded today'}</Badge><span>Pain <strong>{c.last_pain_level ?? '—'}</strong> / 10</span></div><p className="mood">Mood: {c.last_mood || 'Not recorded'}</p><p className="reason">{c.card_reason || 'No update available.'}</p>
      <div className="card-bottom"><small>Last check-in<br />{time(c.last_call_at)}</small>{account.role==='nurse'&&<ActionButton action={() => callResident(c.id)}>Call now ↗</ActionButton>}</div>
    </article>) : <p className="empty">No residents match your search.</p>}</div>
  </section>;
}

export function CallActivity() {
  const { calls, loading, setSelected } = useCare();
  return <section className="panel" aria-label="Call activity"><div className="section-heading"><h2>Call activity</h2><span className="muted">Latest 20</span></div>
    {loading ? <p>Loading calls…</p> : calls.length ? calls.slice(0,20).map(c => <article className="feed-row" key={c.id || c.call_id}><span className="call-icon">↗</span><div><strong>{c.name} <span className="muted">· Room {c.room}</span></strong><p>{c.summary || 'No summary available.'}</p><small>{time(c.created_at || c.started_at)}</small>{c.context&&<details className="call-context"><summary>View prepared call context</summary><PreparedContext context={c.context} snapshot/></details>}</div><Badge>{words(c.status)}</Badge><button onClick={()=>setSelected(c.client_id,'calls')}>View resident &amp; evidence</button></article>) : <p className="empty">No calls yet.</p>}
  </section>;
}

export function FollowUps() {
  const { alerts, loading } = useCare();
  const today = alerts.filter(a => a.urgency !== 'now').sort(alertSort);
  return <section className="panel" aria-label="Follow-ups"><div className="section-heading"><h2>Follow-ups</h2><span className="count">{today.length}</span></div><p className="muted">Acknowledgements record who responded. Immediate alerts stay pinned above every page.</p>{loading ? <p>Loading follow-ups…</p> : today.length ? today.map(a => <AlertCard key={a.id} alert={a} />) : <p className="empty">No follow-ups for today.</p>}</section>;
}
