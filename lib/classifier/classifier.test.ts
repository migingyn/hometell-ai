import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { config } from "@/lib/config";
import type { RetellCall } from "@/lib/types";
import { checkHardRules, DANGER_WORDS } from "./hardRules";
import { classifyCall } from "./index";
import { llmClassifier } from "./llm";
import { classifyRetellAnalysis } from "./retell";

const original = { mockRetell: config.mockRetell, classifier: config.classifier };
beforeEach(() => { config.mockRetell = false; config.classifier = "retell"; });
afterEach(() => Object.assign(config, original));
function call(data: Record<string, unknown> = {}, extra: Partial<RetellCall> = {}): RetellCall {
  return { call_id: "call_current", call_status: "ended", transcript: "Agent: Do you need help?\nUser: I am okay.",
    call_analysis: { call_summary: "Caller reports being okay.", custom_analysis_data: data }, ...extra };
}

test("hard rules scan only user speech and handle boundaries, case, and curly apostrophes", () => {
  for (const word of DANGER_WORDS) {
    const result = checkHardRules(`Agent: Do you need anything?\nUser: ${word.toUpperCase().replace(/'/g, "’")}!`);
    assert.equal(result?.status, "needs_human");
    assert.equal(result?.urgency, "urgent");
    assert.equal(result?.flag_reason, `said "${word}"`);
  }
  assert.equal(checkHardRules("Agent: Are you dizzy, confused, trapped, or having chest pain?\nUser: I am okay."), null);
  assert.equal(checkHardRules("I fell and can't breathe"), null);
  assert.equal(checkHardRules("User: That was helpful. Waterfall photos, fellow travelers, and emergencyish words."), null);
  assert.equal(checkHardRules(undefined), null);
});

test("structured user turns take precedence over the formatted transcript", () => {
  assert.equal(checkHardRules(call({}, { transcript: "User: help", transcript_object: [{ role: "agent", content: "Are you dizzy or confused?" }, { role: "user", content: "I am okay." }] })), null);
  assert.equal(checkHardRules(call({}, { transcript_object: [{ role: "agent", content: "Goodbye" }, { role: "user", content: "I can’t breathe." }] }))?.flag_reason, 'said "can\'t breathe"');
  assert.equal(checkHardRules(call({}, { transcript: "User: help", transcript_object: [] })), null);
});

test("daily help requests are follow-ups while shared danger words remain urgent", () => {
  for (const phrase of ["help with groceries", "can't get out", "can't leave", "trapped"]) {
    assert.equal(checkHardRules(`User: ${phrase}`, "daily"), null);
    assert.equal(checkHardRules(`User: ${phrase}`, "crisis")?.urgency, "urgent");
  }
  for (const phrase of ["chest pain", "can't breathe", "fell", "fall", "dizzy", "confused", "emergency"]) {
    assert.equal(checkHardRules(`User: ${phrase}`, "daily")?.urgency, "urgent");
  }
});

test("Korean shared danger phrases are urgent in both modes and preserve the actual phrase", () => {
  const samples = [
    ["흉통이 있어요.", "흉통"], ["지금 가슴이 아파요.", "가슴이 아파"],
    ["숨을 못 쉬겠어요.", "숨을 못 쉬"], ["숨을 못쉬겠어요.", "숨을 못쉬"],
    ["방금 넘어졌어요.", "넘어졌"], ["너무 어지러워요.", "어지러"],
    ["혼란스러워요.", "혼란"], ["응급 상황이에요.", "응급"],
  ];
  for (const mode of ["daily", "crisis"] as const) {
    for (const [utterance, phrase] of samples) {
      const result = checkHardRules(`User: ${utterance}`, mode);
      assert.equal(result?.status, "needs_human");
      assert.equal(result?.urgency, "urgent");
      assert.equal(result?.flag_reason, `said "${phrase}"`);
    }
  }
});

test("Korean hard rules ignore agent speech, untagged text, and agent-only structured turns", () => {
  const agentWords = "흉통, 가슴이 아파, 숨을 못 쉬, 넘어졌, 어지러, 혼란, 응급, 도움이 필요";
  assert.equal(checkHardRules(`Agent: ${agentWords}\nUser: 괜찮아요.`), null);
  assert.equal(checkHardRules("숨을 못 쉬겠어요."), null);
  assert.equal(checkHardRules(call({}, {
    transcript: "User: 숨을 못 쉬겠어요.",
    transcript_object: [{ role: "agent", content: agentWords }, { role: "user", content: "괜찮아요." }],
  })), null);
});

test("Korean routine daily help stays an ordinary follow-up while crisis help escalates", () => {
  for (const phrase of ["도와주", "도움이 필요", "나갈 수 없", "갇혔"]) {
    assert.equal(checkHardRules(`User: ${phrase}`, "daily"), null);
    assert.equal(checkHardRules(`User: ${phrase}`, "crisis")?.flag_reason, `said "${phrase}"`);
  }
  const routine = classifyRetellAnalysis(call({ client_status: "needs_help", request: "이번 주 장보는 것을 도와주세요." }, {
    transcript_object: [{ role: "agent", content: "오늘 필요한 것이 있나요?" }, { role: "user", content: "이번 주 장보는 것을 도와주세요." }],
  }), { mode: "daily" });
  assert.equal(routine.status, "needs_human");
  assert.equal(routine.urgency, "follow_up");
  assert.equal(routine.flag_reason, "이번 주 장보는 것을 도와주세요.");
});

