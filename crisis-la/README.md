# SourceCheck / Los Angeles Crisis Replay

A separate LA edition of the Asheville demo, preserving its layout, typography, colors, six chapters, directed satellite camera, report interactions, review gate, and prepared audio playback.

**Hurricane Rachel is a fictional stronger-storm exercise.** The story imagines flooding, wind damage, and power failures across Los Angeles and nearby communities. Real facility names are geographic anchors only; all damage, aid operations, conversations, and the relocation are invented for the demonstration.

## Run locally

```sh
cd crisis-la
npm ci
npm run dev
```

Open **http://127.0.0.1:5175**. This version uses a strict, separate port so it can run beside the Asheville version on port 5174. No API keys are needed. Satellite imagery and terrain require network access.

The separate **consumer prescription case room** is at [http://localhost:5175/prescription](http://localhost:5175/prescription). It adds an 80-second replay, evidence-linked handoffs, a case-reopening intervention, and live participant source rooms. Start the main-folder backend with `npm run dev:prescription` for live rooms. See [the runbook](../docs/PRESCRIPTION_DEMO.md).

## Demo story

1. Fly into LA as prepared reports arrive from Santa Monica, the LA River, Pasadena, East LA, South LA, and downtown.
2. Focus on a resident asking whether water pickup remains at John Marshall High School.
3. Play a prepared coordinator conversation: flooding closed that pickup operation; distribution has moved to a parking area at Dodger Stadium.
4. Review the proposed address and approve it.
5. Watch the map and next caller's answer update together. Closing time remains unconfirmed.

The six chapters keep the original 02:55 timeline, plus manual review. Presenter autoplay, seek, pause, speed, replay, captions, and sound controls behave as in the original. The LA script uses the same Kokoro neural voices as the Asheville edition, with conversational wording, balanced volume, and pauses fitted to the recordings. Speech plays from local MP3s; no voice-service connection or API key is needed.

```sh
npm test
npm run build
npm run preview -- --port 5175 --strictPort
python3 scripts/render-audio.py --check
```

Scenario text and coordinates live in `src/scenario.ts`; camera choreography is in `src/camera.ts`. `src/styles.css` and `src/theme.ts` retain the original presentation; the camera-evidence feature adds styles in `src/cctv.css`. The copy is independent: later edits to Asheville do not automatically change this version.

See [scenario and geography notes](docs/SOURCES.md), [audio inventory](docs/AUDIO_ASSETS.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Camera evidence

Two generated camera stills add visual context: a flooded school entrance and stadium supply staging. The panel appears at 00:20; the stadium frame becomes available at 01:15. Choose a camera with its tab or map pin, expand the image, locate its related report on the map, or compare both sites after the second frame arrives. Inspecting a larger view pauses playback and resumes it on close when it was previously playing.

Capture times and frame ages use the scenario clock. The stills are explicitly labeled **SIMULATED FRAME** and never publish an answer. Phone statements and supervisor approval remain the source of pickup details. The camera layer can be hidden, and narrow viewports use a compact inspector. See [asset prompts and provenance](docs/CAMERA_ASSETS.md).
