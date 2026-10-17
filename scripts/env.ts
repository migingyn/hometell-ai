// Loads .env.local for scripts run with tsx. Owner: Pitch.
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
