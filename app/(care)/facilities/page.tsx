import {DemoGate} from '@/frontend/demo-session';
import FacilitySelector from '@/frontend/FacilitySelector';
export default function Page(){return <DemoGate role="administrator"><FacilitySelector mapUrl={process.env.NEXT_PUBLIC_HEARTBEAT_MAP_URL}/></DemoGate>;}
export const instant=false;
