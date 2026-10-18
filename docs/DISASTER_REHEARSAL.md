# Disaster voice rehearsal

Agreed October 17, 2026, 6:30 PM Pacific. Deadline: 10 PM Pacific. Core feature freeze target: 8:30 PM; protect the remaining time for the teammate call, recording, and submission.

## Agreed outcome

The disaster demo opens a map of fictional Altadena residents. Selecting a person reveals their conversation and next human action. One consenting teammate will later receive a real AI phone call as that fictional person. Actual transcript updates and the eventual recording must attach to that same person, who remains selected when opening the coordinator dashboard.

The sample population is explicitly labeled. Sample status changes are never presented as actual calls. The existing daily/post-operative work, historical Asheville replay, and other projects are preserved.

## Smallest complete milestone

1. Complete the existing sample replay and select a resident.
2. Presenter explicitly requests one call to a fixed server-configured consenting teammate.
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

POST /api/demo/rehearsal takes sessionId, eventId, checkId, requestId, confirmed=true and X-Heartbeat-Presenter-Token. It reserves one call per sample event, verifies ownership and completed replay, and calls only HEARTBEAT_REHEARSAL_PHONE. Global mock mode stays enabled for sample residents. No automatic real retry, contact call, SMS, or dispatch occurs in rehearsal mode.

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

Open [Heartbeat locally](http://127.0.0.1:3018/). Choose **Play disaster demo**, let all six sample stages finish, and select Rosa. **Open coordinator dashboard** retains that selection; **Explore disaster map** returns to the same scenario.

The separate rehearsal agent is published and its version is pinned. The restricted callback proxy and temporary HTTPS tunnel are running. The only missing readiness variable is `HEARTBEAT_REHEARSAL_PHONE`; no real telephone call has been placed. Keep the laptop, Next app, map app, local database, callback proxy and tunnel running for the rehearsal. The temporary tunnel is not a deployed service and does not survive being stopped.

When the consenting teammate is present:

1. Set `HEARTBEAT_REHEARSAL_PHONE` in private `.env.local` to their E.164 number. Keep `MOCK_RETELL=true`; the sample roster stays simulated. Refresh readiness after the app loads the change.
2. In **Presenter setup**, enter the private key saved in `.local/rehearsal-presenter-token`, and confirm that the teammate is ready and agrees to recording. Do not show that key or the private environment file in the submission video.
3. Select Rosa and press **Call my teammate** once. The teammate can say: “I’m okay right now, but I can’t leave on my own. I need a ride.” Their actual response controls the evidence; they can also answer naturally.
4. Verify their words appear while the call runs. After it ends, verify the recording plays and the case requests human follow-up. Open the coordinator dashboard and confirm Rosa stays selected.
5. Record the phone conversation and the screen together for the submission. An uncertain provider request is never automatically retried; inspect its status before starting a new scenario. A missed or interrupted call remains unresolved for a human.

If the callback tunnel has stopped, restart `npx tsx scripts/rehearsal-callback-proxy.ts`, then `cloudflared tunnel --url http://127.0.0.1:3020 --no-autoupdate` in separate terminals. Re-run `npx tsx scripts/configure-rehearsal-agent.ts --apply --public-url=<new-HTTPS-origin>` to update the dedicated agent. Preserve the server-only credentials and existing database; do not start Docker as part of this workflow.

## Verification and limits

- Both automated suites passed (96 voice tests and 96 Heartbeat tests); the focused eight rehearsal tests passed again after the final prompt wording change.
- Six HTTP/database verification groups passed using synthetic signed callbacks and intercepted provider requests. Callback health, signature rejection and restricted-route behavior passed through the real public tunnel.
- Typecheck, lint and production build passed. Browser checks covered map selection, retained selection through dashboard handoff and return, disabled calling until the recipient is configured, truthful sample/audio labels, and a 390px viewport without horizontal overflow.
- Provider provisioning and callback connectivity are verified. Real phone connection quality, conversational latency, live provider transcript delivery and actual recording playback still require the teammate rehearsal. Weak-signal behavior demonstrates unresolved-case handling; it does not establish offline connectivity.

Evidence: `output/rehearsal/verification.json`, `provider-setup.json`, `callback-verification.json`, `build.log`, and `disaster-map.jpg`. These contain no presenter key or destination number.

Tooling note: the global Vercel CLI is 51.2.0; discovery used 64.5.0 explicitly. Upgrade before deployment with `npm i -g vercel@latest` for current compatibility. No deployment was performed here.
