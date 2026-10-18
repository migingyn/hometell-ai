'use client';
import {useEffect,useState} from 'react';
export default function ServiceStatus() {
  const [health,setHealth]=useState(null);
  const [error,setError]=useState('');
  async function load(signal) {
    try {const response=await fetch('/api/health',{cache:'no-store',signal});const result=await response.json();if(!response.ok||!result.ok)throw new Error('Service status unavailable.');setHealth(result.data);setError('');}
    catch(error){if(error.name!=='AbortError')setError(error.message);}
  }
  useEffect(()=>{const controller=new AbortController();
    fetch('/api/health',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(result=>{if(!result.ok)throw new Error('Service status unavailable.');setHealth(result.data);}).catch(error=>{if(error.name!=='AbortError')setError(error.message);});
    return()=>controller.abort();},[]);
  return <section className="panel"><div className="section-heading"><h2>Service readiness</h2><button onClick={()=>{void load();}}>Refresh status</button></div>{error&&<p role="alert">{error}</p>}{health?<><p>{health.mockMode?'Calls are simulated in this local workspace.':'Phone outreach is enabled.'}</p><dl className="facts">{[['Shared database',health.database?'Connected':'Unavailable'],['Phone integration',health.retell.configured?'Configured · live calls not verified':'Not configured'],['Text notifications',health.sms.configured?'Configured · delivery not verified':'Not configured'],['Nurse handoff',health.nurseHandoff.configured?'Configured · connection not verified':'Not configured']].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></>:<p>Checking local services…</p>}</section>;
}
