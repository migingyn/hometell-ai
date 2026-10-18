import HeartbeatShell from '@/frontend/HeartbeatShell';
import { DemoGate } from '@/frontend/demo-session';
export default function Layout({children}:{children:React.ReactNode}) {
  return <DemoGate><div className="care-theme"><HeartbeatShell>{children}</HeartbeatShell></div></DemoGate>;
}

// Demo navigation waits for the tab-local session.
export const instant = false;
