# SMOOVE experimental demo

Branch `SMOOVE` is isolated from the ongoing `heartbeat-dual-use` checkout. The user requested a smoother continuous experience for a three-minute video, with additional features explained on slides.

Current UI: http://127.0.0.1:3021/ . Isolated satellite map: http://127.0.0.1:5180/heartbeat . Restart commands and filming cues: [SMOOVE runbook](../docs/SMOOVE.md).

The scenario contains 20 fictional residents with explicit saved outcomes. Rosa is selected initially. Map and patient selection remain visible through Call, Review and Follow up. Preparation completes the sample steps before a teammate call can begin; there is no replay timer during the real call. Existing Retell call guards, consent, current-call transcript/recording evidence, severity/distress separation, post-call acoustic analysis and per-answer daily-care reviews are retained.

Provider state is unchanged. The dedicated rehearsal agent was last verified at version 4 with only end_call; an actual warm transfer is not implemented by this UI pass. Sample transfer status is labeled. No real calls were placed by the UI work. Use one consenting teammate's answered call to verify actual audio, timing and recognition. Keep global MOCK_RETELL=true and the existing shared callback/database/acoustic services. Do not reset Supabase or repoint the callback to switch frontends.

Verified: 132 Heartbeat tests, 97 voice tests, 40 map tests, typecheck, lint, app/map production builds, 20-person scenario integration including idempotency and untouched pre-existing records, quote-to-transcript navigation, follow-up, local call setup, reload restoration and mobile width checks. Only the integration test's own disposable fixtures were removed.

Private environment files, local media, output captures and older planning notes are not part of the branch's source changes. The parent checkout is not edited or switched.

Call-status recovery: the next dial attempt reconciles stale blockers against their bound Retell call before retrying the atomic reservation. Confirmed terminal calls release the active lock and retain the 60-second cooldown. Active, unbound or unverifiable attempts remain blocked. The existing finished rehearsal was synced from Retell; no call was placed by the repair. The isolated guard regression covers recovery, concurrency, idempotency, provider failure/binding mismatch and cooldown behavior.
