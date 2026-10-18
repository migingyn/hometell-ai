# LA demo verification

Checked locally on October 17, 2026.

- All 24 inherited engine, relocation, and prepared-audio tests passed with LA coordinates and audio assets.
- TypeScript and the Vite production build passed.
- All 11 regenerated MP3 files decoded successfully, contained non-silent audio, and fit their cue windows.
- Browser checks exercised launch, report selection, seek, verification audio, manual approval, the next caller's answer, presenter approval, scenario notes, and reset.
- Seeking beyond review stopped at 01:50 until approval. The final answer contained the LA address, destination, and former site. Rewind/reset cleared publication.
- Verification audio loaded the correct LA recording and advanced during playback. Captions and the approved answer matched the prepared recording manifest.
- Desktop screenshots were checked at 1440×900 and 1920×1080. The review action was within the visible panel. The relocation note did not overlap the destination beacon; the final camera excluded the former site's clipped label.
- No application page errors were observed during the browser workflow.
- LA and scenario-notes URLs returned HTTP 200 on port 5175. The original app remained available on port 5174.

Screenshots are stored locally under `output/playwright/` and excluded from Git. The LA stylesheet and theme were copied from the existing demo, including its latest compact-height panel adjustment. Only the LA copy's geography, scenario content, camera framing, audio, and documentation were changed.

Satellite imagery and terrain remain external services. This check establishes prepared demo behavior, not a live emergency information workflow or an offline map guarantee.

## Camera evidence addition

Browser checks passed for both local camera assets, frame availability at 00:20 and 01:15, automatic frame selection, manual switching, expanded inspection, side-by-side comparison, and map/report linking. The inspector preserves an existing pause and pauses/resumes active playback correctly; Escape closes it. Rewind removes unavailable frames, and camera interaction cannot bypass the approval gate. Hiding the layer clears camera focus and removes its pins.

The camera dock clears the answer captions at 1440×900. Comparison and compact inspection were checked at 1920×1080, 1024×768, and 390×844; no horizontal overflow or application page errors were observed. All 24 existing tests and the production build passed after the addition. Camera screenshots are under `output/playwright/cctv-*`.

## Neural voice update

The LA edition now uses the same Kokoro voice cast and playback controller as the upgraded Asheville edition. Seven LA-specific recordings were rendered and four identical lines reused. All eleven clips use content-hashed filenames, natural synthesis speed, and balanced levels. Captions, review quotations, and the approved answer match the LA dialogue.

- `npm test`: 36 passed.
- `npm run build`: passed.
- `python3 scripts/render-audio.py --check`: all eleven files decoded with valid levels and timing margins.
- Browser replay with a 650 ms main-thread stall: all six verification clips reached their natural end, with zero audio-position writes during the conversation.
- Opening the camera inspector held audio at exactly 1.171288 seconds; closing it resumed speech.
- The review gate paused speech; approval enabled the LA answer naming 1000 Vin Scully Avenue and Dodger Stadium. Mute/unmute worked, and rewinding removed the approved answer. No page errors were observed.

No runtime speech service or new application dependency was added. Camera illustrations and LA map behavior were preserved.
