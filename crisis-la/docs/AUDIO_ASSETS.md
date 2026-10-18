# Prepared local neural speech

These are synthetic scenario voices for the fictional Hurricane Rachel / Los Angeles replay, made locally with Kokoro-82M v1.0 through kokoro-onnx. They are not historical calls, voice clones, or the proprietary ChatGPT voice. Real Los Angeles place names are geographic anchors; the disaster, flooding, and aid operations are fictional. The browser plays prepared MP3 files only; no model, Python package, API, or speech-generation service runs in the application.

## Published inventory

11 mono 24 kHz MP3 clips, 600,495 bytes, 65.995 encoded seconds. Guide/Agent use `af_heart`, Caller uses `af_bella`, and Coordinator uses `am_michael`. Display text and final timing remain in [manifest.json](../public/audio/manifest.json).

4 clips reuse exact matching Kokoro speech byte-for-byte from the existing prepared set; the other 7 clips were rendered for the Los Angeles dialogue. Only the LA copies are published here; the original application assets are unchanged.

| Cue | Speaker / neural voice | Final replay window | Encoded duration | Published filename |
| --- | --- | --- | --- | --- |
| `mission-intro` | Guide / `af_heart` | 1–14 s | 10.150 s | `mission-intro-kokoro-v1-c5d8bf5371.mp3` |
| `resident-first-question` | Caller / `af_bella` | 14–23 s | 5.250 s | `resident-first-question-kokoro-v1-a26434b6a6.mp3` |
| `mission-question` | Guide / `af_heart` | 44–55 s | 7.350 s | `mission-question-kokoro-v1-db8853535e.mp3` |
| `verify-question` | Agent / `af_heart` | 65–71.8 s | 6.185 s | `verify-question-kokoro-v1-ddc96762d4.mp3` |
| `verify-address` | Coordinator / `am_michael` | 71.8–78.6 s | 6.200 s | `verify-address-kokoro-v1-6b880a0dd1.mp3` |
| `verify-former-site` | Coordinator / `am_michael` | 78.6–82.5 s | 3.250 s | `verify-former-site-kokoro-v1-c1685e87c2.mp3` |
| `verify-supplies` | Coordinator / `am_michael` | 82.5–86.3 s | 3.175 s | `verify-supplies-kokoro-v1-eb48b28e21.mp3` |
| `verify-hours-question` | Agent / `af_heart` | 86.3–93 s | 6.110 s | `verify-hours-question-kokoro-v1-e9367d764d.mp3` |
| `verify-hours-unknown` | Coordinator / `am_michael` | 93–110 s | 3.250 s | `verify-hours-unknown-kokoro-v1-e9b513a195.mp3` |
| `next-caller-question` | Caller / `af_bella` | 140–143.2 s | 2.625 s | `next-caller-question-kokoro-v1-3fb59364e0.mp3` |
| `next-caller-answer` | Agent / `af_heart` | 143.2–171 s | 12.450 s | `next-caller-answer-kokoro-v1-4a1ccba67f.mp3` |

Curly apostrophes are preserved in caption text. Synthesis normalizes apostrophes and says “1000” as “one thousand”; address meaning is unchanged. Synthesis uses speed 1.0, natural sentence/clause pauses, no atempo compression, and no silence chopping. Two-pass linear loudness processing targets approximately -18 LUFS with light endpoint fades. All files undergo full decode, duration, and non-silence checks. These checks do not substitute for browser playback or a subjective listening review.

## Isolated build environment

The model, voices, Python environment, uv cache, WAV candidates, and comparison audio live outside the repository under `~/Library/Caches/sourcecheck-kokoro`. They are not runtime dependencies or committed assets. The initial setup requires downloading the official packages and model weights; subsequent synthesis can run locally from the cache.

```sh
uv venv --python 3.12 "$HOME/Library/Caches/sourcecheck-kokoro/venv-py312"
uv pip install --python "$HOME/Library/Caches/sourcecheck-kokoro/venv-py312/bin/python" --cache-dir "$HOME/Library/Caches/sourcecheck-kokoro/uv" -r scripts/audio-requirements.txt
```

Download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the [official model-files-v1.1 release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1) into that cache's `models/` directory. From `crisis/`:

```sh
"$HOME/Library/Caches/sourcecheck-kokoro/venv-py312/bin/python" scripts/render-audio.py --compare-coordinator
# Review natural durations and coordinate cue windows before publishing:
"$HOME/Library/Caches/sourcecheck-kokoro/venv-py312/bin/python" scripts/render-audio.py --publish --timings-json /path/to/approved-timings.json
python3 scripts/render-audio.py --check
```

A timings JSON may be an array of `{id,start,end}` objects or an object mapping IDs to `{start,end}`. Publication refuses clips that exceed their final window minus 0.2 seconds. Each published filename contains `kokoro-v1` and an audio-content hash to prevent reuse of a cached system-voice clip. The script never alters duration to force a fit and never plays through system speakers. Raw WAVs and candidate manifests remain external; only final MP3s and the manifest are published.

## Sources and licences

- [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx): MIT; [licence](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE).
- [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M): Apache 2.0; [voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md). The official ONNX conversion and voice pack are linked above.

No network voice API, private key, browser speech synthesis, background music, historical recording, or CCTV footage is used. Captions remain complete while muted. The prerecorded final answer must still obey the application's approval gate.
