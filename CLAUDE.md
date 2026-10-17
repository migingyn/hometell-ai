# Heartbeat

AI phone desk for home care agencies. A coordinator clicks one button. Heartbeat calls every senior client through Retell AI, highest risk first. Clients who answer and sound fine turn green. Clients who report danger go to a human. Clients who do not answer climb a no-pickup ladder.

This is a 24 hour hackathon MVP. Read `PRD.md` before any feature work. If a request is not in the PRD, say so and ask before building it.

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
- `npx tsx scripts/seed.ts` seeds 10 clients
- `npx tsx scripts/fake-webhook.ts <checkId> <ok|needs_human|no_answer>` fakes a Retell result
- `ngrok http 3000` exposes the webhook to Retell

## Folder map and owners

| Path | Owner | Notes |
| --- | --- | --- |
| `lib/types.ts` | Shared | The contract. Do not change without telling the team |
| `supabase/schema.sql` | Shared | Do not change without telling the team |
| `lib/retell.ts`, `app/api/retell/*` | Mikey | Retell calls and webhook |
| `lib/ladder.ts`, `lib/classifier/*`, `lib/sms.ts`, `app/api/ladder/*` | Fullstack | Ladder and classification |
| `app/page.tsx`, `components/*` | Frontend | Dashboard |
| `scripts/*`, `docs/*` | Pitch | Seed data and demo script |

Stay inside your own files unless the task needs a shared change. If it does, stop and say what needs to change in the shared file and why.

## Rules for code

- Import types from `lib/types.ts`. Never redefine `Check`, `Client`, or `CheckStatus` locally
- Server code uses the Supabase service role client from `lib/supabase.ts`. Never import the service role key into a client component
- Every API route validates input with zod and returns `{ ok: true, data }` or `{ ok: false, error }`
- Webhook handlers must be idempotent. Retell can send the same event twice
- Keep `MOCK_RETELL=true` working at all times. If real code breaks, mock mode must still run the demo
- No new dependencies without a one-line reason in the commit message
- No auth, no settings pages, no tests unless asked
- Prefer one clear function over a clever abstraction

## Safety rules that code must enforce

- Hard danger words (chest pain, can't breathe, fell, fall, dizzy, confused, help, emergency) always set `needs_human`. No classifier can downgrade them
- Voicemail always counts as no answer
- The AI script never tells a client they are safe
- A missed call never becomes `ok` without a human or emergency contact confirming

## Demo settings

- `DEMO_TIME_SCALE=0.05` turns 5 minute ladder steps into about 15 seconds
- The Advance button on each card runs the next ladder step instantly
- Seed data uses teammates' real phone numbers

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
