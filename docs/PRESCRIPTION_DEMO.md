# Prescription case room

Open **http://localhost:5175/prescription**. The existing replay's header also links to this separate consumer feature.

## The feature

Three fictional organizations give conflicting accounts of one blocked prescription. The case room connects their statements to a current blocker, an accepted commitment, and six administrative milestones. Each conclusion links to its source receipt. Only the current resend → insurer receipt → insurer decision → pharmacy pickup chain closes the case; a new contradictory source report can reopen it.

For the fastest presentation: **Reveal blocker → Confirm handoff → Break the handoff**. The full guided replay is 80 seconds, with pause, seek, reset, and optional browser-generated narration. Source nodes, transcript cards, milestones, and the conflict strip open the exact supporting statements.

## Run locally

From the main project folder, start the backend:

```sh
npm run dev:prescription
```

From a second terminal, start the frontend:

```sh
cd crisis-la
npm run dev
```

The frontend at port 5175 proxies `/api/prescription` to the local backend at port 3017. `PRESCRIPTION_API_TARGET` can override that development target. Guided replay works independently of the backend; live source rooms require it.

## Live source demo: works without provider keys

1. Select **Live source room**, then **Create live room**.
2. Open the private **Pharmacy room**, **Insurer room**, and **Clinic room** links in separate browser tabs/windows. Each link can submit only its own role's statements.
3. Participants choose the event they are confirming, review or replace its exact statement, and select **Send source update**. The presenter updates after the backend saves that receipt. No scripted events run in live mode.
4. Start with a pharmacy blocker, the clinic's original dispatch claim, and the insurer's missing-form report. Then submit clinic acceptance and resend, insurer receipt and decision, and finally pharmacy pickup confirmation.
5. Submit a newer pharmacy-pending statement to reopen the case. Refresh the presenter to demonstrate recovery from the saved server record.

Custom commitment names/deadlines display exactly as submitted. **Leave saved room** clears the presenter's saved access. Localhost source links work on the presenting computer; sharing with other devices requires an appropriate network host or tunnel. Browser dictation is optional and depends on browser support and microphone permission; typed source updates always work.

This is a genuine participant-to-server demonstration using a fictional administrative case. The deterministic event engine derives state from explicitly selected source events. It does not establish real medical, insurer, or prescription decisions.

## Optional telephone demo

Configure the main project's ignored `.env.local` using `.env.example`:

- `RETELL_API_KEY`, `RETELL_FROM_NUMBER`, `RETELL_AGENT_ID`
- `PRESCRIPTION_PUBLIC_URL`: public HTTPS backend origin for signed callbacks
- `PRESCRIPTION_DEMO_CONTACTS`: JSON mapping `pharmacy`, `insurer`, and `clinic` to consenting teammates' E.164 numbers
- `PRESCRIPTION_DEMO_CALL_TOKEN`: private random token of at least 24 characters

The live panel reads actual server configuration readiness. **Call participant** requires the presenter's consent checkbox and private token. The backend reserves each session/role before dialing. An isolated Retell interview engine asks the consenting teammate for fictional administrative statements, reads them back for confirmation, and reports them through a role-specific tool. The callback checks the provider signature and registered session, role, and call ID. Uncertain call requests are never automatically redialed. Existing voice-agent configuration is preserved; isolated interview engines are retained for traceability when actual calls are requested.

At delivery, Retell credentials were unavailable. No phone calls, remote provisioning, or real patient contact were performed. The provider transport was tested with isolated HTTP fixtures; a real telephone conversation remains unverified.

## Scope and verification

The local rehearsal backend stores private session files under ignored `.local/prescription-demo/`. Sessions expire after four hours. Updates are serialized within one backend process and survive its restart. This is not a distributed production database. Production rehearsal is disabled unless explicitly enabled with `PRESCRIPTION_DEMO_ENABLED=true`. Use fictional details and consenting participants.

Verified:

- 26 new automated tests and 77 existing voice tests passed.
- Main TypeScript and lint checks passed; backend and frontend production builds passed.
- `npm run verify:prescription` exercised the actual frontend proxy, API routes, role tokens, saved evidence, conflict, readiness and reopening. Unauthorized source impersonation and uncredentialed phone requests were rejected. The script places no calls.
- Browser checks passed at 1440px desktop and 390px mobile: blocker/ready/reopen, source dialog/Escape, reduced motion, repeated play/reset, separate participant submission with a custom name/deadline, presenter polling, and refresh recovery. The browser console had no application errors.

Screenshots are in `output/playwright/prescription-*.png`. No deployment was performed.
