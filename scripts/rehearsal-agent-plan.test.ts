import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesRehearsalSettings } from "./rehearsal-agent-plan";

test("matching callback and published status cannot hide an old agent prompt", () => {
  const desired = { general_prompt: "Give an urgent next action", general_tools: [{ type: "end_call", name: "end_call", description: "After next-step confirmation" }] };
  assert.equal(matchesRehearsalSettings({ ...desired, general_prompt: "The team will review it" }, desired), false);
  assert.equal(matchesRehearsalSettings({ ...desired, general_tools: [{ type: "end_call", name: "end_call", description: "End immediately" }] }, desired), false);
});

test("provider defaults and key ordering do not force unnecessary agent versions", () => {
  const desired = { model: "gpt-4.1-mini", general_tools: [{ type: "end_call", name: "end_call" }], begin_message: null };
  assert.equal(matchesRehearsalSettings({ general_tools: [{ name: "end_call", type: "end_call", provider_default: true }], model: "gpt-4.1-mini", version: 4 }, desired), true);
  assert.equal(matchesRehearsalSettings({ ...desired, general_tools: [...desired.general_tools, { type: "transfer_call", name: "transfer" }] }, desired), false);
});
