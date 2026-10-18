// Runs once when the Next.js server starts. Starts the open-line and never-started watchdog.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWatchdog } = await import("./lib/watchdog");
  startWatchdog();
}
