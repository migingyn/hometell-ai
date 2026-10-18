import {useEffect,useState} from 'react';
import LiveMapScene from '../heartbeat/LiveMapScene';
import {allowedParentOrigin} from '../heartbeat/embedding';
import type {MapPerson} from '../heartbeat/feed';
import '../heartbeat/heartbeat-map.css';

type Facility={id:string;name:string;latitude:number;longitude:number};
const params=new URLSearchParams(window.location.search);
const parentOrigin=allowedParentOrigin(params.get('parentOrigin'),import.meta.env.VITE_HEARTBEAT_URL,import.meta.env.DEV);
export default function FacilityMap(){
 const [facilities,setFacilities]=useState<Facility[]>([]);const [selected,setSelected]=useState<string|null>(null);
 useEffect(()=>{
  if(!parentOrigin)return;
  const receive=(event:MessageEvent)=>{
   if(event.origin!==parentOrigin||event.source!==window.parent||event.data?.type!=='heartbeat:facilities')return;
   const list=event.data.facilities;
   if(!Array.isArray(list)||list.length>100)return;
   if(!list.every((f:Facility)=>typeof f.id==='string'&&f.id.length<100&&typeof f.name==='string'&&f.name.length<200&&Number.isFinite(f.latitude)&&Math.abs(f.latitude)<=90&&Number.isFinite(f.longitude)&&Math.abs(f.longitude)<=180))return;
   setFacilities(list);setSelected(list.some(f=>f.id===event.data.selectedId)?event.data.selectedId:null);
  };
  window.addEventListener('message',receive);window.parent.postMessage({type:'heartbeat:facility-ready'},parentOrigin);
  return()=>window.removeEventListener('message',receive);
 },[]);
 const people:MapPerson[]=facilities.map(f=>({client:{id:f.id,name:f.name,risk_tier:'green',lives_alone:false,uses_powered_equipment:false,emergency_contact_name:'',lat:f.latitude,lng:f.longitude},check:null}));
 function select(id:string|null){setSelected(id);if(id&&parentOrigin)window.parent.postMessage({type:'heartbeat:facility-select',facilityId:id},parentOrigin);}
 return <main className="hm-app hm-embedded hm-facility-map"><section className="hm-map-stage"><LiveMapScene people={people} selectedId={selected} onSelect={select} mode="daily" reducedMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches} facilityMode/>
 <div className="hm-embed-feed"><i className="hm-connected"/>LOS ANGELES CARE NETWORK<span>FICTIONAL FACILITY LOCATIONS</span></div></section></main>;
}
