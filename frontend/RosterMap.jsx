'use client';
import {OperationsMap} from '../components/operations/OperationsMap';
import {useCare} from './care-context';
export default function RosterMap(){
 const care=useCare();
 const checks=care.clients.map(c=>({...c.latest_check,id:c.latest_check?.id||c.id,client_id:c.id,status:c.latest_check?.status||'queued',client:c}));
 return <div className="care-overview-map"><OperationsMap checks={checks} selectedId={care.selected} eventId={null} mode="daily" mapUrl={process.env.NEXT_PUBLIC_HEARTBEAT_MAP_URL} onSelect={care.setSelected}/></div>;
}
