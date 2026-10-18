# Heartbeat rehearsal

Heartbeat calls an enrolled roster for ordinary morning check-ins or coordinator-triggered crisis outreach. It records reported needs and hands concerns to a person. It does not make medical or evacuation decisions. Hackathon identities and coordinates are fictional; real calls must use consenting teammates' numbers.

## Start locally

1. Start Docker Desktop.
2. Run `npx supabase start --exclude studio,imgproxy,mailpit,gotrue,storage-api,postgres-meta,edge-runtime,logflare,vector,supavisor`. This project uses API port 55321 and database port 55322 to avoid other local projects.
3. Run `npm run setup:heartbeat-local` to write this local stack's keys to private `.env.local` without printing them. It refuses to replace a different configured database.
4. The setup script explicitly sets `MOCK_RETELL=true`, `DEMO_TIME_SCALE=0.05`, `FICTIONAL_CLIENTS=true`, and `APP_URL=http://localhost:3017`.
5. Run `npm run seed` once. It refuses to erase an existing roster. An intentional rehearsal reset requires `npm run seed -- --replace`.
6. Run `npm run dev:heartbeat` and open http://localhost:3017.

Local Supabase applies `supabase/migrations/` on first start. For an existing hosted project, apply the additive migrations in order using its SQL editor or the Supabase migration CLI. The base schema no longer drops tables. Keep `supabase/voice-actions.sql` separate; the check-in demo does not need research tools.

## Morning round

Click **Run morning check-ins**. In explicit mock mode, inject actual-shaped analyzed-call payloads:

```
npx tsx scripts/fake-webhook.ts "Margaret Ellis" ok
npx tsx scripts/fake-webhook.ts "Harold Kim" follow_up
npx tsx scripts/fake-webhook.ts "Rosa Alvarez" needs_human
npx tsx scripts/fake-webhook.ts "Walter Brooks" no_answer
```

Answered daily patient calls become amber **Follow up** cards for nurse review, including calls whose overall report is okay. Expand **Answers & patient quotes**, inspect the prior-call comparison, and record the reviewing nurse before **Approve next step**. Approval records the review; **Mark handled** separately records human takeover. Reported danger triggers **Needs a human now** and a logged simulated coordinator text. All simulated summaries are labeled.

## Crisis round

Click **Start crisis check**, inspect the labeled fictional alert or paste an official message, and start. Calls are requested in risk order, then ride need, then whether the person lives alone. The agent reads the supplied message exactly.

A missed call waits 15 seconds at demo scale before each next action: retry the client, text, call the listed emergency contact, then hand off as unreachable. Call steps wait for a post-call webhook. The dashboard must remain open to drive the five-second ladder tick.

Use **Advance (demo)** to skip a waiting interval. After a retry inject `no_answer` for that current attempt. After the emergency-contact attempt inject `ok emergency_contact` to confirm okay through the named contact, or `no_answer emergency_contact` to continue to human handoff.

Repeated payloads are deduplicated. Results from old call attempts are ignored. **Mark handled** takes precedence over late results. An abandoned action claim is sent to human review instead of being silently redialed.

## Real phones

Read [RETELL_AGENTS.md](RETELL_AGENTS.md) for exact English/Korean prompts, required analysis fields, setup script, and private seed format. Supply Retell credentials and distinct dedicated daily/crisis agent IDs, `HEARTBEAT_PUBLIC_URL` for signed callbacks, and `ON_CALL_NURSE_PHONE` for the fixed transfer destination. Check-in agents have no research or custom tools. The built-in transfer tool privately briefs the on-call line, introduces the caller, and leaves. Failed or unconfirmed transfers remain open. Verify that full sequence with consenting teammates before calling it a live demo.

Use `scripts/seed.local.json` for consenting participants; it is gitignored. The seeder saves fictional display identities. Anonymous dashboard reads use `clients_public`, which omits telephone numbers. Set `MOCK_RETELL=false` only for the real call rehearsal. Real calling refuses the fictional 555 roster.

Twilio needs its account SID, token, sender, and `COORDINATOR_PHONE`. Missing SMS configuration produces a visible **text not sent (SMS not configured)** note. Provider acceptance is not represented as confirmed delivery.

## P1 planning, Korean, and map

A daily patient result requires confirmed identity before updating `last_daily_at`. The ride flag additionally requires an exact patient quote explicitly supporting the `needs_ride` boolean. Unasked, ambiguous, or unsupported answers preserve the saved flag; emergency contacts cannot change it. To rehearse, start a fresh morning round and run:

```bash
npx tsx scripts/fake-webhook.ts "Harold Kim" needs_ride
```

