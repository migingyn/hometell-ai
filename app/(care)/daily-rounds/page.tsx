import { DemoGate } from '@/frontend/demo-session';
import { DailyRounds } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="nurse"><DailyRounds/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
