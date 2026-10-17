import Retell from "retell-sdk";
import { z } from "zod";
import { boundedToolJson, dispatchVoiceTool, ToolName } from "./dispatch";

const Payload = z.object({
  name: ToolName,
  args: z.unknown().default({}),
  call: z.object({
    call_id: z.string().min(1).max(200),
    agent_id: z.string().min(1).max(200),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

export async function handleVoiceTool(req: Request, dispatch = dispatchVoiceTool): Promise<Response> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const respond = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
  const key = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!key || !agentId || process.env.MOCK_RETELL === "true") {
    return respond({ status: "unavailable", message: "Live Retell tools are not configured" }, 503);
  }
  if (Number(req.headers.get("content-length")) > 262144) return respond({ error: "Request too large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 262144) return respond({ error: "Request too large" }, 413);
  const signature = req.headers.get("x-retell-signature");
  if (!signature) return respond({ error: "Bad signature" }, 401);
  try {
    if (!(await Retell.verify(raw, key, signature))) return respond({ error: "Bad signature" }, 401);
  } catch { return respond({ error: "Bad signature" }, 401); }

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return respond({ error: "Body is not JSON" }, 400); }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return respond({ error: "Invalid Retell tool request" }, 400);
  const { call, name, args } = parsed.data;
  const allowedAgentIds = [agentId, process.env.RETELL_DELEGATE_AGENT_ID].filter(Boolean);
  if (!allowedAgentIds.includes(call.agent_id)) return respond({ error: "Unknown agent" }, 403);

  const depth = call.metadata?.delegation_depth ?? 0;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > 5) {
    return respond({ error: "Invalid delegation context" }, 403);
  }
  const dedicatedDelegate = process.env.RETELL_DELEGATE_AGENT_ID !== agentId &&
    call.agent_id === process.env.RETELL_DELEGATE_AGENT_ID;
  const context = { callId: call.call_id, delegationDepth: Math.max(depth, dedicatedDelegate ? 1 : 0) };
  try {
    const result = await dispatch(name, args, context, req.signal);
    return new Response(boundedToolJson(result), { status: 200, headers });
  } catch (error) {
    if (error instanceof z.ZodError) return respond({ status: "unavailable", message: "Tool arguments are invalid. Correct the request before retrying." }, 200);
    // Do not echo upstream response bodies, API keys, phone numbers or private
    // database details into the model's spoken context.
    return respond({ status: "unavailable", message: "The requested tool could not complete. Do not claim it succeeded; check configuration or ask a human to follow up." }, 200);
  }
}
