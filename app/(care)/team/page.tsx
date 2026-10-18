import { DemoGate } from '@/frontend/demo-session';
import { Team } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="administrator"><Team/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