test("a Korean user danger phrase cannot be downgraded by positive post-call fields", async () => {
  const result = await classifyCall(call({ client_status: "ok" }, {
    transcript_object: [{ role: "agent", content: "안녕하세요." }, { role: "user", content: "지금 숨을 못 쉬겠어요." }],
  }), { mode: "daily" });
  assert.equal(result.status, "needs_human");
  assert.equal(result.urgency, "urgent");
  assert.equal(result.flag_reason, 'said "숨을 못 쉬"');
});

test("hard rules precede voicemail, analysis, mock outcomes, and both classifier selectors", async () => {
  const danger = call({ client_status: "ok", contact_confirms_ok: true }, {
    transcript: "User: I feel dizzy.", disconnection_reason: "voicemail_reached",
    metadata: { check_id: "check", target: "client", mock_outcome: "ok" },
  });
  assert.equal(classifyRetellAnalysis(danger).urgency, "urgent");
  config.mockRetell = true;
  for (const classifier of ["retell", "llm"] as const) {
    config.classifier = classifier;
    const output = await classifyCall(danger, { mode: "daily" });
    assert.equal(output.status, "needs_human");
    assert.equal(output.flag_reason, 'said "dizzy"');
  }
});

test("voicemail, no answer, busy, failed dial, and failed call statuses stay unanswered", () => {
  for (const reason of ["voicemail_reached", "dial_no_answer", "dial_busy", "dial_failed"]) {
    assert.equal(classifyRetellAnalysis(call({ client_status: "ok" }, { disconnection_reason: reason })).status, "no_answer");
  }
  assert.equal(classifyRetellAnalysis(call({ client_status: "ok" }, { call_analysis: { in_voicemail: true } })).status, "no_answer");
  for (const status of ["not_connected", "error"]) assert.equal(classifyRetellAnalysis(call({ client_status: "ok" }, { call_status: status })).status, "no_answer");
});

test("client post-call fields map explicitly without inferring wellbeing from connection", () => {
  assert.equal(classifyRetellAnalysis(call({ client_status: "ok" })).status, "ok");
  for (const mode of ["daily", "crisis"] as const) {
    const request = classifyRetellAnalysis(call({ client_status: "needs_help", request: "  a pharmacy ride Thursday  " }), { mode });
    assert.equal(request.status, "needs_human");
    assert.equal(request.flag_reason, "a pharmacy ride Thursday");
    assert.equal(request.urgency, mode === "daily" ? "follow_up" : "urgent");
    for (const value of [undefined, "unclear", "unknown"]) {
      const unclear = classifyRetellAnalysis(call({ client_status: value }), { mode });
      assert.equal(unclear.status, "needs_human");
      assert.equal(unclear.flag_reason, "unclear call, needs review");
    }
  }
  assert.equal(classifyRetellAnalysis(call({ client_status: "needs_help" })).flag_reason, "needs help leaving");
  assert.equal(classifyRetellAnalysis(call({})).summary, "Caller reports being okay.");
});

test("emergency contacts require strict confirmation and preserve the named attribution", () => {
  for (const value of [false, undefined, "true"]) {
    assert.equal(classifyRetellAnalysis(call({ client_status: "ok", contact_confirms_ok: value }), {
      mode: "daily", target: "emergency_contact", contactName: "Elaine",
    }).status, "no_answer");
  }
  const confirmed = classifyRetellAnalysis(call({ contact_confirms_ok: true }), { mode: "crisis", target: "emergency_contact", contactName: "Elaine" });
  assert.equal(confirmed.status, "ok");
  assert.match(confirmed.summary, /^Confirmed okay by Elaine:/);
  const metadataTarget = call({ contact_confirms_ok: false }, { metadata: { check_id: "check", target: "emergency_contact" } });
  assert.equal(classifyRetellAnalysis(metadataTarget).status, "no_answer");
});

test("mock overrides run only in explicit mock mode and preserve daily urgency", async () => {
  const forced = call({}, { metadata: { check_id: "check", target: "client", mock_outcome: "ok" } });
  assert.equal((await classifyCall(forced)).status, "needs_human");
  config.mockRetell = true;
  assert.equal((await classifyCall(forced)).status, "ok");
  forced.metadata!.mock_outcome = "needs_human";
  assert.equal((await classifyCall(forced, { mode: "daily" })).urgency, "follow_up");
});

test("optional LLM selector uses structured Retell evidence without an extra provider", async () => {
  assert.equal((await llmClassifier.classify(call({ client_status: "ok" }))).status, "ok");
  assert.equal((await llmClassifier.classify(call({}))).status, "needs_human");
});

test("Korean prompt vocabulary shares the same conservative danger handoff", () => {
  for (const content of ["가슴 통증이 있어요", "숨이 안 쉬어져요", "어지럽습니다"]) {
    assert.equal(checkHardRules({ call_id: "ko-danger", transcript_object: [{ role: "user", content }] }, "daily")?.urgency, "urgent");
  }
  assert.equal(checkHardRules({ call_id: "ko-exit", transcript_object: [{ role: "user", content: "혼자 못 나가요" }] }, "crisis")?.status, "needs_human");
});
