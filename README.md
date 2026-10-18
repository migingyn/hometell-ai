# Heartbeat

Post-operative check-ins and crisis outreach for a clinical home-health agency's enrolled patients. A nurse or coordinator uses one website; patients answer their regular phones. The same roster, Retell agents, and Supabase records support both modes.

**Run morning check-ins** collects pain, incision, fever, breathing, appetite, weight, medications, and falls. Cards show exact patient quotes, missing answers, changes since the previous call, and a proposed next step for nurse approval. Reported severity sorts before expressed distress; distress only advances review within the same severity tier. **Start crisis check** reads the coordinator's alert verbatim and retains the unanswered-call ladder and evacuation-help flags. Heartbeat does not diagnose, give medical advice, make evacuation decisions, or dispatch emergency services.

For the current build, see [the one-page plan](docs/POSTOP_PLAN.md) and [customer and funding note](docs/HOME_HEALTH_CUSTOMER_NOTE.md). Migration `202610170006_postop_checkins.sql` adds post-op records, atomic nurse approval, and phone-transfer state without replacing the roster.

The working local rehearsal uses actual Supabase persistence and HTTP routes with explicitly simulated call results. No real Retell calls or Twilio delivery have been verified. See [the product scope](PRD.md), [rehearsal runbook](docs/HEARTBEAT_RUNBOOK.md), and [exact English/Korean agent prompts](docs/RETELL_AGENTS.md).

## Combined care workspace (`experiment`)

Open **http://localhost:3017/login** after `npm run dev:heartbeat`. The preserved Administrator/Nurse login accepts fictional credentials and stores only a tab-local demo role and fixed display name. It is not real authentication. `/` redirects to the appropriate workspace.

The shared navy shell, Geist typography, neutral panels and teal controls use the original 3017 design tokens. Sidebar destinations each have a dedicated route. The combined site includes interactive satellite facility selection, My Day, resident records, daily rounds and vitals, care notes/reminders, follow-up tasks, call history, operational schedules, team/settings, daily phone outreach, and the crisis map/evidence workspace. Care screens use the existing Supabase roster, checks and call results through `/api/care/*`; they no longer use the separate 5173 mock adapter or browser-only IndexedDB. The original 5173 checkout is unchanged.

Apply additive migrations through `202610170010_care_staff_assignments.sql` using `npx supabase migration up --local`. The migrations retain existing clients/calls and assign the fictional roster to three sample facilities. New clients receive a default Hollywood membership. For a fresh database, run the migrations before `npm run seed`.

Measurements, appended corrections, notes, staff-approved reminders, tasks, schedules, settings and pre-call snapshots persist in local Supabase. Daily calls capture the available measurements and reminders before requesting a call; later entries do not rewrite the saved snapshot. Acknowledgement records who responded without marking an unresolved check handled. Profiles, map pins and outreach queues open the same resident record; browser history supports opening and closing that record. Follow-up tasks use shared staff IDs for creation, assignment, reassignment, acceptance, progress and completion. My Day, profiles and follow-up queues share a single workspace snapshot. Schedules are saved planning records; there is no automatic calling scheduler.

The care adapter is intentionally restricted to a local mock environment; it is disabled in production and with a remote database or `MOCK_RETELL=false`. Demo role/assignment checks are presentation aids. Production use requires real authentication and server-side organization/facility memberships before enabling this adapter for real data. Existing live-provider APIs are retained, but live calls/texts remain unverified and unconfigured in this local setup.

The existing satellite renderer remains on **5175**, embedded into the combined site. Start it with `npm --prefix crisis-la run dev`, using its private `.env.local` for the local Supabase URL and public anon key. The live LA satellite facility selector requires explicit selection before an Administrator opens a dashboard. A selected facility stays visible with Switch facility in the header. Nurses open My Day for their fictional assigned Hollywood facility. The existing sample disaster replay is now facility-scoped, including its eight fictional patients and prior daily records.

Run `npm run verify:care` against the local app for isolated persistence, role/facility, correction, task, concurrent-call and webhook integration checks. It cleans up only its own fixtures. `npm run verify:disaster` continues to verify the original replay (set `DISASTER_DEMO_APP_URL=http://127.0.0.1:3017`).

## Quick start

With Node.js, Docker Desktop running, and dependencies installed:

```bash
npm install
npx supabase start --exclude studio,imgproxy,mailpit,gotrue,storage-api,postgres-meta,edge-runtime,logflare,vector,supavisor
npm run setup:heartbeat-local
npm run seed
npm run dev:heartbeat
```

