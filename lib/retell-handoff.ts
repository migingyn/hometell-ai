import type { LlmCreateParams } from "retell-sdk/resources/llm";

const E164 = /^\+[1-9]\d{7,14}$/;

export type NurseHandoffSettings = { nursePhone?: string; fromNumber?: string };

/** Configuration readiness only; no provider request and no private number in the result. */
export function getNurseHandoffReadiness(settings: NurseHandoffSettings = {
  nursePhone: process.env.ON_CALL_NURSE_PHONE,
  fromNumber: process.env.RETELL_FROM_NUMBER,
}) {
  const number = settings.nursePhone?.trim();
  const status = !number ? "missing_nurse_number"
    : !E164.test(number) ? "invalid_nurse_number"
      : number === settings.fromNumber?.trim() ? "destination_is_agent_number"
        : "configured";
  return { status, configured: status === "configured", phoneOnly: true, liveVerified: false } as const;
}

/** Fixed server-configured destination; never inferred from caller text or a browser request. */
export function buildNurseTransferTool(
  settings: NurseHandoffSettings,
  language: "en" | "ko" = "en",
): LlmCreateParams.TransferCallTool {
  if (!getNurseHandoffReadiness(settings).configured) {
    throw new Error("Set ON_CALL_NURSE_PHONE to a valid on-call nurse E.164 number distinct from RETELL_FROM_NUMBER. Do not use an emergency services number.");
  }
  return {
    type: "transfer_call",
    name: "transfer_to_nurse",
    description: "Attempt one phone-only warm transfer to the agency's configured on-call nurse when the caller asks for a person or reports a concern requiring human review. This does not dispatch a nurse, transport, or emergency services. Never invent or change the destination.",
    transfer_destination: { type: "predefined", number: settings.nursePhone!.trim() },
    speak_during_execution: true,
    execution_message_type: "static_text",
    execution_message_description: language === "ko"
      ? "담당 간호사에게 연결을 시도하겠습니다. 잠시 기다려 주세요."
      : "I'll try to connect you to the on-call nurse. Please stay on the line.",
    transfer_option: {
      type: "warm_transfer",
      transfer_ring_duration_ms: 30_000,
      agent_detection_timeout_ms: 30_000,
      opt_out_human_detection: false,
      show_transferee_as_caller: false,
      on_hold_music: "ringtone",
      enable_bridge_audio_cue: true,
      private_handoff_option: {
        type: "prompt",
        prompt: `Speak ${language === "ko" ? "Korean" : "English"}. You are privately briefing the person who answered the agency's on-call nurse line. In at most three short sentences, identify {{name}} and whether the speaker is the patient or emergency contact; say this is a {{mode}} check-in; then quote the caller's most important reported concern and any explicit pain score. Mention only answers actually given in this call, preserving negations and uncertainty. State when information is from the emergency contact. Do not diagnose, recommend treatment, claim nurse identity has been verified, or invent a change since the last call. Finish: "Please assess the caller and decide the next step."`,
      },
      public_handoff_option: {
        type: "static_message",
        message: language === "ko"
          ? "{{name}} 님에 관한 안부 확인 전화입니다. 담당자에게 연결되었습니다. 저는 이제 통화에서 나가겠습니다."
          : "This is the check-in regarding {{name}}. You're now connected with the person who answered the on-call line. I'll leave the call now.",
      },
    },
  };
}
