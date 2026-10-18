import { DemoGate } from '@/frontend/demo-session';
import { MyDay } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="nurse"><MyDay/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
