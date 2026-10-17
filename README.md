# Heartbeat

AI phone desk for home care agencies. A coordinator clicks one button. Heartbeat calls every senior client through Retell AI, highest risk first, and shows who is okay, who is silent, and who needs a human.

See `PRD.md` for scope. This repo is a skeleton: routes, database, and dashboard are wired, and feature logic is stubbed with `TODO(<owner>)` comments.

## Setup

1. Install

   ```bash
   npm install
   ```

2. Create a Supabase project. In the SQL editor, run all of `supabase/schema.sql`. It creates the tables, read policies for the dashboard, and turns on Realtime for `checks`. Re-running it wipes all data.

3. Env

   ```bash
   cp .env.example .env.local
   ```

   Fill in the three Supabase values (Project Settings > API). Leave `MOCK_RETELL=true` until Retell is set up.

4. Seed 10 clients

   ```bash
   npx tsx scripts/seed.ts
   ```

5. Run

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Demo in mock mode

With `MOCK_RETELL=true` no calls or texts go out. Calls get a `mock_` id and are logged to the server console.

1. Press **Start heat wave check**. Ten cards appear as `calling`, red tier first.
2. In another terminal, fake a call result. Use a check id or part of a client name:

   ```bash
   npx tsx scripts/fake-webhook.ts Margaret needs_human
   npx tsx scripts/fake-webhook.ts Harold no_answer
   npx tsx scripts/fake-webhook.ts Rosa ok
   npx tsx scripts/fake-webhook.ts Harold ok emergency_contact
   ```

3. Cards change color live. Press **Advance** on a yellow card to bump its ladder step, or wait for `/api/ladder/tick` (every 5 seconds from the dashboard, step delay is 5 min times `DEMO_TIME_SCALE`).
4. Press **Mark handled** to move a card to Handled.

The stubs fake their results, so in mock mode the ladder only bumps the step number and nothing is texted. The real behavior is listed in each `TODO`.

## Real calls

1. Set `MOCK_RETELL=false` and fill in the Retell and Twilio values.
2. `ngrok http 3000`, then set the Retell agent webhook URL to `https://<ngrok-host>/api/retell/webhook`.
3. Put teammates' real numbers in `scripts/seed.ts` and re-seed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App on localhost:3000 |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check. Run `npm run dev` or `npx next typegen` once first so route types exist |
| `npx tsx scripts/seed.ts` | Wipe and seed 10 clients |
| `npx tsx scripts/fake-webhook.ts <checkId\|name> <ok\|needs_human\|no_answer> [client\|emergency_contact]` | Fake a Retell result |

## How a call flows

1. `POST /api/events/start` creates an event and one `queued` check per client, then `lib/retell.ts` places calls red, yellow, green. Checks go to `calling`.
2. Retell (or `fake-webhook.ts`) posts `call_analyzed` to `POST /api/retell/webhook`. The route skips repeated call ids, runs `lib/classifier` (hard rules first), writes `call_logs`, and saves the patch from `applyCallResult` in `lib/ladder.ts`. A new `needs_human` texts the coordinator.
3. The dashboard calls `POST /api/ladder/tick` every 5 seconds. It runs `runLadderStep` for each `no_answer` check whose `next_action_at` has passed. Each step is claimed first so two ticks never run it twice.
4. `POST /api/ladder/advance/:checkId` runs the next step now. `POST /api/checks/:id/handled` marks it handled.
5. The dashboard reads with the anon key and gets updates through Supabase Realtime on `checks`.

Every route returns `{ ok: true, data }` or `{ ok: false, error }`.

## Ownership

| Path | Owner | Notes |
| --- | --- | --- |
| `lib/types.ts` | Shared | The contract. Do not change without telling the team |
| `supabase/schema.sql` | Shared | Do not change without telling the team |
| `lib/supabase.ts`, `lib/supabase-browser.ts`, `lib/config.ts`, `lib/api.ts` | Shared | Clients, env, response helpers |
| `lib/retell.ts`, `app/api/retell/*`, `app/api/events/*` | Mikey | Retell calls and webhook |
| `lib/ladder.ts`, `lib/checks.ts`, `lib/classifier/*`, `lib/sms.ts`, `app/api/ladder/*`, `app/api/checks/*` | Fullstack | Ladder and classification |
| `app/page.tsx`, `components/*` | Frontend | Dashboard. `components/ui/*` is shadcn |
| `scripts/*`, `docs/*` | Pitch | Seed data and demo script |

Find your work with `grep -rn "TODO(Mikey)\|TODO(Fullstack)\|TODO(Frontend)\|TODO(Pitch)" app lib components scripts`.
