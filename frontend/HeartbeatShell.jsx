'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,Building2,CalendarCheck,ChevronRight,ClipboardList,HeartPulse,LayoutDashboard,LogOut,MapPin,Phone,Radio,Settings,Users,Volume2,VolumeX} from 'lucide-react';
import {CareProvider,useCare} from './care-context';
import {AlertCard} from './ui';
import {ResidentDetail} from './resident-detail';
import {endDemo,useDemoSession} from './demo-session';

const items={
 administrator:[['/overview','Facility overview',LayoutDashboard],['/residents','Residents',Users],['/outreach','Daily outreach',Phone],['/crisis','Crisis response',Radio],['/follow-ups','Follow-ups',ClipboardList],['/operations','Operations',CalendarCheck],['/team','Care team',Users],['/settings','Settings',Settings]],
 nurse:[['/my-day','My Day',LayoutDashboard],['/residents','Residents',Users],['/daily-rounds','Daily Rounds',Activity],['/outreach','Daily outreach',Phone],['/crisis','Crisis response',Radio],['/follow-ups','Follow-ups',ClipboardList]],
};
function AcknowledgeDialog({id}){
 const care=useCare();const dialog=useRef(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} className="care-dialog" onCancel={()=>care.setAckId(null)}><form onSubmit={async event=>{event.preventDefault();setBusy(true);try{await care.perform(`/api/alerts/${id}/ack`,{by:new FormData(event.currentTarget).get('by')},'Acknowledgement recorded.');care.setAckId(null);}catch(error){setError(error.message);}finally{setBusy(false);}}}>
 <span className="eyebrow">STAFF FOLLOW-UP</span><h2>Acknowledge alert</h2><p>This records your response and keeps unresolved care visible.</p><label>Your name or initials<input name="by" defaultValue={care.account.name} required maxLength={100}/></label>{error&&<p role="alert">{error}</p>}<div className="form-actions"><button type="button" onClick={()=>care.setAckId(null)}>Cancel</button><button className="dark" disabled={busy}>{busy?'Saving…':'Acknowledge'}</button></div></form></dialog>;
}
function Shell({children}){
 const care=useCare();const pathname=usePathname();const router=useRouter();
 const selecting=pathname==='/facilities';const outreach=['/outreach','/crisis'].includes(pathname);
 const allowed=care.account.role==='nurse'||Boolean(care.facilityId)||selecting;
 useEffect(()=>{if(!allowed)router.replace('/facilities');},[allowed,router]);
 const navigation=[...items[care.account.role]];
 navigation.splice(care.account.role==='administrator'?4:4,0,['/calls','Call history',Phone]);
 const current=navigation.find(([path])=>pathname===path||pathname.startsWith(path+'/'));
 const title=pathname==='/record-vitals'?'Record vitals':selecting?'Choose your facility':current?.[1]||'Resident record';
 const urgent=care.alerts.filter(a=>a.urgency==='now');
 return <div className="care-shell">
   <a className="skip" href="#main">Skip to page content</a>
   <header className="care-topbar"><Link className="care-brand" href={care.account.role==='nurse'?'/my-day':'/facilities'}><span><HeartPulse size={22}/></span>heartbeat<i>.</i></Link><span className="care-wordmark-caption">CARE, CONNECTED.</span>
    <div className="care-facility-context"><Building2 size={16}/><div><small>{selecting?'LOS ANGELES NETWORK':'CURRENT FACILITY'}</small><strong>{care.activeFacility?.name||(selecting?'Select a facility to begin':'Loading facility…')}</strong></div>{care.account.role==='administrator'&&<Link href="/facilities">Switch facility <ChevronRight size={12}/></Link>}</div>
    <span className="care-demo-label">DEMO WORKSPACE</span><div className="care-user"><span>{care.account.name.split(' ').slice(0,2).map(s=>s[0]).join('')}</span><div><strong>{care.account.name.replace(' (Demo)','')}</strong><small>{care.account.role}</small></div></div><button className="care-icon-button" aria-label="Log out" title="Log out" onClick={()=>{endDemo();router.replace('/login');}}><LogOut size={17}/></button>
   </header>
   <div className={`care-layout ${selecting?'care-layout-selector':''}`}>
    {!selecting&&<aside className="care-sidebar"><span className="eyebrow">WORKSPACE</span><nav aria-label="Main navigation">{navigation.map(([href,label,Icon])=><Link href={href} key={href} aria-current={current?.[0]===href?'page':undefined}><Icon size={16}/>{label}</Link>)}</nav><div className="care-sidebar-bottom"><span className={`care-signal ${care.online?'connected':''}`}/><span>{care.online?'Records connected':'Updating records'}</span><small>{care.useMock?'Simulated calls · shared records':'Phone outreach · shared records'}</small></div></aside>}
    <main id="main" tabIndex={-1} className={`care-main ${outreach?'care-main-outreach':''}`}>
     {!outreach&&!selecting&&<div className="page-heading"><div><span className="eyebrow">{care.activeFacility?.city||'LOS ANGELES'} / {care.account.role==='nurse'?'DAILY CARE':'CARE OPERATIONS'}</span><h1>{title}</h1><p>{care.config?.agency_name} · {new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</p></div><div className="utilities"><button onClick={()=>{void care.enableAudio().catch(e=>care.setError(e.message));}} disabled={care.soundEnabled}>{care.soundEnabled?<Volume2 size={14}/>:<VolumeX size={14}/>} {care.soundEnabled?'Sound enabled':'Enable alert sound'}</button></div></div>}
     {care.error&&<div className="error-message" role="alert">{care.error}<button onClick={()=>{void care.refresh();}}>Retry connection</button></div>}
     {care.notice&&<div className="notice" role="status">{care.notice}<button aria-label="Dismiss notice" onClick={()=>care.setNotice('')}>×</button></div>}
     {!selecting&&urgent.length>0&&<section className="urgent-stack" aria-label="Urgent resident alerts">{urgent.slice(0,2).map(a=><AlertCard key={a.id} alert={a} urgent/>)}{urgent.length>2&&<Link href="/follow-ups">View all {urgent.length} urgent concerns →</Link>}</section>}
     {allowed?children:<p className="empty">Choose a facility before opening its workspace.</p>}
     {!outreach&&<footer className="care-footer"><span><MapPin size={12}/>Fictional residents and locations · Demo role selection</span><span>People decide care and response.</span></footer>}
    </main>
   </div>
   {care.selected&&<ResidentDetail key={`${care.selected}:${care.profileTab}`} id={care.selected}/>}
   {care.ackId&&<AcknowledgeDialog key={care.ackId} id={care.ackId}/>}
 </div>;
}
export default function HeartbeatShell({children}){
 const {session}=useDemoSession();
 const account=useMemo(()=>session?{role:session.role,name:session.name,user_id:`demo-${session.role}`,can_edit_reminders:session.role==='nurse'}:null,[session]);
 if(!account)return null;
 return <Suspense fallback={<p className="empty">Opening Heartbeat…</p>}><CareProvider key={account.role} account={account}><Shell>{children}</Shell></CareProvider></Suspense>;
}
