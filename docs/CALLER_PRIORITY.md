# Caller priority for human review

Heartbeat can suggest which calls need an operator first, using the circumstances a caller describes and distress they explicitly report. Calm language cannot reduce a serious report; generic negative sentiment does not establish an emergency. This is an unvalidated hackathon decision-support prototype, not a medical triage or emergency-dispatch system.

## What is implemented

- Signed `transcript_updated` callbacks run a conservative caller-text rules pass during a call. Native `call_analyzed` supplies post-call sentiment and configured extraction fields.
- Suggested priority: immediate attention, urgent attention, needs review, or follow-up. Unknown and missed calls remain unknown; a routine statement never completes an in-progress check-in by itself.
- Separate situation, self-reported distress, supporting quotes, source stage, and text sentiment. The UI labels static client priority as enrollment risk.
- Calm reported entrapment with rising water ranks ahead of panic with stated shelter and supplies. High self-reported distress can prompt urgent human review without being labeled immediate danger.
- Current traumatic limb-loss language receives immediate attention during and after a call, regardless of positive sentiment. Historical loss, prosthetics, denials and hypothetical injury statements do not establish a new traumatic injury.
- Atomic persistence protects handled checks, stale calls, old snapshots, repeated callbacks, and previously raised serious concerns. Ordinary unknown-to-routine clarification remains possible.

Live recognition uses narrow English/Korean evidence rules. The post-call fields are accepted only with exact caller quotes and supported wording. Novel phrases, unsupported languages, and ambiguous circumstances can remain unknown and require human review. Evidence is a reported statement, not independent confirmation of conditions.

## Our acoustic service

Retell's standard `call_analysis.user_sentiment` is inferred from the transcript after the call ends and does not use tone or pitch. It must not be displayed as an audio measurement. Retell AI QA has a separate audio-aware sentiment evaluation, but it is not the documented live score used here.

`services/acoustic-analysis/` contains our Python audio processing and inference service. It runs a pinned pretrained Wav2Vec2 speech-emotion checkpoint locally, without a hosted inference API. Our code handles speaker attribution, quality gates, bounded inference windows, structured evidence, and priority combination. We did not train a new emotion model. See its [run instructions](../services/acoustic-analysis/README.md) and [model/data provenance](../services/acoustic-analysis/PROVENANCE.md).

The service emits an experimental expression cue when an inspected window's top class is `fearful` with a model score of at least 0.65. This is a heuristic, not a panic probability. The checkpoint was trained on acted English speech, and we have not validated it on disaster calls, telephone audio, Korean, accents, or disability-related voice differences. The app skips acoustic inference for clients with a recorded non-English language and asks for manual review. An uncertain or missing result never establishes safety or reduces a serious concern.

After an authenticated `call_analyzed` callback commits the transcript result, Next's `after()` schedules recording analysis without delaying the webhook response. The server re-fetches the call through Retell's authenticated API, downloads the separate-speaker recording into memory, and submits audio bytes plus speaker timestamps to our service. A verified webhook link can supply the short-lived recording when Retell's storage policy omits it from Get Call. Recording URLs remain private. Exact HTTPS recording hosts, disabled redirects, bounded downloads, and service authentication protect that path.

No fixed Retell left/right speaker order is assumed: transcript-timed energy comparisons must attribute opposing channels to the caller and agent, or an integrator must supply a calibrated channel. Ambiguous attribution, silence, insufficient speech, clipping, unavailable weights, and service failures return no usable emotion score. Mixed-speaker and PII-scrubbed recording URLs are not used as fallbacks.

Separate acoustic evidence stores the model revision, quality, time windows and class outputs. Elevated expression with routine circumstances requests human review; with unclear circumstances or an assistance need it requests urgent review. Sound alone cannot produce the `immediate` category. Described immediate danger stays immediate regardless of the sound. Persistence protects handled/stale checks, duplicate results and previously available evidence against failures.

**Current timing:** transcript-based priority updates during a call; our Retell recording analysis runs after the call. Retell's monitor WebSocket contains text, and its browser audio-analyser snapshots are not a continuous server-side caller stream. Truly live acoustic analysis requires a separate audio capture route, such as a provider-controlled caller-audio fork before a Retell SIP bridge. That telephony path has not been implemented or verified here.

`after()` is best-effort work within the route lifetime, not a durable queue. Inference must finish inside the 240-second route limit; a process restart can interrupt it. Replaying the signed final callback retries missing/failed acoustic analysis without creating another final call log. An available result is retained. Recordings longer than 180 seconds or 12 MiB currently return unavailable rather than silently truncating the call.

