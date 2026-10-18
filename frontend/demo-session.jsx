'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

const KEY = 'heartbeat-demo-session';
const EVENT = 'heartbeat-demo-session-change';
const names = { administrator: 'Alex Morgan (Demo)', nurse: 'Jordan Lee (Demo)' };

function subscribe(listener) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
function snapshot() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function demoLanding(role) { return role === 'administrator' ? '/facilities' : '/my-day'; }
export function beginDemo(role) {
  if (!(role in names)) throw new Error('Choose a demo role.');
  // The email and password never enter this function or browser storage.
  sessionStorage.removeItem('heartbeat-demo-facility');
  sessionStorage.setItem(KEY, JSON.stringify({ role, name: names[role] }));
  window.dispatchEvent(new Event(EVENT));
}
export function endDemo() {
  sessionStorage.removeItem('heartbeat-demo-facility');
  sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}
export function useDemoSession() {
  const value = useSyncExternalStore(subscribe, snapshot, () => undefined);
  const session=useMemo(()=>{
    try {
      const parsed=value ? JSON.parse(value) : null;
      if(parsed && Object.hasOwn(names,parsed.role) && parsed.name===names[parsed.role]) return {role:parsed.role,name:parsed.name};
    } catch { /* Malformed demo sessions return to login. */ }
    return null;
  },[value]);
  return { session, loading: value === undefined };
}
export function DemoGate({ children, role = '' }) {
  const {session,loading} = useDemoSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (role && role !== session.role) router.replace(demoLanding(session.role));
  }, [loading, session, role, router]);
  if (loading || !session || (role && role !== session.role)) return <p className="loading-shell">Opening demo workspace…</p>;
  return children;
}
export function DemoHome() {
  const {session,loading}=useDemoSession();
  const router=useRouter();
  useEffect(()=>{if(!loading)router.replace(session ? demoLanding(session.role) : '/login');},[loading,session,router]);
  return <p className="loading-shell">Opening Heartbeat…</p>;
}
