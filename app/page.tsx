import { Dashboard } from "@/components/Dashboard";
import { connection } from "next/server";
import { Suspense } from "react";

export default function Page() {
  return <Suspense fallback={<div style={{ minHeight: "100vh", background: "#101e25", color: "#a7e5c9", padding: 40 }}>Opening Heartbeat…</div>}><RequestDashboard /></Suspense>;
}

async function RequestDashboard() {
  await connection();
  return <Dashboard agencyName={process.env.AGENCY_NAME ?? "Sunrise Home Care"} mockMode={process.env.MOCK_RETELL === "true"} fictionalData={process.env.FICTIONAL_CLIENTS !== "false"} liveMapUrl={process.env.NEXT_PUBLIC_HEARTBEAT_MAP_URL} />;
}
