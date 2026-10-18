import { DemoGate } from '@/frontend/demo-session';
import { ResidentRecordRoute } from '@/frontend/role-pages';
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <DemoGate><ResidentRecordRoute id={id}/></DemoGate>;}

// Demo navigation waits for the tab-local session.
export const instant = false;
