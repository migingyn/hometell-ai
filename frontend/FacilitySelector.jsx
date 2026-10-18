'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowRight,Building2,MapPin} from 'lucide-react';
import {useCare} from './care-context';
export default function FacilitySelector({mapUrl}){
 const care=useCare();const router=useRouter();const frame=useRef(null);
 const [selected,setSelected]=useState(null);const [ready,setReady]=useState(false);const [origin,setOrigin]=useState('');
 useEffect(()=>{const timer=setTimeout(()=>setOrigin(window.location.origin),0);return()=>clearTimeout(timer);},[]);
 const source=useMemo(()=>{if(!mapUrl||!origin)return null;try{const url=new URL(mapUrl,origin);url.pathname='/facilities';url.search='';url.searchParams.set('embed','1');url.searchParams.set('parentOrigin',origin);return url;}catch{return null;}},[mapUrl,origin]);
 const [slow,setSlow]=useState(false);
 useEffect(()=>{if(!source||ready)return;const timer=setTimeout(()=>setSlow(true),12000);return()=>clearTimeout(timer);},[source,ready]);
 useEffect(()=>{
  if(!source)return;
  function message(event){if(event.origin!==source.origin||event.source!==frame.current?.contentWindow)return;
   if(event.data?.type==='heartbeat:facility-ready'){setReady(true);setSlow(false);}
   if(event.data?.type==='heartbeat:facility-select'&&care.facilities.some(f=>f.id===event.data.facilityId))setSelected(event.data.facilityId);
  }
  window.addEventListener('message',message);return()=>window.removeEventListener('message',message);
 },[source,care.facilities]);
 useEffect(()=>{if(source&&ready)frame.current?.contentWindow?.postMessage({type:'heartbeat:facilities',facilities:care.facilities,selectedId:selected},source.origin);},[source,ready,care.facilities,selected]);
 const facility=care.facilities.find(f=>f.id===selected);
 return <section className="facility-experience" aria-label="Los Angeles satellite facility selector">
  <div className="facility-intro"><div><span className="eyebrow">ONE NETWORK. EVERY PERSON.</span><h1>Care starts with a place.</h1><p>Choose your Los Angeles facility to open its residents, daily care, and coordinated outreach.</p></div><span>{care.facilities.length} FACILITIES / LOS ANGELES</span></div>
  <div className="facility-stage">
   {source&&<iframe ref={frame} src={source.href} title="Interactive LA satellite facility selector" allow="fullscreen"/>}
   <div className="facility-roster" aria-label="Choose a facility">{care.facilities.map(f=><button className="facility-choice" aria-pressed={selected===f.id} key={f.id} onClick={()=>setSelected(f.id)}><span className="eyebrow"><MapPin size={10}/> {f.city.toUpperCase()}</span><strong>{f.name}</strong><span className="facility-choice-meta"><span>{f.residents} residents</span><span>{f.staff} care staff</span></span></button>)}</div>
   {!facility&&<div className="facility-help">Select a satellite-map pin or a facility card. Your workspace stays scoped to that facility.</div>}
   {facility&&<div className="facility-open-card"><span className="eyebrow">SELECTED FACILITY</span><Building2 size={20} color="#087e76"/><h2>{facility.name}</h2><p>{facility.city} · {facility.residents} fictional residents<br/>{facility.staff} assigned care staff</p><button className="dark" onClick={()=>{care.setFacilityId(facility.id);router.push('/overview');}}>Open facility dashboard <ArrowRight size={14}/></button></div>}
   {(!source||slow)&&<div className="facility-map-error" role="status">{!source?'Satellite renderer is not configured.':'The satellite renderer is taking longer to connect.'} Facility selection remains available above.{source&&<button onClick={()=>{setReady(false);setSlow(false);frame.current.src=source.href;}}>Reconnect map</button>}</div>}
  </div>
 </section>;
}
