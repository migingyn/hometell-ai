'use client';

import {HeartPulse} from 'lucide-react';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beginDemo, demoLanding } from './demo-session';

export default function LoginForm() {
  const router = useRouter();
  const email = useRef(null);
  const password = useRef(null);
  const [role,setRole] = useState('administrator');
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  return <main className="demo-login"><section className="login-story" aria-label="About Heartbeat"><a href="/login" className="care-brand"><span><HeartPulse size={22}/></span>heartbeat<i>.</i></a><div><p className="eyebrow">A LITTLE CONNECTION. EVERY DAY.</p><h1>More time for<br/>the human side<br/>of care.</h1><p>A calmer way to coordinate wellness calls, daily rounds, and the people who make care possible.</p><div className="login-story-card"><span className="login-heart">♥</span><div><strong>Every resident. Every check-in.</strong><p>One connected care team.</p></div></div></div><p className="login-footnote">HEARTBEAT · CARE & OPERATIONS</p></section>
    <section className="login-form-side"><div className="login-card"><span className="demo-pill">HACKATHON DEMO</span><h2>Welcome to Heartbeat</h2><p className="muted">Explore the workspace from your team&apos;s perspective.</p><p className="demo-login-label">Demo login — use fictional credentials.</p>
      <form autoComplete="off" onSubmit={event=>{
        event.preventDefault();
        if (!email.current.value.trim() || !password.current.value.length) {setError('Enter any nonempty email and password to explore the demo.');return;}
        setPending(true);setError('');
        try {
          beginDemo(role);
          // Clear credential fields before navigation. Neither value is retained.
          email.current.value='';password.current.value='';
          router.replace(demoLanding(role));
        } catch {setError('Enable session storage in your browser to open the demo.');setPending(false);}
      }}>
        <label htmlFor="demo-email">Email<input ref={email} id="demo-email" type="text" inputMode="email" required placeholder="you@example.test" autoComplete="off"/></label>
        <label htmlFor="demo-password">Password<input ref={password} id="demo-password" type="password" required placeholder="Any fictional password" autoComplete="off"/></label>
        <fieldset className="role-picker"><legend>Explore as</legend>{[['administrator','Administrator','Facilities & operations'],['nurse','Nurse','Residents & daily care']].map(([value,label,description])=><label className={`role-option ${role===value?'chosen':''}`} key={value}><input type="radio" name="demo-role" value={value} checked={role===value} onChange={()=>setRole(value)}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
        {error && <p role="alert" className="error-message">{error}</p>}<button className="dark login-submit" disabled={pending}>{pending?'Opening workspace…':'Enter demo workspace →'}</button>
      </form>
      <p className="demo-disclaimer">Fictional residents only. This frontend role switch does not secure real patient information.</p>
    </div></section>
  </main>;
}
