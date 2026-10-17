export type Source = {
  title: string;
  url: string;
  publishedAt?: string;
  retrievedAt: string;
};

export type ResearchResult = {
  status: "grounded" | "unverified" | "unavailable";
  answer: string;
  sources: Source[];
  retrievedAt: string;
  limitations: string[];
};

export type AgentResult = { id: string; role: string; result: ResearchResult };
export type DelegationResult = {
  runId: string;
  status: "completed" | "partial" | "unavailable";
  agents: AgentResult[];
  sources: Source[];
  summary: string;
  startedAt: string;
  completedAt: string;
};

export type VoiceCallContext = {
  callId: string;
  delegationDepth: number;
};
