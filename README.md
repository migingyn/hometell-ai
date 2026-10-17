# Heartbeat

Daily check-ins and crisis outreach for an agency's enrolled clients. A coordinator starts a round, records what clients or their listed emergency contacts actually report, and follows unanswered calls through retry → text → emergency contact → human handoff.

**Run morning check-ins** collects ordinary requests as amber follow-ups. Danger phrases in the person's own words trigger an urgent human handoff in either mode. **Start crisis check** takes a coordinator-supplied alert for the agent to read verbatim; crisis help requests are urgent. Heartbeat does not make medical or evacuation decisions or dispatch emergency services.

The working local rehearsal uses actual Supabase persistence and HTTP routes with explicitly simulated call results. No real Retell calls or Twilio delivery have been verified. See [the product scope](PRD.md), [rehearsal runbook](docs/HEARTBEAT_RUNBOOK.md), and [exact English/Korean agent prompts](docs/RETELL_AGENTS.md).

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

Follow [RETELL_AGENTS.md](docs/RETELL_AGENTS.md) to configure and review dedicated daily/crisis drafts, publish them in Retell, and provide a public HTTPS callback endpoint. Check-in agents have no internet research or custom tools. Use gitignored `scripts/seed.local.json` for consenting teammates; display identities remain fictional. Set `MOCK_RETELL=false` only for an authorized real-phone rehearsal. Live calling rejects the fictional 555 roster.

The dashboard reads `clients_public`, which omits telephone numbers; the server uses the private roster. Optional research and delegated-contact tools are documented separately in [live voice setup](docs/LIVE_VOICE.md) and are excluded from the check-in path.

## Verify

```bash
npm run typecheck
npm run lint
npm run build
npm run test:voice
npm run test:heartbeat
npm run verify:heartbeat
```

The integration verifier requires explicit mock mode, a seeded local database, the running dashboard server, and demo scale `0.05`. It verifies both modes against actual Supabase and HTTP routes and saves phone-free evidence to `output/heartbeat/verification.json`. See the [runbook verification record](docs/HEARTBEAT_RUNBOOK.md#verification) for completed checks and remaining live-provider limits.

The open dashboard drives follow-up ticks. This hackathon build has no hosted scheduler, login, or automatic emergency dispatch.
