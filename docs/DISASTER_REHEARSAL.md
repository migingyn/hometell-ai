# Disaster voice rehearsal

Agreed October 17, 2026, 6:30 PM Pacific. Deadline: 10 PM Pacific. Core feature freeze target: 8:30 PM; protect the remaining time for the teammate call, recording, and submission.

## Agreed outcome

The disaster demo opens a map of fictional Altadena residents. Selecting a person reveals their conversation and next human action. One consenting teammate will later receive a real AI phone call as that fictional person. Actual transcript updates and the eventual recording must attach to that same person, who remains selected when opening the coordinator dashboard.

The sample population is explicitly labeled. Sample status changes are never presented as actual calls. The existing daily/post-operative work, historical Asheville replay, and other projects are preserved.

## Smallest complete milestone

1. Select a resident and prepare the teammate call in the local app; preparation completes any remaining sample steps without dialing.
2. Presenter enters one teammate number, confirms recording consent, and explicitly requests the call.
3. Retell sends signed call/transcript callbacks to a narrowly exposed callback endpoint.
4. Persist partial conversation separately from final call logs; show the caller's actual words.
5. Final analysis updates that resident's case. Recording playback appears only after provider audio exists.
6. An interrupted/uncertain call retains captured evidence and remains open for human follow-up.

Actual calls wait until Kevin and the teammate rehearse. Configuration and synthetic signed-event verification do not count as a real phone rehearsal.

## Ownership and interfaces

- Root: integration, configuration of a separate rehearsal agent, callback connectivity, Dashboard, PatientWorkspace, rehearsal controls, documentation and browser verification.
- Voice backend: lib/demo/rehearsal*, /api/demo/rehearsal, signed webhook additions, evidence endpoint, additive migration, focused tests.
- Presentation UI: DisasterExperience component and its own stylesheet. Existing OperationsMap is reused.
- Reference audit: original rubric and local Clinically Speaking patterns; read-only.

POST /api/demo/rehearsal/prepare accepts the selected sample session/event/check, a request UUID, and a test phone number from the same-origin local browser. It verifies ownership and service configuration, completes remaining fictional replay steps, and returns a 15-minute signed permit bound to that number and those IDs. It never invokes telephony. The server signing key remains private.

POST /api/demo/rehearsal takes sessionId, eventId, checkId, requestId, confirmed=true and X-Heartbeat-Rehearsal-Permit. It verifies the local origin and permit and calls only the number signed during preparation. Migration 010 removes the one-call-per-scenario quota: different residents in the same scenario can each have an explicitly requested call. Each resident retains their own saved attempt. The cross-session active/uncertain-call guard, 60-second terminal cooldown, consent, and request idempotency remain. The older X-Heartbeat-Presenter-Token path still uses HEARTBEAT_REHEARSAL_PHONE for command-line rehearsals. Global mock mode stays enabled for sample residents. No automatic real retry, contact call, SMS, or dispatch occurs in rehearsal mode.

GET /api/demo/rehearsal?checkId=UUID exposes readiness and bound call status without private numbers or credentials. Recording retrieval is bound to the saved call ID. Public callback ingress must expose only the signed webhook and a nonsensitive health response, never the dashboard or call-start endpoint.

## Rubric mapping