The one-teammate disaster rehearsal also supports this pipeline while the sample roster remains in global mock mode. Migration `202610170008_rehearsal_acoustics.sql` adds a private leased job with up to three attempts. The signed final callback schedules it; rehearsal status polling recovers a late recording or an interrupted worker. Its route lifetime is 240 seconds and its claim expires after four minutes. The worker verifies the rehearsal request, check, call and agent against the authenticated Retell response before accessing audio. It never sends SMS or creates calls. The UI shows waiting, processing and terminal results separately from text assessments. Recovery depends on another signed callback or the rehearsal panel being open; this is not an independent queue worker.

Official references: [Post Call Extraction](https://docs.retellai.com/features/post-call-analysis-overview), [webhooks](https://docs.retellai.com/features/webhook-overview), [AI QA metrics](https://docs.retellai.com/ai-qa/terminologies).

Audio references: [Get Call](https://docs.retellai.com/api-references/get-call), [secure recording links](https://docs.retellai.com/accounts/signed-secure-url), [custom telephony](https://docs.retellai.com/deploy/custom-telephony), [provider audio fork](https://www.twilio.com/docs/voice/twiml/stream).

## Activate against the intended Retell account

1. Apply `supabase/migrations/202610170004_caller_priority.sql`, then `202610170005_acoustic_priority.sql`, to the intended Heartbeat database. Both are additive and do not reset client/event history.
2. Configure the existing private environment: `RETELL_API_KEY`, the appropriate dedicated agent IDs, `RETELL_FROM_NUMBER`, and a public HTTPS `HEARTBEAT_PUBLIC_URL` for callbacks.
3. Run `npm run heartbeat:agents` to inspect the dedicated agent plan. Applying the reviewed draft adds `transcript_updated`, retains `call_analyzed`, and adds four evidence-based extraction fields. Publish the intended dedicated draft through the existing workflow.
4. Rehearse with an explicitly consenting teammate and the fictional scenario. A key being present does not prove delivery or priority behavior in a real call.
5. Run the Python service with `uv run python app.py --warmup` from its directory. Set `ACOUSTIC_SERVICE_URL=http://127.0.0.1:8019` in the app's private environment and use the same `ACOUSTIC_API_KEY` in both processes if enabled. Remote services require HTTPS plus that key. Keep recordings enabled for the intended agent. Add its exact recording CDN hostname to `RETELL_RECORDING_HOSTS` if it differs from the documented S3 host. Leave `RETELL_CALLER_AUDIO_CHANNEL` empty for timestamp-based attribution unless you have calibrated that channel for this integration.

This feature does not attach the separate research/contact tools to check-in agents and does not automatically call emergency services.

## Verification and local examples

- `npm run test:heartbeat`: classifier, priority, ordering, ladder, and SMS regressions.
- `npm run test:voice`: provider payload/signature and agent-configuration regressions.
- `CALLER_PRIORITY_APP_URL=http://127.0.0.1:3018 npx tsx scripts/verify-caller-priority.ts`: real local HTTP plus PostgreSQL persistence with fictional call payloads. Requires this project's local database at port 55321 and explicit mock mode. It cleans up only its own generated records.
- Append `--keep` to retain clearly fictional comparison cards for browser review. That run creates no real phone calls and leaves the examples on the local dashboard.
- Add `--with-audio` after running `services/acoustic-analysis/smoke_check.py` to send its public acted-speech fixtures through the actual HTTP model, TypeScript validation, priority combination and database storage. These audio files are independent of the fictional text scenarios, clearly labeled local audio tests, and do not establish accuracy on real calls.
- `npx tsx scripts/verify-acoustic-priority.ts`: real local database checks for acoustic combination, retries, stale/handled guards, and duplicate application. Its model responses are explicitly synthetic persistence fixtures, not evidence of model accuracy.
- `cd services/acoustic-analysis && uv run pytest -q`: audio quality, caller-channel attribution, bounded inference, input/authentication checks. Public acted-speech inference is only a model-loading/transport smoke test; it is not an independent accuracy evaluation.

The transcript verification script also covers duplicate snapshots, stale IDs, an old snapshot after analysis, positive post-call words after a danger report, and human-handled protection. Its report is `output/caller-priority/verification.json`; its acoustic field describes only that script's transcript-only simulation. `output/caller-priority/acoustic-persistence.json` separately records database verification with synthetic model outputs. No real Retell calls or emergency dispatch are claimed by either script.