The card gains **Needs a ride**. In the next crisis round, callers are ordered by risk tier, then ride need and living alone. The request remains a daily follow-up unless the person's own words also contain a configured danger phrase.

Korean variant setup is an explicit opt-in:

```bash
npm run heartbeat:agents -- --language=ko
```

This is an offline dry-run unless `--apply` is supplied with the required provider settings. Review and publish the resulting dedicated drafts separately. Without Korean agent IDs, the corresponding English mode agent is used. A Korean language badge expresses the client's request; it does not prove a Korean call was made. Literal Korean danger-phrase tests pass for user speech only; real Korean phone behavior remains unverified. The official alert always stays in its original language, word for word.

The read-only LA map is available as a separate local surface at [localhost:5175/heartbeat](http://localhost:5175/heartbeat). Set `NEXT_PUBLIC_HEARTBEAT_MAP_URL` in the main app to expose its link. Map points are approximate fictional locations, not participant addresses; status comes from the current Supabase event/checks and the safe roster projection. The browser verified live status changes without refresh, selected-client summaries, ride badges, satellite rendering, and an explicit geographic fallback after a WebGL failure. Read-only data uses the anon key; the service-role key must never enter the Vite environment. Keep the existing SourceCheck replay routes unchanged. Start that surface with `npm run dev --prefix crisis-la`; its private `.env.local` needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_HEARTBEAT_URL=http://localhost:3017`. The map files remain outside this branch’s commits as required by the build specification.

## Verification

```
npm run typecheck
npm run lint
npm run build
npm run test:voice
npm run test:heartbeat
npm run verify:heartbeat
```

The integration verifier requires explicit mock mode and demo scale 0.05. It runs both modes against the configured Supabase instance and local HTTP routes, writes only fictional events, and saves a compact report in `output/heartbeat/verification.json`. Browser screenshots belong in `output/heartbeat/`.

Earlier P0 integration evidence, before the post-op change: both daily and crisis passed with **12 assertions and 20 persisted state snapshots per mode**, each finishing in approximately **80.3 seconds** while their timers ran concurrently. The report verifies client okay, duplicate/stale results, urgent danger, ordinary daily follow-up without coordinator SMS, handled/late results, one successful concurrent advance, all four due-time ladder steps, named emergency-contact confirmation, start-request idempotency, and abandoned-claim handoff without redial. Anonymous `clients` reads returned no rows; `clients_public` retained the fictional roster without phone columns. No real calls or texts were sent.

That earlier baseline also passed **87 voice tests and 30 Heartbeat tests**, plus typecheck, ESLint, and the Next.js production build. The focused HTTP/database planning regression confirmed an unclear answer could not erase a known ride need, while confirmed false and true answers persisted. Evidence is in `daily-planning-verification.json` and `ride-priority.json` under `output/heartbeat/`.

### Post-op rehearsal, October 17

Migration `202610170006_postop_checkins.sql` is applied to the existing local database. The current dashboard is [127.0.0.1:3018](http://127.0.0.1:3018); the pre-existing server on 3017 was left running.

```bash
POSTOP_APP_URL=http://127.0.0.1:3018 npm run verify:postop
# Retain isolated fictional comparison and failed-transfer cards:
POSTOP_APP_URL=http://127.0.0.1:3018 npm run verify:postop -- --keep
```

The isolated verifier passed **10 scenarios** against real HTTP routes and local Supabase: exact quotes, pain 3→7, unknown/fabricated answers, identity protection, approval persistence/idempotency/races, stale and handled guards, late no-answer after transfer, and crisis/contact transfer separation. It never starts roster-wide calls. See `output/postop/verification.json`. Browser verification confirmed all eight quotes, the comparison, a saved nurse approval surviving reload, and the failed-transfer card; proof is `output/postop/dashboard-verified.jpg`.

Current automated checks passed: **96 voice tests and 85 Heartbeat tests**, TypeScript, ESLint, and the Next.js production build. Clear ordinary denials are covered without suppressing affirmative danger after a contrast or uncertainty.

Live verification remains pending: dedicated daily/crisis agent IDs, the public callback URL, and the on-call destination must be supplied. Retell transfer configuration and simulated provider events do not establish that a real whisper, introduction, or AI exit worked. No real calls or texts were sent during this build.

## Limits

The open dashboard drives follow-up ticks; this is a single-coordinator hackathon build, without a hosted scheduler or login. Provider configuration is different from a verified live call. The UI never claims a phone rang or a message was delivered based only on mock execution or configuration. The existing SourceCheck and prescription replays are separate work and do not establish this product's live call behavior.
