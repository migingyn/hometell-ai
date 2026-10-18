import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNurseTransferTool, getNurseHandoffReadiness } from "./retell-handoff";
import { heartbeatAgentPlan, HEARTBEAT_PROMPTS } from "../scripts/configure-heartbeat-agents";

const nursePhone = "+12025550173";

test("handoff configuration never exposes the nurse number or claims a live connection", () => {
  const ready = getNurseHandoffReadiness({ nursePhone });
  assert.equal(ready.configured, true);
  assert.equal(ready.liveVerified, false);
  assert.equal(ready.phoneOnly, true);
  assert.ok(!JSON.stringify(ready).includes(nursePhone));
});

test("missing, emergency shorthand, malformed and self-loop destinations cannot create transfer tools", () => {
  for (const number of [undefined, "", "911", "112", "5551234", "+1;911", "{{caller_number}}", "sip:911@example.com"]) {
    assert.equal(getNurseHandoffReadiness({ nursePhone: number }).configured, false);
    assert.throws(() => buildNurseTransferTool({ nursePhone: number }), /ON_CALL_NURSE_PHONE/);
  }
  assert.throws(() => buildNurseTransferTool({ nursePhone, fromNumber: nursePhone }), /distinct/);
});

test("warm transfer holds for a human, privately briefs then introduces, and never guesses a number", () => {
  const tool = buildNurseTransferTool({ nursePhone });
  assert.deepEqual(tool.transfer_destination, { type: "predefined", number: nursePhone });
  assert.equal(tool.type, "transfer_call");
  assert.equal(tool.transfer_option.type, "warm_transfer");
  if (tool.transfer_option.type !== "warm_transfer") assert.fail("A cold transfer could drop the caller without a nurse.");
  assert.equal(tool.transfer_option.opt_out_human_detection, false);
  assert.equal(tool.transfer_option.show_transferee_as_caller, false);
  assert.ok(tool.transfer_option.agent_detection_timeout_ms! > 0);
  assert.ok(tool.transfer_option.transfer_ring_duration_ms! > 0);
  assert.equal(tool.transfer_option.private_handoff_option?.type, "prompt");
  assert.equal(tool.transfer_option.public_handoff_option?.type, "static_message");
  assert.match(tool.execution_message_description ?? "", /try to connect/);
  assert.doesNotMatch(tool.execution_message_description ?? "", /will call you|coming|sent/);
});

test("both modes use only explicit built-in tools, with disabled fallback and transfer outcome subscriptions", () => {
  for (const mode of ["daily", "crisis"] as const) {
    const plan = heartbeatAgentPlan(mode, "en", "https://heartbeat.example.com", nursePhone);
    assert.deepEqual(plan.llm.general_tools.map((tool) => tool.type), ["end_call", "transfer_call"]);
    for (const event of ["transfer_started", "transfer_bridged", "transfer_cancelled", "transfer_ended"] as const) {
      assert.ok(plan.agent.webhook_events.includes(event));
    }
    const disabled = heartbeatAgentPlan(mode, "en", "https://heartbeat.example.com", "");
    assert.deepEqual(disabled.llm.general_tools.map((tool) => tool.type), ["end_call"]);
    assert.match(disabled.llm.general_prompt, /couldn't connect/);
    assert.match(disabled.llm.general_prompt, /Do not end_call while transfer is pending/);
    assert.doesNotMatch(disabled.llm.general_prompt, /will call you right away|will call you back/);
  }
});

test("daily evidence stays separate from crisis and unanswered post-op fields cannot imply okay", () => {
  const daily = heartbeatAgentPlan("daily", "en", "https://heartbeat.example.com", "");
  const crisis = heartbeatAgentPlan("crisis", "en", "https://heartbeat.example.com", "");
  for (const topic of ["pain", "incision", "fever", "breathing", "appetite", "weight", "medications", "falls"]) {
    assert.ok(daily.agent.post_call_analysis_data.some((field) => field.name === `postop_${topic}_quote`));
    assert.ok(!crisis.agent.post_call_analysis_data.some((field) => field.name === `postop_${topic}_quote`));
  }
  assert.ok(daily.agent.max_call_duration_ms >= 300_000);
  assert.match(daily.llm.general_prompt, /explicit confirmation/);
  assert.match(daily.llm.general_prompt, /DEMO QUESTIONNAIRE/);
  assert.match(daily.llm.general_prompt, /Never diagnose/);
  assert.match(HEARTBEAT_PROMPTS.ko.daily, /수술 후/);
  assert.match(crisis.llm.general_prompt, /WORD FOR WORD/);
});
