import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
if (window.location.pathname.startsWith('/prescription')) document.title = 'SourceCheck · Prescription Case Room';
if (window.location.pathname.startsWith('/heartbeat')) document.title = 'Heartbeat · Live LA Check-in Map';
const Application = window.location.pathname.startsWith('/heartbeat')
  ? lazy(() => import('./heartbeat/HeartbeatMap'))
  : window.location.pathname.startsWith('/prescription')
  ? lazy(() => import('./prescription/CaseRoom'))
  : lazy(() => import('./App'));
createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<div style={{padding:40,color:'#edf2ee',fontFamily:'sans-serif'}}>Opening {window.location.pathname.startsWith('/heartbeat') ? 'Heartbeat' : 'SourceCheck'}…</div>}><Application /></Suspense></React.StrictMode>);
