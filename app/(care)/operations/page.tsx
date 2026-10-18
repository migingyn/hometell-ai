import { DemoGate } from '@/frontend/demo-session';
import { Operations } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="administrator"><Operations/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
