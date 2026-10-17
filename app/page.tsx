// Dashboard. Owner: Frontend.
import { Dashboard } from "@/components/Dashboard";

export default function Page() {
  return <Dashboard agencyName={process.env.AGENCY_NAME ?? "Sunrise Home Care"} />;
}
