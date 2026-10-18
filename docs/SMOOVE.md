# SMOOVE: one continuous demo

Experimental branch: `SMOOVE`. The existing Heartbeat checkout and its port 3018 remain separate. This branch carries forward the current live transcript, answer review, sentiment, acoustic analysis and guarded teammate-call implementation.

Open **http://127.0.0.1:3021/**. Start the disaster demo once; preparation saves a new isolated fictional scenario. Twenty residents appear on the satellite map, 125 ms apart. Rosa is selected. Reduced-motion preferences skip the entrance animation.

The left side stays on the community. The right side has three steps:

1. **Call:** choose a resident; set up a consenting teammate's test number. Prepare does not dial. Confirm recording consent, then explicitly click **Call my teammate**. The real transcript replaces the sample evidence for that resident as provider events arrive.
2. **Review:** reported severity, expressed distress, text sentiment, experimental recorded-voice analysis, and supporting statements. Clicking a statement returns to its highlighted caller turn. Recording availability is independent of voice analysis.
3. **Follow up:** inspect the contact sequence and handoff state, then record the operator's follow-up. This does not dispatch help. Sample transfers are labeled; the current dedicated rehearsal agent has no transfer tool.

There is no separate presentation screen or automated replay moving selection during a call. Filters and new results do not change the selected person. Switching to Everyday care keeps that person's prior record. Scenario tools contain a fresh scenario and export. Reload restores this experiment's scenario, rather than adopting another tab's newest campaign.

## Three-minute filming path

- **0:00–0:25:** Start the scenario; establish the 20 fictional residents, assistance needs and unreached patients. Rosa remains selected.
- **0:25–1:35:** Show one consenting teammate's actual phone call. Follow the transcript in Call. Prepare the number before recording if needed; do not dial until the participant is ready.
- **1:35–2:20:** Open Review. Read the reported need and separate distress signal. Click its evidence quote. Play the actual recording when it becomes available; do not substitute sample text as real audio.
- **2:20–2:50:** Open Follow up. Explain the coordinator's decision and unresolved cases. Only mark handled after the demonstrated human follow-up.
- **2:50–3:00:** Briefly show the same person's prior Everyday care record. Cover additional features on slides.

## Run locally

Use the existing private environment and local Supabase/acoustic services; do not reset or start a replacement database. Install app dependencies with `npm ci` and map dependencies with `npm --prefix crisis-la ci` if this is a fresh checkout.

Run in two terminals:

```sh
npm run dev:smoove
npm run dev:smoove-map
```

The app uses port 3021 and its isolated map uses 5180. The map trusts the configured exact dashboard origin. Keep global `MOCK_RETELL=true`; only the separately guarded teammate-call route dials. Private environment files stay outside Git.

The existing webhook receiver can keep writing to the shared database. The experiment reads those persisted events. Do not repoint the public callback or reconfigure the provider agent just to switch UI branches.

If an earlier case still looks active after its call ended, starting the next prepared call checks the earlier call with Retell and saves its confirmed completion. The 60-second cooldown still applies after that sync; retry after it expires. Active calls, provider failures, mismatched call records and requests without a confirmed call ID remain blocked. Recovery never redials the earlier call.

## Verification

Heartbeat tests (132), voice tests (97), map tests (40), typecheck, lint, and app/map production builds passed. The scenario integration check verifies 20 explicit outcomes, original severity ordering, idempotent preparation, preserved prior care, and untouched pre-existing records. Browser checks cover Call → Review → quote highlight → Follow up, real-call setup, and mobile overflow.

No actual phone calls were placed during this UI pass. A fresh answered Retell phone rehearsal and any eventual warm-transfer demonstration remain separate verification steps.

Call-recovery regression: `npx tsx scripts/verify-rehearsal-call-guard.ts` uses disposable local fixtures and intercepts every provider request. It verifies recovery of a missed callback in another case, concurrent-call blocking, idempotency, unresolved-call blocking and the unchanged cooldown. It places no phone calls.
