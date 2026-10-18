# Heartbeat product scope

## Product and users

Heartbeat is a phone check-in desk for a Medicare-certified clinical home-health agency's enrolled patients. The same roster receives post-operative morning check-ins and coordinator-triggered crisis outreach. The nurse or coordinator uses one website; patients and their listed emergency contacts use regular telephones. See the current [one-page plan](docs/POSTOP_PLAN.md) and [customer note](docs/HOME_HEALTH_CUSTOMER_NOTE.md).

The product records reported needs and ensures unresolved outreach reaches a person. It does not judge medical conditions, decide whether someone should evacuate, assure anyone they are safe, or dispatch emergency services. Hackathon display identities and map points are fictional; real dialing requires consenting teammates' private numbers.

## Two modes

| Behavior | Daily check-in | Crisis check |
| --- | --- | --- |
| Start | **Run morning check-ins** | **Start crisis check**, with required alert text |
| Agent task | Confirm patient identity and consent; ask pain 0–10, incision, fever, breathing, appetite, weight, medications, and falls | Read the coordinator's alert word for word, then ask whether the person is okay and needs help leaving |
| Record | Structured answers with exact patient quotes, changes since the last call, and a proposed next step for a nurse to approve | Reported needs, evacuation-help flags, and patients not reached |
| Phone handoff | Fixed on-call nurse destination; private summary → three-way intro → AI leaves | Same optional warm-transfer tool; human decides the response |
| Routine request | Amber **Follow up**; no immediate coordinator text | Urgent **Needs a human now** and coordinator text |
| Hard-rule danger phrase | Urgent **Needs a human now** and coordinator text | Same |
| No pickup | Retry → client text → emergency contact → human handoff | Same |

`daily` and `crisis` are canonical event modes; legacy `heat_wave` is treated as crisis. Daily danger reports remain urgent even though ordinary daily requests are follow-ups. Terminal unreachable cases notify the coordinator in either mode.

## Call outcomes and hard rules

Hard rules inspect structured `transcript_object` turns whose role is `user`; when unavailable, they parse `User:` transcript lines. Agent speech and untagged text cannot trigger a match. English matching handles word boundaries, case, and curly apostrophes.

Both modes match `chest pain`, `can't breathe`, `fell`, `fall`, `dizzy`, `confused`, and `emergency`. Crisis additionally matches `help`, `can't get out`, `can't leave`, and `trapped`. Narrow Korean phrase stems are also supported: shared danger phrases in both modes and help/blocked-exit phrases only in crisis. Flags retain the actual matched Korean phrase. These literal rules are not comprehensive language or medical interpretation.

Classification then follows this order:

1. A hard-rule hit always produces urgent `needs_human` and cannot be downgraded by post-call analysis.
2. Voicemail, no answer, busy, or a failed dial produces `no_answer`.
3. A client call uses explicit `client_status`: crisis `ok` → `ok`; `needs_help` → `needs_human` with the request; missing or `unclear` → `needs_human` for review. Answered daily patient calls record a post-op assessment and remain `needs_human` with `follow_up` urgency until a person handles them. Crisis concerns use `urgent`.
4. An emergency-contact call becomes `ok` only when `contact_confirms_ok` is the boolean `true`. Its summary names the confirming contact. Otherwise it remains `no_answer`.

The summary comes from Retell's call analysis; a connected call or positive summary alone cannot establish wellbeing. `CLASSIFIER=retell` is the default. The legacy `llm` selector uses the same structured Retell evidence; there is no separate model provider or `LLM_API_KEY` requirement in the implemented path.

## No-pickup ladder

Only an unanswered, unhandled check can advance.

| Step | Action | Result |
| --- | --- | --- |
| 0 | Initial client call | Await its analyzed result |
| 1 | Retry the client | Save the new call ID and await its webhook |
| 2 | Text the client | Keep the check unanswered and schedule the next step |
| 3 | Call the listed emergency contact | Await explicit confirmation or continue unanswered |
| 4 | Flag `unreachable` and text the coordinator | Urgent human handoff; no further automatic steps |

Each waiting interval is five minutes multiplied by `DEMO_TIME_SCALE`; `0.05` produces about 15 seconds. Daily texts contain the missed-check-in callback request. Crisis texts preserve the supplied alert and append the missed-call callback request.

Action claims prevent concurrent ticks from dispatching a step twice. Old call IDs and duplicate analyzed-call results cannot overwrite the current attempt. **Mark handled** wins over late results. A claim abandoned for more than three minutes becomes an urgent uncertain-outcome handoff without automatic redial. SMS errors do not prevent check status from being saved; the dashboard shows a sent/acceptance, simulated, missing-configuration, or failure note.

## Planning and Korean agents

Daily client analysis may explicitly update `needs_ride`; a missing field does not clear a previous need and emergency contacts cannot overwrite it. The daily result also updates `last_daily_at`. Crisis ordering uses risk tier first, then ride need, living alone, and name; daily ordering uses risk tier and name.

Clients have a requested language. English daily/crisis agents and optional Korean variants use dedicated IDs; the generic research agent is not a fallback. Missing Korean IDs fall back to the corresponding English agent. Korean introductions and questions do not translate or alter the coordinator's alert. Prompts disclose automation, avoid advice, end clearly, and use six-minute daily and three-minute crisis limits. The setup script creates or updates drafts; publishing and real-phone rehearsal remain separate steps. Exact prompts and analysis schemas are in [RETELL_AGENTS.md](docs/RETELL_AGENTS.md).

