'use client';
import { useCare } from './care-context';
import { Dashboard } from '../components/Dashboard';
export default function OutreachWorkspace({mode, mapUrl}) {
  const care=useCare();
  if(care.loading)return <p>Loading facility and outreach records…</p>;
  return <Dashboard key={`${mode}:${care.facilityId||'all'}`} initialMode={mode} facilityId={care.facilityId}
    agencyName={care.activeFacility?.name||care.config?.agency_name||'Sunrise Home Care'} mockMode={care.config?.mockMode??true} fictionalData={care.config?.fictionalData??true} onSelectResident={id=>care.setSelected(id,'calls')} liveMapUrl={mapUrl}/>;
}
