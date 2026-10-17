# Heartbeat rehearsal

Heartbeat calls an enrolled roster for ordinary morning check-ins or coordinator-triggered crisis outreach. It records reported needs and hands concerns to a person. It does not make medical or evacuation decisions. Hackathon identities and coordinates are fictional; real calls must use consenting teammates' numbers.

## Start locally

1. Start Docker Desktop.
2. Run `npx supabase start --exclude studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor`. This project uses API port 55321 and database port 55322 to avoid other local projects.
3. Put the local Supabase URL, anonymous key, and service-role key in `.env.local`. Run `npx supabase status` to retrieve them locally; never commit or share the service key.
4. Set `MOCK_RETELL=true`, `DEMO_TIME_SCALE=0.05`, `FICTIONAL_CLIENTS=true`, and `APP_URL=http://localhost:3017`.
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

Ordinary requests become amber **Follow up** cards. Danger words in the person's own speech become red **Needs a human now** and trigger a logged simulated coordinator text. Words in the agent's questions cannot trigger the hard rules. All simulated summaries are labeled.

## Crisis round

Click **Start crisis check**, inspect the labeled fictional alert or paste an official message, and start. Calls are requested in risk order, then ride need, then whether the person lives alone. The agent reads the supplied message exactly.

A missed call waits 15 seconds at demo scale before each next action: retry the client, text, call the listed emergency contact, then hand off as unreachable. Call steps wait for a post-call webhook. The dashboard must remain open to drive the five-second ladder tick.

Use **Advance (demo)** to skip a waiting interval. After a retry inject `no_answer` for that current attempt. After the emergency-contact attempt inject `ok emergency_contact` to confirm okay through the named contact, or `no_answer emergency_contact` to continue to human handoff.

Repeated payloads are deduplicated. Results from old call attempts are ignored. **Mark handled** takes precedence over late results. An abandoned action claim is sent to human review instead of being silently redialed.

## Real phones

Read [RETELL_AGENTS.md](RETELL_AGENTS.md) for exact English/Korean prompts, required analysis fields, setup script, and private seed format. Supply Retell credentials and dedicated daily/crisis agent IDs, plus `HEARTBEAT_PUBLIC_URL` for signed callbacks. Check-in agents have no research or custom tools.

Use `scripts/seed.local.json` for consenting participants; it is gitignored. The seeder saves fictional display identities. Anonymous dashboard reads use `clients_public`, which omits telephone numbers. Set `MOCK_RETELL=false` only for the real call rehearsal. Real calling refuses the fictional 555 roster.

Twilio needs its account SID, token, sender, and `COORDINATOR_PHONE`. Missing SMS configuration produces a visible **text not sent (SMS not configured)** note. Provider acceptance is not represented as confirmed delivery.

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

## Limits

The open dashboard drives follow-up ticks; this is a single-coordinator hackathon build, without a hosted scheduler or login. Provider configuration is different from a verified live call. The UI never claims a phone rang or a message was delivered based only on mock execution or configuration. The existing SourceCheck and prescription replays are separate work and do not establish this product's live call behavior.
