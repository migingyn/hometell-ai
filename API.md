# Heartbeat API

The frontend builds against this. Keep it exact.

- Base URL `http://localhost:3000`. CORS allows `FRONTEND_ORIGIN` (default `http://localhost:5173`) on `/api/*`.
- All JSON. Timestamps are ISO 8601. Booleans are `true`/`false`. Missing values are `null`.
- Errors return `{ "error": "message" }` with a 4xx or 5xx status.
- Ids are small integers (`clients.id`, `alerts.id`, `crisis_runs.id`). `call_id` is a string from Retell (`mock_...` in mock mode).

Enums

| Field | Values |
| --- | --- |
| `vitals_status` | `normal`, `watch`, `alert` |
| `card_status` | `red`, `yellow`, `green`, `gray` |
| `crisis_state` | `safe`, `needs_help`, `no_response`, `calling`, `not_reached` |
| `crisis_type` | `heat_wave`, `power_outage`, `wildfire`, `earthquake`, `flood` |
| alert `type` | `needs_nurse`, `danger`, `open_line`, `no_answer`, `allergy`, `dose_question`, `missed_med`, `flag_nurse`, `pain`, `crisis_needs_help`, `crisis_no_response`, `wellness` |
| alert `urgency` | `now`, `today` |
| call `status` | `registered`, `ongoing`, `ended`, `analyzed` |

Card colors

- **red.** Any open alert with urgency `now` (needs nurse, danger, open line, allergy, pain 7+, crisis needs help, crisis no response, urgent flag_nurse)
- **yellow.** Any other open alert (missed or unsure meds, dose question, no answer, pain 4 to 6, wellness), or vitals `watch`/`alert`
- **green.** Last call today was analyzed and nothing is open
- **gray.** No call yet today, a call in progress, or waiting for results

## GET /api/config

```json
{
  "agency_name": "Sunrise Home Care",
  "crisis_types": ["heat_wave", "power_outage", "wildfire", "earthquake", "flood"],
  "open_line_minutes": 4
}
```

## GET /api/clients

```json
[
  {
    "id": 2,
    "name": "Harold Kim",
    "preferred_name": "Harold",
    "room": "104",
    "aide_name": "James",
    "nurse_name": "Nurse Kim",
    "vitals_status": "alert",
    "card_status": "red",
    "card_reason": "Pain 8, hip",
    "last_call_at": "2026-10-17T16:02:11.000Z",
    "last_pain_level": 8,
    "last_mood": "good",
    "open_alert_count": 1
  }
]
```

## GET /api/clients/:id

`trend` always has 7 entries, oldest first. A day with no analyzed call has nulls.

```json
{
  "client": {
    "id": 2,
    "name": "Harold Kim",
    "preferred_name": "Harold",
    "room": "104",
    "phone": "+15550000002",
    "aide_name": "James",
    "nurse_name": "Nurse Kim",
    "allergies": "shellfish",
    "personal_note": "Retired bus driver. Hip replacement last spring.",
    "vitals_ranges": { "bp_sys": { "min": 110, "max": 160 }, "spo2": { "min": 92, "max": 100 } },
    "created_at": "2026-10-17T15:00:00.000Z"
  },
  "today_entry": {
    "id": 2,
    "client_id": 2,
    "date": "2026-10-17",
    "bp_sys": 168,
    "bp_dia": 92,
    "heart_rate": 84,
    "temp_f": 98.6,
    "spo2": 95,
    "vitals_watch_note": "BP high this morning. Ask about headache or blurry vision.",
    "med_schedule_now": "Morning: amlodipine 5 mg. Take with water.",
    "entered_by": "Nurse Kim",
    "created_at": "2026-10-17T15:00:00.000Z"
  },
  "vitals_status": "alert",
  "card_status": "red",
  "card_reason": "Pain 8, hip",
  "last_calls": [
    {
      "call_id": "mock_5d1c...",
      "client_id": 2,
      "call_type": "daily",
      "crisis_type": null,
      "crisis_run_id": null,
      "status": "analyzed",
      "started_at": "2026-10-17T16:02:11.000Z",
      "ended_at": "2026-10-17T16:03:51.000Z",
      "duration_sec": 100,
      "disconnection_reason": "user_hangup",
      "summary": "Resident reports hip pain at 8 out of 10.",
      "sentiment": "Negative",
      "call_successful": true,
      "feels_ok": "no",
      "danger_words_heard": false,
      "med_taken": "yes",
      "allergy_item_mentioned": false,
      "dose_question_asked": false,
      "needs_nurse": false,
      "needs_nurse_reason": "My hip. It's bad.",
      "new_personal_fact": null,
      "answered_by": "client",
      "pain_level": 8,
      "pain_location": "hip",
      "sleep_quality": "good",
      "ate_and_drank": "yes",
      "steady_on_feet": "yes",
      "mood": "good",
      "new_swelling": false,
      "crisis_status": "not_crisis",
      "transcript": "Agent: Any pain today?\nUser: My hip. It's bad.",
      "created_at": "2026-10-17T16:02:09.000Z",
      "updated_at": "2026-10-17T16:03:54.000Z"
    }
  ],
  "open_alerts": [
    {
      "id": 7,
      "client_id": 2,
      "call_id": "mock_5d1c...",
      "type": "pain",
      "urgency": "now",
      "message": "Pain 8, hip",
      "quote": "My hip. It's bad.",
      "created_at": "2026-10-17T16:03:54.000Z",
      "acknowledged_at": null,
      "acknowledged_by": null
    }
  ],
  "trend": [
    { "date": "2026-10-11", "pain_level": null, "mood": null, "sleep_quality": null },
    { "date": "2026-10-17", "pain_level": 8, "mood": "good", "sleep_quality": "good" }
  ]
}
```