The [participant hub](https://docs.google.com/document/d/1a6SQQuvQJoI5g6YQUjzOVkruyOI94UwS-c1Wbrz-dsY/edit) gives five equally scored categories: dual-use fit, technical execution, feasibility/impact, adapting to twists, and demo/pitch. Dual-use breaks ties. Its communications criteria allow weak networks OR different languages.

- Daily mobility context → crisis transportation need proves dual-use.
- Real teammate conversation → transcript/recording → case update proves execution.
- Missed/interrupted contact remains unresolved with human ownership demonstrates the chosen resilience behavior. Voice and SMS still require infrastructure; no offline calling claim.
- A continuous map → person → call → coordinator story demonstrates clarity.
- Twist 1 requires a federal funding pathway. Full Twist 2 and full Twist 3 text are not established by the supplied organizer messages; do not invent them.

## Cut list and acceptance

Multilingual polish, internet research, 3–5 coordinating agents, and making every map dot a real call are deferred. A one-time reminder will revisit the last item if time remains.

Before reporting ready: typecheck/lint/build; signed callback, duplicate, stale, interrupted and failed-call tests; actual browser map/person/dashboard selection continuity; honest recording states; no roster-wide call from rehearsal; no telephone calls during automated verification.

Remaining human input: the consenting teammate's destination number and the decision to begin the rehearsal. Recipient consent and actual phone/audio quality are verified together later.

## Ready for the teammate rehearsal

Open [Heartbeat locally](http://127.0.0.1:3018/). Choose **Play disaster demo** and select Rosa. **Set up teammate call** pauses playback; **Prepare call** finishes remaining sample stages automatically. **Open coordinator dashboard** retains that selection; **Explore disaster map** returns to the same scenario.

The separate rehearsal agent is published and its version is pinned. The restricted callback proxy and temporary HTTPS tunnel are running. The teammate's destination is entered directly in the local app; neither an environment-file edit nor a presenter-key entry is required. No real telephone call has been placed during verification. Keep the laptop, Next app, map app, local database, callback proxy and tunnel running for the rehearsal. The temporary tunnel is not a deployed service and does not survive being stopped.

When the consenting teammate is present:

1. In Rosa's **Set up teammate call**, enter the consenting teammate's number. Ten-digit US numbers are accepted; international numbers need + and the country code. Press **Prepare call**. This does not dial anyone and keeps Rosa selected.
2. Check the displayed last four digits and confirm that the teammate is ready and agrees to recording. Setup expires after 15 minutes; use **Change phone number** to correct the destination. Keep `MOCK_RETELL=true`; the sample roster stays simulated.
3. Press **Call my teammate** once. The teammate can say: “I’m okay right now, but I can’t leave on my own. I need a ride.” Their actual response controls the evidence; they can also answer naturally.
4. Choose **View sentiment results** under the patient's name. The **Call analysis** tab groups reported severity, expressed distress, Retell text sentiment and recorded voice expression in the **Sentiment results** card. Their words update during the call; text sentiment and voice expression appear after analysis. The recording and transcript follow the cards. An unclear or unusable recording never means the caller is safe. Open the coordinator dashboard and confirm Rosa stays selected.
5. Record the phone conversation and the screen together for the submission. An uncertain provider request is never automatically retried; inspect its status before starting a new scenario. A missed or interrupted call remains unresolved for a human.

If the callback tunnel has stopped, restart `npx tsx scripts/rehearsal-callback-proxy.ts`, then `cloudflared tunnel --url http://127.0.0.1:3020 --no-autoupdate` in separate terminals. Re-run `npx tsx scripts/configure-rehearsal-agent.ts --apply --public-url=<new-HTTPS-origin>` to update the dedicated agent. Preserve the server-only credentials and existing database; do not start Docker as part of this workflow.

## Urgent next steps in the phone conversation

The dedicated rehearsal agent now uses published, pinned version 4. A current severe-injury report interrupts routine questions regardless of calm delivery. It gives an immediate emergency-contact step, then distinguishes an actual emergency from roleplay. For a reported actual emergency, it checks whether the caller or someone nearby can call emergency services and frees the phone if needed. For confirmed fiction, it confirms the corresponding next action and concludes the practice call without restarting the routine questionnaire. No responder is contacted by this demo.

Routine requests also end with a concrete required action, such as a coordinator arranging a ride, while explicitly stating that this practice call has not booked it. The agent cannot promise a coordinator's future action. The only tool remains `end_call`.

The live/post-call priority rules now recognize current traumatic limb-loss language as immediate attention even with positive transcript sentiment. Historical limb loss, prosthetics, denials, and hypotheticals do not establish a new injury. Prior saved call records are preserved.

`scripts/configure-rehearsal-agent.ts --apply` now compares the published prompt and tool settings, updates a matching unpublished agent/LLM version, publishes it, verifies readback, and pins that version. An unchanged callback address no longer hides prompt edits. Run `npx tsx scripts/verify-rehearsal-dialogue.ts --run` for three provider text simulations; these never dial a phone. Inspect the transcripts in `output/rehearsal/urgent-response-verification.json` as well as the automated grades. A fresh answered telephone call is still needed to check speech recognition, timing, and audio with this revision.

Emergency-contact wording follows [MedlinePlus guidance on traumatic amputation](https://medlineplus.gov/ency/article/000006.htm). This script does not provide procedural treatment or dispatch assistance.

## Recorded-voice analysis in the rehearsal

Apply the additive `202610170008_rehearsal_acoustics.sql` migration after 007. Keep the existing acoustic service running with its model loaded (`GET http://127.0.0.1:8019/health`), and keep `ACOUSTIC_SERVICE_URL` configured in the private app environment. The pinned rehearsal agent has recording storage enabled. Do not disable global mock mode: only the saved, bound teammate call is eligible for this recording path.

The call's final analysis starts background waveform processing. Heartbeat verifies the saved rehearsal, agent, call and metadata, fetches the separate-speaker recording through Retell, and sends the bytes to the local model. It stores the result separately from transcript evidence. The panel polls for progress and can recover interrupted processing or a late recording with bounded retries. This work never dials anyone or sends coordinator messages.

The visible states distinguish waiting for a completed call, waiting for a recording, processing, an experimental expression result, and insufficient/unavailable audio. A result can suggest earlier human review within the same reported-severity tier; it cannot reduce danger reported in words. The model was trained on acted speech and has not been validated for emergency triage. This is post-call analysis, not a live acoustic stream.

If audio cannot be assessed, use the saved transcript and human review. Do not repeatedly call the teammate to obtain a preferred model result. Playback and acoustic assessment are independent: a mixed-speaker recording may play even when the separate-speaker recording required for analysis is unavailable.

Verified locally: ten integration scenarios passed using signed synthetic provider events, intercepted provider downloads, the actual local model, and the actual local database. They cover duplicate jobs, late audio, silence, unavailable-model retries, mismatched recordings, expired leases, severity ordering and handled/stale cases. All fixture rows were removed. No real calls or texts were placed; actual Retell phone audio remains to be checked with the teammate. Run `npx tsx scripts/verify-rehearsal-acoustics.ts`; results are in `output/rehearsal/acoustic-verification.json`. The browser-checked panel is shown in `output/rehearsal/voice-analysis-panel.png`.

## Verification and limits

- Urgent-response revision: three provider text simulations passed against published version 4; transcripts were inspected for calm fictional injury, reported actual injury, and a routine ride request. Forty-four focused tests, typecheck and scoped lint passed. The app and call-evidence endpoint returned HTTP 200 after the incompatible route-segment export was removed by integration work. No calls were placed; actual telephone recognition/audio/timing on the new version remain to rehearse. Report: `output/rehearsal/urgent-response-verification.json`.
- Scenario quota removal: migration 010 applied to the existing local database. `scripts/verify-rehearsal-setup.ts` verifies two separate residents in one scenario with intercepted telephony, previous evidence preserved, and active-call/duplicate protection retained. The live app also returned HTTP 200 when preparing Harold in a scenario that already has a completed real call; no call was placed during verification.
- The local setup fix passed 12 focused rehearsal/permit tests and `scripts/verify-rehearsal-setup.ts`, which intercepts all telephony requests. Browser verification confirmed automatic sample completion, Rosa retained, and the call button enabled after consent. Screenshot: `output/rehearsal-setup/call-enabled.jpg` (fictional test number; no call placed).
- Both automated suites passed (96 voice tests and 96 Heartbeat tests); the focused eight rehearsal tests passed again after the final prompt wording change.
- Six HTTP/database verification groups passed using synthetic signed callbacks and intercepted provider requests. Callback health, signature rejection and restricted-route behavior passed through the real public tunnel.
- Typecheck, lint and production build passed. Browser checks covered map selection, retained selection through dashboard handoff and return, disabled calling until the recipient is configured, truthful sample/audio labels, and a 390px viewport without horizontal overflow.
- Provider provisioning and callback connectivity are verified. Real phone connection quality, conversational latency, live provider transcript delivery and actual recording playback still require the teammate rehearsal. Weak-signal behavior demonstrates unresolved-case handling; it does not establish offline connectivity.

Evidence: `output/rehearsal/verification.json`, `provider-setup.json`, `callback-verification.json`, `build.log`, and `disaster-map.jpg`. These contain no presenter key or destination number.

Tooling note: the global Vercel CLI was upgraded to 64.5.0 and verified. No deployment was performed here.

## First actual phone test and cross-session protection

Two independently prepared sessions started calls to the same destination 148 ms apart. The trace does not identify who started the second request. Both provider records contain voicemail language; the participant reported answering and hearing a brief greeting before the call ended. A sustained human conversation remains unverified.

Apply migration `202610170009_rehearsal_call_guard.sql` after 008. One shared database lock now allows only one active or unresolved rehearsal across sessions. Identical retries return their existing reservation. Confirmed termination starts a 60-second cooldown; unknown outcomes require reconciliation, never an automatic redial. The local migration is applied; two concurrent distinct sessions produced one intercepted provider request and a clear 409 for the other. Twelve focused tests, lint and typecheck passed without real calls.

The actual provider recording used the exact host `d1d33audaiiiuu.cloudfront.net`. It is now configured privately in `RETELL_RECORDING_HOSTS`; all other binding, HTTPS and size checks remain. Actual recording HTTP retrieval and browser playback passed. The previous waveform attempts failed before reading audio, so their unavailable state does not describe the participant's voice. Retry the answered conversation from one browser session only when the participant is ready.
