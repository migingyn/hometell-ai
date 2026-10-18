# Call evidence and individual answer review

The existing Heartbeat patient workspace now supports the selected Clinically Speaking features: source-linked answers (#1), per-answer review (#2), and ordinary-call live transcripts (#6).

## Using the workflow

1. Select a patient and open **Call analysis**. Incoming ordinary-call transcripts refresh approximately every 2.5 seconds while the call is active. Transcript arrival depends on the provider's signed callbacks.
2. Select an extracted answer or supporting situation/distress statement. Its matching caller words are highlighted and focused in the transcript. Earlier daily-care context remains separate from the current conversation.
3. In a daily check-in, enter the answer reviewer's name or initials. Confirm an extracted answer, or choose **Correct**, enter a correction, and save. A missing answer can remain explicitly unknown.
4. The original extraction and quote remain visible. Corrections have a reviewer, time, and revision and survive a page reload. **Use original** records a new review choosing the original extraction again.

Individual answer review covers the eight existing post-op questions. It does not approve the suggested follow-up, change triage priority, mark the whole case handled, or rewrite the caller's transcript. Whole-case nurse approval remains a separate action.

## Persistence and conflict handling

- Migration `202610170011_live_transcripts.sql` stores ordinary-call snapshots separately from the final-analysis deduplication ledger. Check/call/target binding, terminal states, cumulative speech position, and exact-duplicate retry handling prevent stale updates from replacing later evidence.
- Migration `202610170012_answer_reviews.sql` stores append-only review revisions. Source fingerprints and expected revisions are compared under the check lock; an outdated source or simultaneous review produces a conflict instead of overwriting another operator's work.
- These tables and RPCs are restricted to the server service role. The local prototype's reviewer name is entered by the operator; it is not an authenticated clinical identity.
- Real callback verification always requires a valid signature, including during global mock mode. Optional `RETELL_WEBHOOK_KEY` takes precedence over `RETELL_API_KEY`, following the compatible signing-key fix on remote main.

Retell can revise speech recognition text. Equal-position rewrites with no ordering information retain the first snapshot until terminal evidence. The UI reports truncation if a snapshot exceeds 1,000 turns, 6,000 characters per turn, or 500,000 characters in total. No transcript text is synthesized when callbacks are missing.

## Verification

Run `npm run test:heartbeat`, `npm run test:voice`, `npm run typecheck`, `npm run lint`, and `npm run build` for the regression checks. With the existing local database running and migrations 011/012 applied, `npm run verify:live-transcripts` and `npm run verify:answer-reviews` exercise signed synthetic callbacks, race conditions, persistence, and database access restrictions. They clean up only their own fictional records and place no calls.

`scripts/verify-evidence-browser-fixture.ts` provides explicitly labeled local browser fixtures with `start`, `more`, `complete`, `change-source`, and `cleanup` commands. It requires global mock mode and a local database. `change-source` invalidates the fictional extraction to exercise an open editor's conflict behavior. Screenshots are under `output/evidence-review/`.

Verified October 17, 2026: 132 Heartbeat tests and 97 voice tests passed, along with both integration scripts, lint, TypeScript and the production build. Desktop and 390px mobile browser checks confirmed partial updates without refresh, exact quote highlighting, saved confirmation/correction, reload persistence, and invalidation of an open correction when its source changes. Temporary fixture rows were cleaned.

Implementation is in the current `heartbeat-dual-use` working checkout. Remote main `a9ca733` was inspected; its replacement `calls/daily_entries/alerts` schema was not merged into this `checks/events/call_logs` dashboard. No deployment, provider change, or real phone test is implied by these checks.
