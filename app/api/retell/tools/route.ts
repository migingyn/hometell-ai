import { handleVoiceTool } from "@/lib/voice/handler";

export const maxDuration = 30;

export async function POST(req: Request) {
  return handleVoiceTool(req);
}
