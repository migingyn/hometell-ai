import { DemoGate } from '@/frontend/demo-session';
import { FollowUpTasks } from '@/frontend/role-pages';
export default function Page() {return <DemoGate><FollowUpTasks/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
