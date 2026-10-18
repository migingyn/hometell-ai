# Heartbeat: one care and outreach workspace

The destination application remains the Next.js app on port **3017**, on branch `experiment`. The separate source checkout on 5173 is unchanged. All imported care screens now use the original 3017 navy header/navigation, Geist font, spacing, neutral panels and teal/coral controls via `components/operations/tokens.css`. The former green navigation shell and schematic facility map have been replaced.

## Journeys

- `/login` accepts any nonempty fictional email/password. Neither credential is stored, logged or transmitted. Only a demo role/fixed display name and selected facility are kept in sessionStorage. Logout clears them.
- Administrator login opens `/facilities`: the original Cesium satellite renderer now supports three fictional LA facilities. Selecting a pin or card previews the facility; **Open facility dashboard** explicitly selects its scope. Direct workspace URLs redirect back here until a facility is selected. The header keeps the selected facility and **Switch facility** visible.
- Nurse login opens `/my-day` for Hollywood House. Assigned residents, measurements due, calls requiring review and assigned follow-ups are prioritized.
- `/overview`, `/residents`, `/daily-rounds`, `/record-vitals`, `/outreach`, `/crisis`, `/calls`, `/follow-ups`, `/operations`, `/team` and `/settings` are dedicated routes with role-appropriate navigation. `/locations` redirects to the facility selector.
- Map/queue/directory selections share `ResidentDetail`. Its query-backed dialog supports browser back/forward and refresh; `/residents/[id]` uses that same record as a dedicated page. Measurements, calls/evidence, follow-ups and care notes are tabs within the record.

## Data

`CareProvider` reads one `/api/care/workspace` snapshot. The existing Supabase roster, checks, call logs, classifier, Retell/webhook path, retry ladder, nurse review and transport flags remain connected. New additive migrations through `202610170010_care_staff_assignments.sql` persist measurements/corrections, notes/reminders, staff-linked tasks, planning schedules/settings, and historical pre-call snapshots.

Measurements retain values, explicit units, source, author, measurement time and entry time. Corrections append entries and preserve originals. Missing readings are unknown; no clinical thresholds are configured by default. Current measurements and reminders inform a subsequent call snapshot, while prior snapshots remain unchanged. Acknowledgement does not resolve a care concern. Tasks share resident and staff IDs across profiles, My Day, Team and Follow-ups.

The interactive Cesium renderer remains served on 5175 and embedded in the single 3017 application. Both the existing patient map and the new facility selector retain real pan/zoom/pin interactions and satellite imagery. Its geographic fallback is used only when imagery/WebGL fails. No satellite view has been replaced with a static image.

This is a frontend demo login, not production authentication. The existing local-demo adapter guard remains; no production authentication or authorization was added. Calling mode comes from existing server configuration; the current local setup remains explicitly mocked. Planning schedules persist but do not execute automatically. Provider readiness is shown in Settings/Operations without implying verified live calls or texts.

## Verification

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:heartbeat`, `npm run test:voice`, `npm run verify:care`, and the crisis-la build/test suite. Run the six-stage replay verifier with `DISASTER_DEMO_APP_URL=http://127.0.0.1:3017 DISASTER_DEMO_FACILITY_ID=pasadena npm run verify:disaster` to also check facility membership. Integration tests remove only their own fixtures.
