# Live voice research and delegated tasks

Heartbeat's Retell call agent has five server tools:

| Tool | Result |
| --- | --- |
| `research_web` | Exa searches the internet and returns an answer, citations, source publication dates when available, and retrieval time. |
| `delegate_research` | Runs exactly 3–5 independent research workers: official sources, latest status, conflicting evidence, practical logistics, and alternatives. Returns individual findings and failures. |
| `list_contacts` | Lists the configured outbound contact directory by ID and name. |
| `call_contact` | Starts a real Retell call to a directory contact for the caller's confirmed purpose. Returns an action ID. |
| `get_call_result` | Returns the actual call state and recipient information for an action belonging to the current caller. |

The Retell model decides when to invoke these tools while speaking with a caller. Live research is retrieval on demand rather than a periodically indexed vector database. Each research worker makes an independent search-backed LLM request to Exa. They can investigate public information; arbitrary shell execution, bookings, messages, and recursive delegation are outside their tool set. The primary voice agent can separately make outbound verification calls.

Research has an 11-second per-worker deadline, with an 18-second aggregate ceiling. The application caps workers at five per invocation; provider-internal searches and billing are controlled by Exa. Citation links accompany the result. Several workers citing one page do not create independent evidence. Retrieval time does not prove a location is open or has supplies right now.

## Activation

Use the **main project folder**, `/Users/kevinpoopz/Documents/ChatGPT/DUAL-USC-HACKATHON`.

1. Complete the Exa Marketplace account step at [Vercel's terms acceptance page](https://vercel.com/k-4b60/~/integrations/accept-terms/exa?source=cli). Installation currently requires this step. Then retry `npx --yes vercel@latest integration add exa --non-interactive --no-claim` and connect the resource to the intended Vercel project. Pull the server-side `EXA_API_KEY` into the project environment. A pre-existing Exa key can also be supplied.
2. Create `.env.local` from `.env.example` and configure `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_FROM_NUMBER`, `EXA_API_KEY`, `VOICE_PUBLIC_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Set `MOCK_RETELL=false`. Keep secrets out of `NEXT_PUBLIC_` variables.
3. Apply **only** `supabase/voice-actions.sql` to the existing Heartbeat database. It adds a private action table and atomic claim function. The older `schema.sql` drops existing tables and must not be used as this migration.
4. Serve the app at `VOICE_PUBLIC_URL`, a public HTTPS origin. A local tunnel can point to `npm run dev`. Retell calls `/api/retell/tools` for functions and `/api/retell/webhook` for call events.
5. Run `npm run voice:configure` to inspect the planned configuration. It reads the existing Retell agent, preserves its prompt and unrelated tools, and reports a summary without secrets. `npm run voice:configure -- --apply` applies the managed tools, prompt, dynamic-variable defaults, and event webhook to its editable draft. Published versions are read-only: create/review an editable draft and publish it in Retell to activate changes on the number's agent.
6. Set `VOICE_OUTBOUND_CONTACTS` to a JSON array of real approved contacts with `id`, `name`, E.164 `phone`, and optional `description`. An empty directory disables outbound contact selection. If using `RETELL_DELEGATE_AGENT_ID`, configure that agent too with `npm run voice:configure -- --agent-id=YOUR_DELEGATE_AGENT_ID --apply`; its delegated-role prompt is required. Otherwise the primary agent handles delegated calls using the supplied task and initial message.
7. Run `npm run voice:verify`. It checks real Retell configuration, database access, a public Exa search, and the public endpoint's signature authentication. It never dials a phone. A controlled, caller-authorized phone call is still required to verify speech, live tool invocation, and recipient handoff end to end.

For the current CLI, use `npm i -g vercel@latest`; the installed global CLI is 51.2.0 and lacks some integration options. No public deployment has been performed by this change.

## Call behavior

A caller might ask, “Can you find the latest official notice about the water pickup address and check for conflicting updates?” The voice agent calls `delegate_research` with three workers, receives cited individual findings, and explains any unknowns.

If the caller then asks for a verification call, the agent uses `list_contacts`, confirms the recipient and public question, and invokes `call_contact`. The child call identifies itself as an automated assistant and asks that question. Its initial greeting is overridden with the delegated task, and server-side depth checks prevent it from spawning more agents or calls. No private client record or full caller transcript is submitted to the internet research service.

The outbound action is reserved in Supabase before dialing. A transaction serializes claims per parent call, deduplicates normalized contact/purpose pairs, and caps total outbound attempts at five. The provider also receives the action ID as its documented idempotency key. Provider timeouts remain `unknown` because the request may have been accepted; an uncertain call is never automatically redialed. Signed call webhooks and polling store recipient responses. A finished telephone call does not establish that supplies, transportation, or another real-world action were provided.

## Verification and current limits

Completed local verification: **77 tests passed**, full main-app TypeScript check passed, ESLint passed, and the production build passed with `/api/retell/tools` included. A live readiness run returned the exact missing configuration names and made no provider requests.

`npm run test:voice` exercises real implementation boundaries with isolated transport/storage fixtures: signed and tampered Retell payloads, 3–5 worker concurrency, timeouts, partial results, missing citations, authorized contacts, persistent claim behavior, duplicate suppression, ownership, and incomplete calls. These are automated tests, not live provider evidence. `npm run typecheck`, `npm run lint`, and `npm run build` check the main application; the separate clinical and crisis apps use their own project configurations.

At implementation time, the main project's Retell, Exa, public URL, and Supabase credentials were unavailable. Exa provisioning stopped at required account terms. No migration, remote agent update, live search, phone call, or deployment has been claimed as completed. The existing Heartbeat classification, escalation ladder, and SMS skeleton retain their separate TODOs; these research/calling tools do not establish the complete home-care check-in workflow.

The unfinished check-in classifiers now return `needs_human` instead of a fabricated `ok`; unanswered or voicemail calls remain `no_answer`. This provides truthful status while the broader check-in workflow is completed.

API references: [Retell custom functions](https://docs.retellai.com/build/single-multi-prompt/custom-function), [Retell create phone call](https://docs.retellai.com/api-references/create-phone-call), [Exa answer](https://exa.ai/docs/reference/answer).
