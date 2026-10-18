import { DemoGate } from '@/frontend/demo-session';
import { OrganizationOverview } from '@/frontend/role-pages';
export default function Page() {return <DemoGate role="administrator"><OrganizationOverview/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
