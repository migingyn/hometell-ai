import { DemoGate } from '@/frontend/demo-session';
import { Settings } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="administrator"><Settings/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