## POST /api/clients/:id/entries

Body. Every field is optional. Saving again replaces today's entry.

```json
{ "bp_sys": 132, "bp_dia": 84, "heart_rate": 78, "temp_f": 98.4, "spo2": 96, "vitals_watch_note": "Ask about ankle swelling.", "med_schedule_now": "Morning: metformin 500 mg with breakfast.", "entered_by": "Nurse Kim" }
```

Returns the saved entry.

```json
{ "id": 6, "client_id": 5, "date": "2026-10-17", "bp_sys": 132, "bp_dia": 84, "heart_rate": 78, "temp_f": 98.4, "spo2": 96, "vitals_watch_note": "Ask about ankle swelling.", "med_schedule_now": "Morning: metformin 500 mg with breakfast.", "entered_by": "Nurse Kim", "created_at": "2026-10-17T16:10:00.000Z" }
```

## POST /api/clients/:id/call

Body `{ "call_type": "daily" | "crisis", "crisis_type": "heat_wave" }`, both optional (default `daily`). A crisis call joins the active run. Returns 502 if Retell refuses the call.

```json
{ "call_id": "call_8f2e1a..." }
```

## GET /api/calls?limit=20

Latest calls, newest first, with `client_name` and `room`. Same fields as `last_calls` above.

```json
[
  { "call_id": "call_8f2e1a...", "client_id": 1, "client_name": "Margaret Ellis", "room": "101", "call_type": "daily", "status": "ongoing", "started_at": "2026-10-17T16:12:00.000Z", "summary": null, "pain_level": null, "...": "..." }
]
```

## GET /api/alerts?open=true

Open alerts sorted: `crisis_no_response` first, then other urgency `now`, then `today`, newest first in each group. `open=false` returns the latest 100 alerts of any state, newest first.

```json
[
  { "id": 9, "client_id": 3, "client_name": "Rosa Alvarez", "room": "112", "call_id": "mock_...", "type": "crisis_no_response", "urgency": "now", "message": "CRISIS. No response. Send staff to Room 112 now.", "quote": "CRISIS NO RESPONSE. Send staff to the room now.", "created_at": "2026-10-17T16:20:05.000Z", "acknowledged_at": null, "acknowledged_by": null },
  { "id": 8, "client_id": 1, "client_name": "Margaret Ellis", "room": "101", "call_id": "mock_...", "type": "missed_med", "urgency": "today", "message": "Missed meds", "quote": "Morning: lisinopril 10 mg with breakfast. Evening: none.", "created_at": "2026-10-17T16:05:00.000Z", "acknowledged_at": null, "acknowledged_by": null }
]
```

## POST /api/alerts/:id/ack

Body `{ "by": "Front desk Ana" }`. Returns the updated alert.

```json
{ "id": 9, "client_id": 3, "call_id": "mock_...", "type": "crisis_no_response", "urgency": "now", "message": "CRISIS. No response. Send staff to Room 112 now.", "quote": null, "created_at": "2026-10-17T16:20:05.000Z", "acknowledged_at": "2026-10-17T16:21:00.000Z", "acknowledged_by": "Front desk Ana" }
```

