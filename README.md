# Heartbeat

AI phone desk for a private home care center. Every day the AI calls each resident, asks the nurse's check-in questions, reminds them about medication exactly as the nurse wrote it, and alerts the front desk when something is wrong. In a local disaster it calls every resident, highest vitals risk first, and flags hard when someone needs help or does not respond.

This repo is the backend: Next.js route handlers on Supabase, calling through Retell AI. The frontend builds against [API.md](API.md). All status and alert decisions are plain if-statements in `lib/`, with no AI.

> **Demo data only.** Seed data is fake. Real resident data needs a HIPAA business associate agreement with every vendor first (Retell, Supabase, Twilio, Vercel, ngrok).

## Setup

1. Install

   ```bash
   npm install
   ```

2. Create a Supabase project. In the SQL editor, run all of `supabase/schema.sql`. Re-running it wipes all data.

3. Env

   ```bash
   cp .env.example .env.local
   ```

   Fill in the three Supabase values (Project Settings > API) and `RETELL_API_KEY`. Leave `MOCK_RETELL=true` until you want real calls. Put teammates' phones in `SEED_PHONES`.

4. Seed 5 residents. Four get today's nurse entry; Evelyn (id 5) has none, for the "no vitals entered" case.

   ```bash
   npx tsx scripts/seed.ts
   ```

5. Run

   ```bash
   npm run dev
   ```

   API on http://localhost:3000. The watchdog starts with the server.

## What needs which key

Run `npx tsx scripts/check-setup.ts` at any time. It only reads, and lists each service as PASS, WARN, or FAIL.

| You set | What starts working |
| --- | --- |
| Nothing | Build and type check. `GET /api/config`, `GET /api/mock/scenarios`, and the `/api/events` stream answer. Every other route returns 500 |
| Supabase URL + service role key | Every `/api` route: residents, nurse entries, alerts, ack, crisis board, mock replays, the watchdog |
| `RETELL_API_KEY` | Real calls (with `MOCK_RETELL=false`), signature checks on all three Retell routes, the watchdog's Retell lookups, both setup scripts |
| `RETELL_WEBHOOK_KEY` | The Retell API key with the webhook badge (Settings > API Keys). Retell signs webhooks with it. Without it, webhooks are checked with `RETELL_API_KEY` and get 401 if that is a different key. The watchdog still recovers those calls from Retell within about 2 minutes |
| `PUBLIC_BASE_URL` (ngrok https URL) | Retell can reach `/retell-webhook` and `flag_nurse`. Without it, calls are placed but no results come back |
| `PUBLIC_API=true` | Opens `/api/*` on the public ngrok URL. Off by default, so only localhost can call `/api` and strangers cannot place calls. Retell's routes stay public either way |
| `SEED_PHONES` | Seeded residents get real numbers. Calls to the fake 555 numbers are refused before dialing |
| `NURSE_PHONE` | The agent's `transfer_to_nurse` tool has a number to dial (falls back to `FRONT_DESK_PHONE`) |
| All four Twilio vars | Every alert is also texted to `FRONT_DESK_PHONE` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Only for a frontend that reads Supabase Realtime directly |

## Retell SDK calls this program makes

| SDK call | Where | When |
| --- | --- | --- |
| `client.call.createPhoneCall` | `lib/retell.ts` | Every daily or crisis call, unless mock |
| `Retell.verify` | `lib/retell.ts` | Every request to `/retell-webhook` and `/retell/functions/*`, on the raw body |
| `client.call.retrieve` | `lib/watchdog.ts` | A call looks stuck (open line, never started, analysis missing). A missed webhook is replayed instead of raising a false alert |
| `client.agent.retrieve`, `client.llm.retrieve`, `client.phoneNumber.retrieve` | `scripts/check-setup.ts` | Read-only setup check |
| `client.agent.update`, `client.llm.update`, `client.agent.publish` | `scripts/setup-retell.ts` | Only with `--apply` (and `--publish`) |

## Real calls

1. `ngrok http 3000`. Put the https URL in `PUBLIC_BASE_URL`, set `MOCK_RETELL=false`, `SEED_PHONES`, and `NURSE_PHONE`. Re-seed, restart `npm run dev`.
2. Point the agent at this server with the SDK. Look at the dry run first:

   ```bash
   npx tsx scripts/setup-retell.ts
   npx tsx scripts/setup-retell.ts --apply --publish
   ```

   This sets the agent webhook to `{PUBLIC_BASE_URL}/retell-webhook`, sets the `flag_nurse` URL to `{PUBLIC_BASE_URL}/retell/functions/flag-nurse` with args at root off, keeps max call duration near 5 minutes, and adds a `## Call context` block to the top of the prompt. That block is needed: Retell only fills in variables written as `{{name}}`, and the prompt mentions `call_type`, `crisis_type`, `vitals_status`, `vitals_watch_note`, and `personal_note` without braces, so the agent never sees their values.
