# PRD. Heartbeat

> **Update 2026-10-17.** Scope changed to daily resident check-ins plus crisis mode, with no no-pickup ladder. The backend contract is `API.md` and the design is in `README.md`. The ladder, risk tiers, and `checks` table below are out of date.

## Context for coding agents

You are building a 24 hour hackathon MVP. Optimize for a working live demo, not production quality. Do not add features outside this document. Do not add auth, settings pages, or tests unless asked. Prefer simple code over clever code. When unsure, pick the option that is fastest to demo.

## Problem

Home care agencies cannot reach every senior client fast during a heat wave or blackout. Nobody calls first. Seniors living alone are found hours or days later.

## Solution

Heartbeat is an AI phone desk for home care agencies. A coordinator clicks one button. Heartbeat calls every client through Retell AI, highest risk first. Clients who answer and sound fine turn green. Clients who report danger get escalated to a human. Clients who do not answer climb a no-pickup ladder until a human takes over.

## Users

- **Coordinator.** Only user of the web app. Overnight staff at a home care agency.
- **Client.** Senior who receives phone calls. Never touches the app.
- **Emergency contact.** Family member who may receive a call in the ladder.

## Non-negotiable features

1. **Crisis trigger with risk-tiered batch calling**
2. **No-pickup ladder with voicemail counted as no answer**
3. **Live dashboard** showing who is okay, who is silent, and who needs a human

## Out of scope (do not build)

- Login or auth
- Daily reminder calls
- Decision Inbox broadcast
- Incident Stitcher
- Caregiver shift coverage
- Multiple agencies or tenants
- Editing clients in the UI (seed via script)
- Mobile layout polish

## Tech stack

- **Framework.** Next.js 14+ App Router, TypeScript
- **UI.** Tailwind CSS, shadcn/ui
- **Database.** Supabase Postgres with Realtime
- **Voice.** Retell AI (outbound calls, webhooks, post-call analysis)
- **SMS.** Twilio (or Retell SMS if confirmed working)
- **Classifier.** Pluggable. Default uses Retell post-call analysis. Optional LLM classifier behind the same interface
- **Hosting.** Vercel. ngrok for local webhook testing

## Data model (Supabase)

### clients
- id (uuid, pk)
- name (text)
- phone (text, E.164)
- risk_tier (text, one of red, yellow, green)
- lives_alone (bool)
- uses_powered_equipment (bool)
- emergency_contact_name (text)
- emergency_contact_phone (text, E.164)
- usual_pickup_time (time, nullable, display only for MVP)

### checks
One row per client per crisis event.
- id (uuid, pk)
- event_id (uuid, fk events)
- client_id (uuid, fk clients)
- status (text, see states below)
- ladder_step (int, 0 to 4)
- next_action_at (timestamptz, nullable)
- last_call_id (text, nullable, Retell call id)
- summary (text, nullable)
- flag_reason (text, nullable)
- handled_at (timestamptz, nullable)
- updated_at (timestamptz)

### events
- id (uuid, pk)
- type (text, e.g. heat_wave)
- started_at (timestamptz)

### call_logs
- id (uuid, pk)
- check_id (uuid, fk checks)
- retell_call_id (text)
- target (text, one of client, emergency_contact)
- outcome (text)
- transcript (text, nullable)
- raw (jsonb)
- created_at (timestamptz)

Enable Realtime on checks.

## Check states

- queued. Waiting to be called
- calling. Call in progress
- ok. Client answered and sounds fine (green)
- needs_human. Client reported danger or confusion (red)
- no_answer. Did not answer or voicemail (yellow, ladder active)
- handled. Coordinator marked it resolved

## No-pickup ladder

Applies only when status is no_answer.

| Step | Action | Delay after previous step |
| --- | --- | --- |
| 1 | Retry call to client | 5 min |
| 2 | Send SMS to client | 5 min |
| 3 | Call emergency contact | 5 min |
| 4 | Flag as needs_human with reason "unreachable" | 5 min |

Rules
- Voicemail always counts as no answer
- If the client answers at any step, run the classifier and set ok or needs_human
- If the emergency contact says the client is okay, set ok and store the summary
- Delays are multiplied by DEMO_TIME_SCALE (e.g. 0.05 makes 5 min about 15 sec)

## Classifier

