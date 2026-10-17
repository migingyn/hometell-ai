import { randomUUID } from "node:crypto";
import { researchWeb } from "./research";
import type { AgentResult, DelegationResult, ResearchResult, Source } from "./types";

const MAX_DURATION_MS = 18_000;
const ROLES = [
  {
    name: "Primary source check",
    focus: "Find official or first-party sources that directly answer the question. Identify what those sources actually establish and what remains unknown.",
  },
  {
    name: "Latest status",
    focus: "Check the most recent available information, dates, updates, and whether older information has been superseded. State explicitly when present-day status cannot be confirmed.",
  },
  {
    name: "Conflicting evidence",
    focus: "Independently look for contradictions, exceptions, or evidence against the apparent answer. Report disagreements and gaps instead of forcing a consensus.",
  },
  {
    name: "Practical logistics",
    focus: "Check practical details relevant to the question, such as current hours, location, eligibility, contact information, or next steps. Do not invent missing details or perform an action.",
  },
  {
    name: "Alternative options",
    focus: "Look for relevant alternatives and their source-supported differences. State constraints and unknowns. Do not make bookings, send messages, or contact anyone.",
  },
] as const;

type Input = { task: string; agentCount?: number; signal?: AbortSignal };
type Dependencies = { research?: typeof researchWeb; timeoutMs?: number };

function unavailable(reason: string): ResearchResult {
  return {
    status: "unavailable",
    answer: "No verified research result was returned.",
    sources: [],
    retrievedAt: new Date().toISOString(),
    limitations: [reason],
  };
}

function sourceKey(source: Source): string | null {
  try {
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

function validSources(sources: Source[]): Source[] {
  const found = new Map<string, Source>();
  for (const source of sources) {
    const key = sourceKey(source);
    if (key && !found.has(key)) found.set(key, source);
  }
  return [...found.values()];
}

function normalizeResult(result: ResearchResult): ResearchResult {
  const sources = validSources(result.sources);
  if (result.status === "grounded" && !sources.length) {
    return {
      ...result,
      status: "unverified",
      sources,
      limitations: [...result.limitations, "No usable source URL was returned; these findings are unverified."],
    };
  }
  return { ...result, sources };
}

/**
 * Run exactly 3–5 independent research calls within one shared deadline.
 * Workers can research only: they cannot recursively delegate or perform actions.
 * The result preserves each worker's evidence and unknowns; it does not invent a consensus.
 */
export async function delegateResearch(input: Input, deps: Dependencies = {}): Promise<DelegationResult> {
  const agentCount = input.agentCount ?? 3;
  if (!Number.isInteger(agentCount) || agentCount < 3 || agentCount > 5) {
    throw new Error("agentCount must be an integer from 3 to 5.");
  }
  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (!task || task.length > 1_200) throw new Error("A research task of 1–1200 characters is required.");

  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const research = deps.research ?? researchWeb;
  const requestedTimeout = deps.timeoutMs ?? MAX_DURATION_MS;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(MAX_DURATION_MS, requestedTimeout))
    : MAX_DURATION_MS;
  const controller = new AbortController();
  let cancellation: "caller" | "deadline" = "caller";
  const abortFromCaller = () => controller.abort();
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (input.signal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    cancellation = "deadline";
    controller.abort();
  }, timeoutMs);

  const agents: AgentResult[] = [];
  try {
    await Promise.all(ROLES.slice(0, agentCount).map(async (role, index) => {
      const id = `${runId}:${index + 1}`;
      let onAbort: (() => void) | undefined;
      const cancelled = () => unavailable(cancellation === "deadline"
        ? "The shared research deadline was reached. No completed result was confirmed for this worker."
        : "Research was cancelled. No completed result was confirmed for this worker.");
      let result: ResearchResult;
      if (controller.signal.aborted) {
        result = cancelled();
      } else {
        const aborted = new Promise<ResearchResult>((resolve) => {
          onAbort = () => resolve(cancelled());
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        // Promise.resolve handles synchronous callback failures as well as rejected requests.
        // The catch stays attached after the race, so a late rejection cannot leak or surface secrets.
        const work = Promise.resolve().then(() => {
          if (controller.signal.aborted) return cancelled();
          return research({ query: task, focus: role.focus, signal: controller.signal });
        }).then(normalizeResult).catch(() => controller.signal.aborted
          ? cancelled()
          : unavailable("The research worker failed. No result was confirmed."));
        try {
          result = await Promise.race([work, aborted]);
        } finally {
          if (onAbort) controller.signal.removeEventListener("abort", onAbort);
        }
      }
      agents[index] = { id, role: role.name, result };
    }));
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }

  const grounded = agents.filter((agent) => agent.result.status === "grounded" && agent.result.sources.length);
  const sources = validSources(grounded.flatMap((agent) => agent.result.sources));
  const status = grounded.length === agentCount ? "completed" : grounded.length ? "partial" : "unavailable";
  const summary = grounded.length
    ? [
      `${grounded.length} of ${agentCount} research agents returned source-supported findings.`,
      "Findings may disagree; preserve each agent's caveats. Shared source URLs are not independent corroboration.",
      ...grounded.map((agent) => `${agent.role}: ${agent.result.answer.slice(0, 650)}${agent.result.answer.length > 650 ? "…" : ""}`),
      ...(grounded.length < agentCount ? ["Some agents returned no verified findings. Their failures and unknowns are included in the individual results."] : []),
    ].join("\n")
    : `None of the ${agentCount} research agents returned verified findings. Do not present an answer as confirmed; inspect their limitations or try again.`;
  return { runId, status, agents, sources, summary, startedAt, completedAt: new Date().toISOString() };
}
