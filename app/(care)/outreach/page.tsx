import OutreachWorkspace from '@/frontend/OutreachWorkspace';
export default function Page() {return <OutreachWorkspace mode="daily" mapUrl={process.env.NEXT_PUBLIC_HEARTBEAT_MAP_URL}/>;}
export const instant = false;
