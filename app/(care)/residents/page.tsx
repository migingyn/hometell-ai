import { DemoGate } from '@/frontend/demo-session';
import { ResidentDirectory } from '@/frontend/sections';
export default function Page() {return <DemoGate><ResidentDirectory/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
