# Heartbeat disaster demo

One agency, the same enrolled patients, two situations. The operations desk connects the LA map to a ranked patient queue and exact recorded evidence. The Clinically Speaking reference informed the visible conversation → evidence → human-action workflow.

## Open and present

Open **http://127.0.0.1:3018/** and press **Play disaster demo**. It runs six saved stages in roughly 40 seconds; pause or use **Next** to narrate at your own pace. Reloading restores the saved replay paused.

1. **Calls begin:** eight fictional agency patients appear on the LA map.
2. **Listen and prioritize:** Evelyn calmly describes serious danger. Marcus expresses panic while reporting that he is at a shelter with food and water. Evelyn ranks first; severity and distress remain separate.
3. **Transport needs:** select Rosa. Her earlier daily check-in already recorded a need for a ride. Daniel reports a power loss affecting his oxygen equipment. Humans decide the response.
4. **Retry outreach:** Harold does not answer. No answer never becomes a reassuring result.
5. **Reach a contact:** the replay records retry/text stages and an emergency-contact attempt.
6. **Human handoff:** Evelyn has a simulated transfer record. Harold remains unreachable and open for human review. Before operator actions, the summary shows eight patients, five needing human attention, four with recorded transport needs, and one not reached.

Click **Transport assistance** to filter the queue and map together. Click a pin to open that patient. **Evidence** shows the exact quotes, prior care context, and saved transcript; **Follow-up** shows contact attempts and the handoff record. **Mark handled** records operator follow-up and updates the queue. It does not dispatch anyone.

Switch to **Daily care** to show the same eight patients and their earlier eight-question post-op check-ins. Switch back to **Crisis response** to continue the same replay. Mode switching does not make calls.

**Export assistance list** downloads a CSV for human review. Demo exports include simulation labels, event identifiers, recorded transport needs, and unreachable status. Nothing is sent to officials automatically.

## What is running

- Main dashboard: Next.js on port **3018**.
- Existing LA satellite map: Vite in `crisis-la` on port **5175**, embedded into the dashboard.
- Shared records: the existing local Supabase database. The replay writes actual saved checks and call logs through the existing classifier and result-handling path.

If the servers need restarting, run these in separate terminals:

```sh
npm run dev -- --hostname 127.0.0.1 --port 3018
```

```sh
npm --prefix crisis-la run dev -- --port 5175
```

The map URL is configured by `NEXT_PUBLIC_HEARTBEAT_MAP_URL`; the local value points to `http://localhost:5175/heartbeat`. Keep the map server and local Supabase running. If imagery or the embedded map is unavailable, the dashboard has an explicitly labeled coordinate-view fallback.

## Demo boundaries

The replay requires `MOCK_RETELL=true` and a local Supabase URL. It makes no phone calls, sends no texts, and dispatches no help. Its saved transcript and transfer events are simulated, not a live audio stream or proof of a real nurse connection. Patient coordinates are fictional; satellite imagery is present-day imagery, not a live disaster boundary or evacuation route.

Each new **Replay** creates its own eight fictional clients and paired daily/crisis events. Retries reuse the same session. Ordinary outreach uses the full enrolled roster, including retained local demo patients; keep this database in mock mode for the presentation.

Verification: `npm run test:heartbeat`, `npm run test:voice`, `npm run typecheck`, `npm run lint`, `npm run build`, map embedding tests/build, and `npm run verify:disaster` against the running local app. The disaster verifier owns and removes only its own fixtures.
