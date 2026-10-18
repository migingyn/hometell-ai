import { Suspense } from 'react';
import { DemoGate } from '@/frontend/demo-session';
import { VitalsWorkflow } from '@/frontend/vitals-workflow';
export const instant = false;
export default function Page() {return <DemoGate role="nurse"><Suspense fallback={<p>Loading vitals entry…</p>}><VitalsWorkflow/></Suspense></DemoGate>;}
