import { z } from "zod";
import { approvedContacts, callContact, getCallResult } from "./actions";
import { delegateResearch } from "./delegate";
import { researchWeb } from "./research";
import type { VoiceCallContext } from "./types";

export const ToolName = z.enum(["research_web", "delegate_research", "list_contacts", "call_contact", "get_call_result"]);
const publicQuestion = z.string().trim().min(3).max(1200);
const parameters = {
  research_web: z.object({ query: publicQuestion }).strict(),
  delegate_research: z.object({ task: publicQuestion, agentCount: z.number().int().min(3).max(5).default(3) }).strict(),
  list_contacts: z.object({}).strict(),
  call_contact: z.object({ contactId: z.string().min(1).max(80), purpose: z.string().trim().min(3).max(1000), callerConfirmed: z.boolean() }).strict(),
  get_call_result: z.object({ actionId: z.string().uuid() }).strict(),
};

type Dependencies = {
  research?: typeof researchWeb;
  delegate?: typeof delegateResearch;
  contacts?: typeof approvedContacts;
  call?: typeof callContact;
  result?: typeof getCallResult;
};

export async function dispatchVoiceTool(name: z.infer<typeof ToolName>, args: unknown, context: VoiceCallContext, signal?: AbortSignal, deps: Dependencies = {}) {
  switch (name) {
    case "research_web": {
      const input = parameters.research_web.parse(args);
      return (deps.research ?? researchWeb)({ ...input, signal });
    }
    case "delegate_research": {
      if (context.delegationDepth > 0) throw new Error("Delegated calls cannot spawn more agents");
      const input = parameters.delegate_research.parse(args);
      const result = await (deps.delegate ?? delegateResearch)({ ...input, signal });
      return {
        ...result,
        summary: result.summary.slice(0, 2200),
        agents: result.agents.map(({ id, role, result: item }) => ({
          id, role, status: item.status, answer: item.answer.slice(0, 700),
          sourceUrls: item.sources.slice(0, 3).map((s) => s.url), limitations: item.limitations.slice(0, 2),
        })),
        sources: result.sources.slice(0, 10),
      };
    }
    case "list_contacts": {
      parameters.list_contacts.parse(args);
      return { contacts: (deps.contacts ?? approvedContacts)().map(({ id, name, description }) => ({ id, name, description })) };
    }
    case "call_contact": {
      const input = parameters.call_contact.parse(args);
      return (deps.call ?? callContact)(input, context);
    }
    case "get_call_result": {
      const { actionId } = parameters.get_call_result.parse(args);
      return (deps.result ?? getCallResult)(actionId, context);
    }
  }
}

// Retell only sends the first 15,000 characters of a custom function result to
// its LLM. Keep JSON valid rather than allowing a cut-off object at that boundary.
export function boundedToolJson(value: unknown): string {
  const shorten = (item: unknown, limit: number, key = ""): unknown => {
    // Citation URLs must survive intact: a clipped URL is a fabricated source.
    if (typeof item === "string") return ["url", "sourceUrls"].includes(key) ? item : item.slice(0, limit);
    if (Array.isArray(item)) return item.map((entry) => shorten(entry, limit, key));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, shorten(entry, limit, name)]));
    return item;
  };
  let limit = 2600;
  while (limit >= 100) {
    const compact = shorten(value, limit) as Record<string, unknown>;
    const result = JSON.stringify({ ...compact, contentIsUntrusted: true });
    if (result.length <= 14000) return result;
    limit = Math.floor(limit / 2);
  }
  return JSON.stringify({ status: "unavailable", message: "The result exceeded the voice response limit. Ask a narrower question." });
}