Interface
- Input. Retell call payload (transcript, analysis fields, disconnection reason)
- Output. One of ok, needs_human, no_answer, plus a one-line summary and flag_reason

Implementations
- RetellAnalysisClassifier (default). Uses Retell post-call analysis fields and disconnection reason
- LLMClassifier (optional). Sends transcript to an LLM with a strict JSON schema

Select with env var CLASSIFIER=retell or CLASSIFIER=llm.

Hard rules run before any classifier. If the transcript contains chest pain, can't breathe, fell, fall, dizzy, confused, help, or emergency, set needs_human. Never let a model downgrade these.

## Retell agent script (crisis check)

Greeting. "Hi, is this {{name}}? This is Heartbeat calling for {{agency_name}} to check on you during the heat wave."

If wrong person. Ask if {{name}} is okay and if they can come to the phone. If not, end and mark needs_human with reason "wrong person answered".

Questions
1. Do you have air conditioning or a cool place to stay?
2. Do you have water nearby?
3. Are you feeling dizzy, sick, or confused at all?

Rules
- Never tell the client they are safe
- If they mention any danger sign, say a person from the agency will call them right away, then end the call
- Keep the call under 90 seconds

Dynamic variables. name, agency_name.

Verify in Retell docs. Voicemail detection setting, post-call analysis fields, disconnection reasons, transfer support, batch call API.

## API routes

- POST /api/events/start. Create event, create a checks row per client with status queued, then start calls in order red, yellow, green
- POST /api/retell/webhook. Receive call events. Write call_logs. Run classifier. Update check status and ladder fields
- POST /api/ladder/tick. Find checks where next_action_at <= now and run the next ladder step. Idempotent
- POST /api/ladder/advance/:checkId. Demo fallback. Run the next step immediately
- POST /api/checks/:id/handled. Mark handled

The dashboard calls /api/ladder/tick every 5 seconds while an event is active. No cron needed.

## Dashboard (single page at /)

Top bar
- Agency name
- Button "Start heat wave check"
- Active event timer

Four summary counters
- Okay (green)
- No answer (yellow)
- Needs a human (red)
- Handled

Client grid
- One card per client, sorted red tier first
- Card shows name, risk tier badge, status color, ladder step, last summary
- Red cards pin to top and pulse
- Buttons on red and yellow cards. "Advance" (demo) and "Mark handled"

Updates arrive through Supabase Realtime. No page refresh.

## Environment variables

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- RETELL_API_KEY
- RETELL_AGENT_ID
- RETELL_FROM_NUMBER
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_FROM_NUMBER
- COORDINATOR_PHONE
- CLASSIFIER (retell or llm)
- LLM_API_KEY (only if CLASSIFIER=llm)
- DEMO_TIME_SCALE (default 1, demo 0.05)
- AGENCY_NAME

## Seed data

Script at scripts/seed.ts. Ten clients using teammates' real phone numbers. Three red, four yellow, three green. Emergency contacts also teammates.

## Folder structure

- app/page.tsx. Dashboard
- app/api/events/start/route.ts
- app/api/retell/webhook/route.ts
- app/api/ladder/tick/route.ts
- app/api/ladder/advance/[checkId]/route.ts
- app/api/checks/[id]/handled/route.ts
- lib/supabase.ts
- lib/retell.ts
- lib/sms.ts
- lib/ladder.ts
- lib/classifier/index.ts
- lib/classifier/hardRules.ts
- lib/classifier/retell.ts
- lib/classifier/llm.ts
- components/ClientCard.tsx
- components/Counters.tsx
- scripts/seed.ts

## Acceptance criteria for demo

- [ ] Clicking start places real calls to all 10 seeded phones, red tier first
- [ ] A client saying "I feel dizzy" turns red within 10 seconds of hangup and the coordinator phone gets an SMS
- [ ] A declined or voicemail call turns yellow and climbs all 4 ladder steps on screen with DEMO_TIME_SCALE=0.05
- [ ] Emergency contact saying "she's fine" turns the card green
- [ ] Mark handled moves the card to the handled counter
- [ ] Dashboard updates live without refresh

## Fallbacks

- If live transfer to a human fails, send SMS to COORDINATOR_PHONE and pin the card red
- If Retell batch call fails, loop single create-phone-call requests
- If Realtime fails, poll checks every 3 seconds
- Record a full demo video by hour 20