3. `npx tsx scripts/check-setup.ts` should show no FAIL.

To do it by hand in the Retell dashboard instead: agent webhook URL, `flag_nurse` URL, the context block, then publish. Voicemail detection should hang up and end-on-silence should be about 20 seconds (both already set). `ngrok` URLs change on restart, so re-run `setup-retell.ts --apply --publish` when it does.

## Demo with no real calls

`/api/mock-webhook` replays Retell events through the same webhook code, so mock and real calls behave the same. Set `OPEN_LINE_MINUTES=1` to see open-line alerts fast. Start the event stream in a second terminal to watch:

```bash
curl -N localhost:3000/api/events
```

Daily scenarios (client ids are 1 to 5 after seeding)

```bash
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":1,"scenario":"ok"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":2,"scenario":"dizzy"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":3,"scenario":"missed_med"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":4,"scenario":"dose_question"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":1,"scenario":"allergy"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":2,"scenario":"pain_high"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":4,"scenario":"pain_mid"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":5,"scenario":"low_mood_not_eating"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":3,"scenario":"voicemail"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":4,"scenario":"open_line"}'
```

Crisis scenarios (join the active run, if any)

```bash
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":1,"scenario":"crisis_safe"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":2,"scenario":"crisis_needs_help"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":3,"scenario":"crisis_silent"}'
curl -s -XPOST localhost:3000/api/mock-webhook -H 'content-type: application/json' -d '{"client_id":4,"scenario":"crisis_no_answer"}'
```

Full crisis across all 5 residents, then check the board

```bash
curl -s -XPOST localhost:3000/api/mock-crisis -H 'content-type: application/json' -d '{"crisis_type":"heat_wave"}'
sleep 20; curl -s localhost:3000/api/crisis/current
```

Other useful calls

```bash
curl -s localhost:3000/api/clients
curl -s localhost:3000/api/clients/2
curl -s 'localhost:3000/api/alerts?open=true'
curl -s -XPOST localhost:3000/api/alerts/1/ack -H 'content-type: application/json' -d '{"by":"Front desk"}'
curl -s -XPOST localhost:3000/api/clients/5/entries -H 'content-type: application/json' -d '{"bp_sys":130,"bp_dia":82,"heart_rate":74,"temp_f":98.3,"spo2":97,"med_schedule_now":"Morning: metformin 500 mg with breakfast.","entered_by":"Nurse Kim"}'
curl -s -XPOST localhost:3000/api/clients/1/call -H 'content-type: application/json' -d '{"call_type":"daily"}'
curl -s -XPOST localhost:3000/api/crisis/end
```

With `MOCK_RETELL=true`, `/api/clients/:id/call` and `/api/crisis/start` create mock calls that never get events. That is on purpose: after 90 seconds every unstarted crisis call raises `crisis_no_response`, the same as a real call that never connects.

## How it works

| File | Job |
| --- | --- |
| `lib/vitals.ts` | Today's entry vs the nurse's ranges: `alert` out of range, `watch` within 5% of the range width from a limit or no entry, else `normal` |
| `lib/status.ts` | Card color and reason per resident, alert sort order, crisis state per resident |
| `lib/retell.ts` | Builds dynamic variables (all strings, `"none"` when empty), places calls, checks signatures |
| `lib/webhook.ts` | `call_started`, `call_ended`, `call_analyzed`, `flag_nurse`. Every alert rule lives here |
| `lib/alerts.ts` | Saves an alert (deduped per call and type), logs it, pushes it to `/api/events`, texts the front desk |
| `lib/crisis.ts` | Opens and ends runs, calls everyone 2 seconds apart |
| `lib/watchdog.ts` | Every 30 seconds: open lines, crisis calls that never started, and missed `call_analyzed`. Asks Retell first |
| `lib/mock.ts` | Demo scenarios |
| `lib/events.ts` | In-process event bus for SSE |
| `lib/classifier/hardRules.ts` | Danger words in the resident's own words always raise a danger alert |

Safety rules the code enforces

- Danger words (chest pain, can't breathe, fell, fall, dizzy, confused, help, emergency) in the resident's own words always raise a `danger` alert, even if Retell's `danger_words_heard` is false
- Voicemail and no answer always alert. They never count as fine
- A crisis call that can't be placed, never starts, goes unanswered, or ends with an unclear status always raises an urgent crisis alert
- The AI only sees `vitals_status` and the nurse's note, never raw numbers

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API on localhost:3000 |
| `npm run lint` | ESLint |
| `npx next typegen && npx tsc --noEmit` | Type check |
| `npx tsx scripts/seed.ts` | Wipe and seed 5 residents |
| `npx tsx scripts/check-setup.ts` | Read-only check of Supabase, Retell, Twilio, and env |
| `npx tsx scripts/setup-retell.ts [--apply] [--publish]` | Point the Retell agent at this server. Dry run without `--apply` |
