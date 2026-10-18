# Heartbeat

AI phone desk for a private home care center. The AI calls each resident daily, asks nurse check-in questions, reminds them about meds exactly as the nurse wrote it, and alerts the front desk when something is wrong. In a disaster it calls every resident, highest vitals risk first, and flags anyone who needs help or does not respond.

This is a 24 hour hackathon MVP. `API.md` is the contract the frontend builds against, and `README.md` covers how it works. The no-pickup ladder in `PRD.md` was dropped. If a request is not covered by these, say so and ask before building it.

## Priorities, in order

1. The live demo works end to end
2. The code is simple enough for a teammate to read in 2 minutes
3. Everything else

## Stack

- Next.js App Router, TypeScript
- Tailwind CSS, shadcn/ui
- Supabase Postgres with Realtime
- Retell AI for calls and post-call analysis
- Twilio for SMS (or Retell SMS if confirmed)
- Vercel for hosting, ngrok for local webhooks

## Commands

- `npm run dev` starts the app on localhost:3000
- `npm run lint` runs ESLint
- `npx tsc --noEmit` type checks
- `npx tsx scripts/seed.ts` seeds 5 residents
- `POST /api/mock-webhook { client_id, scenario }` fakes a Retell call (see README)
- `npx tsx scripts/check-setup.ts` read-only check of every key and the Retell agent
- `npx tsx scripts/setup-retell.ts [--apply] [--publish]` points the Retell agent at this server
- `ngrok http 3000` exposes the webhook to Retell

## Folder map and owners

| Path | Owner | Notes |
| --- | --- | --- |
| `lib/types.ts` | Shared | The contract. Do not change without telling the team |
| `supabase/schema.sql` | Shared | Do not change without telling the team |
| `lib/retell.ts`, `lib/webhook.ts`, `app/retell-webhook/*`, `app/retell/*` | Mikey | Retell calls, webhook, custom functions |
| `lib/status.ts`, `lib/vitals.ts`, `lib/alerts.ts`, `lib/crisis.ts`, `lib/watchdog.ts`, `lib/classifier/*`, `lib/sms.ts`, `app/api/*` | Fullstack | Status, alerts, crisis, API routes |
| `app/page.tsx`, `components/*` | Frontend | Dashboard |
| `scripts/*`, `docs/*` | Pitch | Seed data and demo script |

Stay inside your own files unless the task needs a shared change. If it does, stop and say what needs to change in the shared file and why.

## Rules for code

- Import types from `lib/types.ts`. Never redefine `Client`, `Call`, or `Alert` locally
- Server code uses the Supabase service role client from `lib/supabase.ts`. Never import the service role key into a client component
- Every API route validates input with zod and returns the shape in `API.md`. Errors are `{ error }` with a status code
- Webhook handlers must be idempotent. Retell can send the same event twice
- Keep `MOCK_RETELL=true` working at all times. If real code breaks, mock mode must still run the demo
- No new dependencies without a one-line reason in the commit message
- No auth, no settings pages, no tests unless asked
- Prefer one clear function over a clever abstraction

## Safety rules that code must enforce

- Hard danger words (chest pain, can't breathe, fell, fall, dizzy, confused, help, emergency) in the resident's words always raise a `danger` alert. No classifier can downgrade them
- Voicemail always counts as no answer
- The AI script never tells a client they are safe
- A crisis call that fails, never starts, goes unanswered, or ends unclear always raises an urgent crisis alert
- All status and alert decisions are plain if-statements. No AI logic in the backend

## Demo settings

- `OPEN_LINE_MINUTES=1` shows open-line alerts fast
- `POST /api/mock-crisis` plays a full crisis across all residents
- Seed data uses teammates' real phone numbers from `SEED_PHONES`

## Git

- One branch per person, named `<name>/<short-task>`
- Never push directly to `main`
- Merge small and often, every 2 to 3 hours
- Use the `ship-it` skill to stage, commit, push, and open a PR in one step
- Never commit `.env`, `.env.local`, or any key
- Commit messages are short, imperative, and specific. Example `add ladder step 3 emergency contact call`
- Do not add Co-Authored-By trailers or "Generated with" lines to commits or PRs

## Skills in this repo

- `ship-it` stages, commits, pushes, and opens a PR
- `frontend-ui` rules for the dashboard look and behavior
- `backend-api` rules for routes, Supabase, Retell, and the ladder
- `debug` a time-boxed debugging loop
- `scope-check` checks a request against the PRD before building
- `demo-check` runs the pre-demo checklist

## Writing style for any text Claude writes here

Commit messages, PR descriptions, comments, and UI copy are short and plain. No em dashes. No filler words like crucial, enhance, seamless, robust, or leverage.