Reported severity and expressed distress remain separate. The human-review queue orders severity first; distress advances a person only within the same severity tier. Calm speech never establishes that someone is well. Missing evidence stays unknown.

Post-op extraction accepts complete attributed patient turns and requires patient-identity evidence. Missing or unsupported answers stay unknown; comparison gaps are shown explicitly. Nurse approval is tied to the exact call and saved atomically; it does not mark the case handled or arrange care. Transfer callbacks cannot clear a concern, and failed or unconfirmed transfers remain open. Retell human detection confirms someone answered the destination line, not that person's identity.

## Dashboard and map

The main dashboard runs locally at [localhost:3017](http://localhost:3017). It shows mode, risk, requested language, ride need, status, summaries, flags, ladder progress, SMS notes, and source update time. Urgent cards are red; ordinary daily follow-ups are amber. Crisis urgent cards pulse. **Advance (demo)** is available only in explicit mock mode; **Mark handled** records the human handoff.

Supabase Realtime drives updates, with three-second polling when the channel fails. The open dashboard sends the five-second ladder tick; no hosted scheduler is configured. Mock mode and fictional data remain visibly labeled.

The P1 LA map is a separate read-only surface at [localhost:5175/heartbeat](http://localhost:5175/heartbeat), using approximate fictional locations and current roster/check status. Its end-to-end verification is pending. Existing SourceCheck replay routes are preserved.

## Data model and access

| Record | Fields used by Heartbeat |
| --- | --- |
| `clients` | `id`, fictional `name`, private `phone`, `risk_tier`, `lives_alone`, `uses_powered_equipment`, listed emergency-contact name/private phone, `usual_pickup_time`, `language`, `needs_ride`, `last_daily_at`, nullable fictional `lat`/`lng` |
| `events` | `id`, `type`, `alert_text`, `started_at`, unique nullable `request_id`, `dispatching` |
| `checks` | Client/event IDs, `status`, `ladder_step`, `next_action_at`, `last_call_id`, `summary`, `flag_reason`, nullable `urgency`, `sms_status`, `handled_at`, `updated_at`, internal `action_token`/`action_started_at` |
| `call_logs` | Check ID, unique Retell call ID, target, outcome, transcript, raw payload, creation time |
| `clients_public` | Read-only dashboard projection with fictional identities and planning fields; no telephone columns |

Statuses are `queued`, `calling`, `ok`, `needs_human`, `no_answer`, and `handled`. Urgency is `urgent`, `follow_up`, or null. Anonymous base-roster reads return no rows; server code uses the service role. Additive migrations live in `supabase/migrations/`. Default seeding preserves existing data; `--replace` is an explicit rehearsal reset.

## HTTP contract

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Database/configuration and mock readiness; does not establish provider delivery |
| `POST /api/events/start` | Accept `{ type, alert_text?, request_id? }`; require crisis alert text; reserve one start and persist each requested call |
| `POST /api/retell/webhook` | Verify live signatures, classify analyzed calls, atomically save one result/log, then update SMS/planning notes |
| `POST /api/ladder/tick` | Recover abandoned claims and advance due unanswered checks |
| `POST /api/ladder/advance/:checkId` | Advance one unanswered check immediately |
| `POST /api/checks/:id/handled` | Record coordinator handling and clear the scheduled next step |
| `POST /api/checks/:id/postop-review` | Record `{ call_id, reviewer }` approval for the current daily assessment; reject stale or handled records |

Routes return `{ ok: true, data }` or `{ ok: false, error }`. Reusing a start `request_id` returns its existing event. Overlapping roster dispatches are rejected. Call and SMS transport errors never become invented successful outcomes.

## Implementation and verification

The stack is Next.js 16 App Router, TypeScript, React, Tailwind/shadcn, Supabase Postgres/Realtime, Retell calls, and Twilio REST SMS. Credentials remain server-side. Dedicated check-in agents have no research/custom tools; Exa and delegated-contact tools are separate and not required for this product flow.

P0 passed against actual local Supabase and HTTP routes with simulated Retell payloads in both modes: okay, danger, daily follow-up, full due-time ladder, emergency-contact confirmation, handled/late results, duplicate/stale events, concurrent advancement, start idempotency, private-roster access, and abandoned-claim recovery. See [the runbook](docs/HEARTBEAT_RUNBOOK.md#verification) and `output/heartbeat/verification.json` for evidence and current test status.

The isolated post-op verifier tests actual local HTTP and Supabase persistence with fictional data: exact quotes, pain 3→7, unknown evidence, approval protections, and transfer outcomes. See `output/postop/verification.json`. Real Retell ringing, private whisper/bridge/AI exit, Korean phone conversations, verbatim alert playback over a real call, and Twilio delivery are not yet verified. Provider configuration and draft creation do not satisfy those acceptance criteria.

## Remaining limits and exclusions

This is a single-coordinator hackathon build without login, a hosted follow-up scheduler, inbound callback matching, multiple agencies, a client-editing UI, emergency dispatch, or medical/evacuation decisions. The coordinator remains responsible for human follow-up and provider review when outcomes are uncertain. Use [the runbook](docs/HEARTBEAT_RUNBOOK.md) for setup, rehearsal, and real-provider checks.
