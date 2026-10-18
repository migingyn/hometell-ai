'use client';

import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {request,subscribe,setCareFacility} from './api';
import {enableSound,updateAlerts,stopSound} from './sound';

const CareContext=createContext(null);
const empty={config:null,clients:[],alerts:[],calls:[],facilities:[],staff:[],tasks:[],checks:[]};
export function CareProvider({children,account}) {
  const router=useRouter();const pathname=usePathname();const params=useSearchParams();
  const [data,setData]=useState(empty);
  const [facilityId,updateFacility]=useState(()=>{if(account.role==='nurse')return 'hollywood';try{return sessionStorage.getItem('heartbeat-demo-facility')||null;}catch{return null;}});
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);const [online,setOnline]=useState(false);
  const [ackId,setAckId]=useState(null);const [soundEnabled,setSoundEnabled]=useState(false);
  const [notificationPermission,setNotificationPermission]=useState(null);
  const refreshRef=useRef(null);const notified=useRef(new Set());
  const selected=params.get('profile');
  const setSelected=useCallback((id,tab='summary')=>{
    const query=new URLSearchParams(params.toString());
    if(id){query.set('profile',id);query.set('profileTab',tab);}else{query.delete('profile');query.delete('profileTab');}
    router.push(`${pathname}${query.size?'?'+query.toString():''}`,{scroll:false});
  },[params,pathname,router]);
  function setFacilityId(id) {
    updateFacility(id);setData(empty);setLoading(true);setCareFacility(id);
    try{if(id)sessionStorage.setItem('heartbeat-demo-facility',id);else sessionStorage.removeItem('heartbeat-demo-facility');}catch{/* Tab state remains usable. */}
  }
  useEffect(()=>{
    setCareFacility(facilityId);let disposed=false;let refreshing=false;let queued=false;
    async function refresh(){
      if(disposed)return;if(refreshing){queued=true;return;}refreshing=true;
      try{const next=await request('/api/workspace');if(!disposed){setData(next);setError('');setNotificationPermission('Notification'in window?Notification.permission:'unsupported');}}
      catch(error){if(!disposed)setError(error.message);}
      finally{refreshing=false;if(!disposed)setLoading(false);if(queued&&!disposed){queued=false;await refresh();}}
    }
    refreshRef.current=refresh;void refresh();
    const remove=subscribe(refresh,value=>{if(!disposed)setOnline(value);});
    const timer=setInterval(refresh,5000);
    return()=>{disposed=true;clearInterval(timer);remove();refreshRef.current=null;};
  },[account,facilityId]);
  useEffect(()=>{
    const urgent=data.alerts.filter(a=>a.urgency==='now');updateAlerts(urgent);
    for(const alert of urgent){if(notified.current.has(alert.id))continue;notified.current.add(alert.id);
      if('Notification'in window&&Notification.permission==='granted')try{new Notification(`Heartbeat · Room ${alert.room}`,{body:`${alert.name}: ${alert.reason}`,tag:alert.id});}catch{/* In-app alerts remain available. */}
    }
  },[data.alerts]);
  useEffect(()=>()=>stopSound(),[]);
  const refresh=useCallback(()=>refreshRef.current?.(),[]);
  async function perform(path,body,message){const result=await request(path,body);if(message)setNotice(message);await refresh();return result;}
  async function callResident(id){return perform(`/api/clients/${id}/call`,{},'Call requested. Awaiting recorded results.');}
  async function enableAudio(){await enableSound();setSoundEnabled(true);}
  async function enableNotifications(){const permission=await Notification.requestPermission();setNotificationPermission(permission);}
  return <CareContext.Provider value={{...data,account,facilityId,activeFacility:data.facilities.find(f=>f.id===facilityId)||null,setFacilityId,
    error,setError,notice,setNotice,loading,online,selected,profileTab:params.get('profileTab')||'summary',setSelected,ackId,setAckId,refresh,perform,callResident,
    soundEnabled,enableAudio,notificationPermission,enableNotifications,useMock:data.config?.mockMode??true}}>{children}</CareContext.Provider>;
}
export function useCare(){const value=useContext(CareContext);if(!value)throw new Error('CareProvider is required.');return value;}
