# Heartbeat: post-op check-ins and crisis outreach

Agreed October 17, 2026, approximately 5:40 PM Pacific. Build deadline: 10 PM Pacific. This page records the authorized scope; completed verification is tracked separately.

**Product:** one website for a Medicare-certified home-health agency, Retell calls to its enrolled patients' regular phones, and the existing shared Supabase records. The nurse or coordinator operates the website. The same agency, roster, and website serve both modes.

| Everyday: Run morning check-ins | Disaster: Start crisis check |
| --- | --- |
| Ask about pain 0–10, incision, fever, breathing, appetite, weight, medications, and falls; retain the existing transport question. | Preserve the coordinator's verbatim alert, wellbeing/exit questions, ride needs, and unanswered-call ladder. |
| Save structured answers backed by exact patient quotes, with missing answers marked unknown. Compare with the previous recorded daily check. | Present unreachable patients and reported evacuation-assistance needs for agency review and reporting to officials. |
| Suggest a nursing review or record review, then persist the nurse's approval. Approval does not mean a visit occurred. | The operator decides and arranges help; no automatic dispatch or report submission to the county. |

## Build sequence and ownership

1. **Daily records and UI:** add a post-op assessment to each check, validate extracted quotes against patient turns, show changes and evidence, and save nurse review with reviewer/time. Preserve duplicate, stale-call, and handled protections.
2. **Voice handoff:** update the dedicated daily script and Retell analysis fields. Configure a phone-only warm transfer: private nurse summary, introduction, AI departure. Preserve crisis questions and provide an honest failed-transfer path. Mikey owns publishing and the live phone rehearsal; this build supplies the reviewed configuration and dashboard integration.
3. **Review order:** retain separate reported-severity and distress displays. Severity is primary; distress only changes order within that severity tier. Calm or unavailable audio never establishes that someone is fine.
4. **Verify and rehearse:** test extraction, prior-call comparisons, approval races, ordering, and transfer configuration. Run typecheck, lint, build, and existing Heartbeat/voice tests. Exercise daily and crisis HTTP/database flows. Rehearse a real two-phone transfer only with consenting teammates and configured destinations.

## Smallest complete demo

Call a consenting teammate with a fictional patient identity → capture a post-op answer → show its exact quote and change from the previous call → nurse approves a follow-up → demonstrate the nurse transfer. Switch to crisis mode on the same roster and show a ride need and unresolved outreach. Label simulated results explicitly; keep a prepared, labeled fallback if a provider fails.

## Dependencies and completion conditions

The local environment has the Retell key/number and local Supabase. Dedicated daily/crisis agent IDs, a public webhook URL, and the private on-call nurse destination must be connected for live verification. Do not overwrite Mikey's published agent. The supplied question topics form a demo script pending the agency's clinical approval; the software gives no diagnoses or treatment instructions.

Done means saved answers/quotes survive refresh, comparisons never invent missing history, nurse approval is tied to the current call, crisis behavior still works, and the transfer configuration is tested. A successful live whisper/introduction/AI-exit rehearsal is a separate acceptance check, not implied by configuration.