## POST /api/crisis/start

Body `{ "crisis_type": "heat_wave" }`. Ends any open run, opens a new one, and starts calling everyone (vitals `alert` first, then `watch`, then `normal`, about 2 seconds apart). Returns before the calls finish.

```json
{ "run": { "id": 3, "crisis_type": "heat_wave", "started_at": "2026-10-17T16:20:00.000Z", "ended_at": null } }
```

## POST /api/crisis/end

Returns 404 if no run is active.

```json
{ "run": { "id": 3, "crisis_type": "heat_wave", "started_at": "2026-10-17T16:20:00.000Z", "ended_at": "2026-10-17T16:45:00.000Z" } }
```

## GET /api/crisis/current

With no active run: `{ "run": null, "counts": { all 0 }, "residents": [] }`.

```json
{
  "run": { "id": 3, "crisis_type": "heat_wave", "started_at": "2026-10-17T16:20:00.000Z", "ended_at": null },
  "counts": { "safe": 1, "needs_help": 1, "no_response": 2, "calling": 1, "not_reached": 0 },
  "residents": [
    { "client_id": 2, "name": "Harold Kim", "room": "104", "crisis_state": "needs_help", "quote": "It's hot in here, no water", "last_update_at": "2026-10-17T16:20:09.000Z" },
    { "client_id": 4, "name": "Walter Brooks", "room": "118", "crisis_state": "calling", "quote": null, "last_update_at": "2026-10-17T16:20:20.000Z" }
  ]
}
```

## GET /api/events

Server-Sent Events. Each event has a name and JSON `data`. A `: heartbeat` comment comes every 20 seconds.

```js
const es = new EventSource("http://localhost:3000/api/events");
es.addEventListener("alert", (e) => console.log(JSON.parse(e.data)));
```

| Event | Data |
| --- | --- |
| `alert` | `{ alert, client }` |
| `alert_ack` | `{ alert_id, acknowledged_by }` |
| `call` | `{ call }` (no raw_json) |
| `client_status` | `{ client_id, card_status, card_reason }` |
| `crisis` | `{ run, residents }` |

```
event: client_status
data: {"client_id":2,"card_status":"red","card_reason":"Pain 8, hip"}
```

The stream lives in one Node server. If the backend runs on more than one instance (Vercel), subscribe to Supabase Realtime on `calls`, `alerts`, and `crisis_runs` instead.

## Demo endpoints

### GET /api/mock/scenarios

```json
{
  "daily": ["ok", "dizzy", "missed_med", "dose_question", "allergy", "pain_high", "pain_mid", "low_mood_not_eating", "voicemail", "open_line"],
  "crisis": ["crisis_safe", "crisis_needs_help", "crisis_silent", "crisis_no_answer"]
}
```

### POST /api/mock-webhook

Body `{ "client_id": 2, "scenario": "pain_high" }`. Creates a mock call and replays `call_started`, `call_ended`, and `call_analyzed` through the real webhook code, about 1.5 seconds apart. Crisis scenarios join the active run. Returns right away.

```json
{ "call_id": "mock_5d1c...", "scenario": "pain_high" }
```

### POST /api/mock-crisis

Body `{ "crisis_type": "heat_wave" }`. Starts a run and plays one scenario per resident 2 to 3 seconds apart: needs help, silent, no answer, safe, still calling.

```json
{ "run": { "id": 4, "crisis_type": "heat_wave", "started_at": "2026-10-17T16:30:00.000Z", "ended_at": null } }
```

### POST /api/watchdog/tick

Runs one watchdog pass now. The server also runs it every 30 seconds. `synced` counts calls replayed from Retell because a webhook was missed.

```json
{ "open_line": 1, "never_started": 0, "synced": 0 }
```

## Retell endpoints (not for the frontend)

| Path | Who calls it |
| --- | --- |
| `POST /retell-webhook` | Retell agent webhook. Returns 204 |
| `POST /retell/functions/flag-nurse` | `flag_nurse` custom function. Returns `{ "result": "Nurse has been alerted." }` |
| `POST /retell/functions/lookup-client` | Optional custom function. Returns `{ name, preferred_name, room, allergies, med_schedule_now, vitals_status }` |

All three check `x-retell-signature` unless `SKIP_SIGNATURE_CHECK=true`.
