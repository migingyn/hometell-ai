// Closes the active crisis run.
import { fail, handle, json } from "@/lib/api";
import { endCrisisRun } from "@/lib/crisis";

export async function POST() {
  return handle(async () => {
    const run = await endCrisisRun();
    return run ? json({ run }) : fail("No active crisis run", 404);
  });
}