Open [the dashboard](http://localhost:3017). Local Supabase uses API port **55321** and database port **55322**. The setup script writes private `.env.local` with `MOCK_RETELL=true`, `DEMO_TIME_SCALE=0.05`, fictional-data labels, and `APP_URL=http://localhost:3017`; it refuses to replace a different configured database.

Migrations live in `supabase/migrations/`. Apply them in order for an existing database; they preserve enrolled data. Seeding refuses a nonempty roster unless an intentional reset uses `npm run seed -- --replace`. Keep credentials and consenting participant numbers out of Git.

## Rehearse both modes

Start a morning round, then inject simulated post-call results:

```bash
npx tsx scripts/fake-webhook.ts "Margaret Ellis" ok
npx tsx scripts/fake-webhook.ts "Harold Kim" follow_up
npx tsx scripts/fake-webhook.ts "Rosa Alvarez" needs_human
npx tsx scripts/fake-webhook.ts "Walter Brooks" no_answer
```

The payload uses the check's current call ID. Repeating it tests deduplication; advance to a new attempt before submitting its next result. At demo scale, each waiting interval is about 15 seconds. After the emergency-contact call, use `ok emergency_contact` to confirm okay through the named contact or `no_answer emergency_contact` to continue to human handoff. The [runbook](docs/HEARTBEAT_RUNBOOK.md) covers every step and the crisis alert dialog.

`MOCK MODE · NO REAL CALLS` and fictional-client labels remain visible. Mock SMS is logged as simulated. In live mode, missing Twilio configuration produces **text not sent (SMS not configured)**; provider acceptance does not establish delivery.

## Planning and language support

Explicit daily answers update `needs_ride` and `last_daily_at`. Crisis ordering prioritizes risk tier, then ride need and living alone. Cards show ride and requested-language badges. Dedicated Korean agent setup and literal Korean danger-phrase rules are implemented; a language preference or successful setup dry-run does not verify a real Korean phone call.

The separate read-only [LA map](http://localhost:5175/heartbeat) reads the same Supabase records and updates without refresh; satellite rendering and the geographic fallback were verified locally. The map source remains local under `crisis-la/`, excluded from this branch’s commits as requested. Its points are approximate fictional locations. Existing SourceCheck replays remain separate.

## Real-phone setup

Follow [RETELL_AGENTS.md](docs/RETELL_AGENTS.md) to configure and review dedicated daily/crisis drafts, publish them in Retell, and provide a public HTTPS callback endpoint. Set `ON_CALL_NURSE_PHONE` for the predefined warm-transfer destination: private summary, three-way introduction, then the AI leaves. Failed or unconfirmed transfers remain open for human follow-up. Human detection confirms an answer, not the recipient's identity. There is no dashboard live-join feature. Check-in agents have no internet research or custom tools. Use gitignored `scripts/seed.local.json` for consenting teammates; display identities remain fictional. Set `MOCK_RETELL=false` only for an authorized real-phone rehearsal. Live calling rejects the fictional 555 roster.

The dashboard reads `clients_public`, which omits telephone numbers; the server uses the private roster. Optional research and delegated-contact tools are documented separately in [live voice setup](docs/LIVE_VOICE.md) and are excluded from the check-in path.

The consumer [prescription case room](docs/PRESCRIPTION_DEMO.md) runs at `http://localhost:5175/prescription`: inspect conflicting source statements, confirm receipt-linked handoffs, and reopen the case when evidence changes. Its live participant rooms work locally without provider keys; optional phone calling reports its actual configuration readiness.

## Verify

```bash
npm run typecheck
npm run lint
npm run build
npm run test:voice
npm run test:heartbeat
npm run verify:heartbeat
npm run verify:postop
```

The integration verifier requires explicit mock mode, a seeded local database, the running dashboard server, and demo scale `0.05`. It verifies both modes against actual Supabase and HTTP routes and saves phone-free evidence to `output/heartbeat/verification.json`. See the [runbook verification record](docs/HEARTBEAT_RUNBOOK.md#verification) for completed checks and remaining live-provider limits.

The post-op verifier uses its own fictional patients, actual HTTP routes, and local Supabase. Run `POSTOP_APP_URL=http://127.0.0.1:3018 npm run verify:postop`; add `-- --keep` to retain the comparison card for a demo. It tests exact quotes, pain 3→7, unknown answers, approval protections, and transfer outcomes. Its report is `output/postop/verification.json`. No real calls or texts are sent.

The open dashboard drives follow-up ticks. This hackathon build has no hosted scheduler, login, or automatic emergency dispatch.
