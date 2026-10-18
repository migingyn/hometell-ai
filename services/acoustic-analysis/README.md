# Acoustic analysis service

This is our self-hosted audio processing and inference service, using a pretrained speech emotion model as its base. It consumes the caller's audio waveform, independently of Retell's transcript sentiment. We did not train a new model or validate a panic classifier.

It produces an experimental **elevated acoustic review cue** when a speech window's top model class is `fearful` with class score at least 0.65. This threshold is a heuristic, not a calibrated probability. Angry, sad, quiet, neutral, or uncertain output does not establish danger or safety. An operator must consider the caller's described situation; audio must never reduce an existing urgent priority.

## Run locally

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12. The first warmup downloads approximately 380 MB of public weights to the Hugging Face cache outside this repository. No hosted inference key is needed; inference runs on the CPU.

```sh
cd services/acoustic-analysis
uv sync --locked --python 3.12
uv run python app.py --warmup
```

The service binds to `127.0.0.1:8019`. `GET /health` indicates whether the model has loaded. Set `ACOUSTIC_API_KEY` to require a bearer token. A non-loopback bind requires that key through this entry point; expose it only behind a private authenticated network or TLS proxy. There is no permissive browser CORS policy.

```sh
curl http://127.0.0.1:8019/analyze \
  -F 'file=@/absolute/path/to/caller-only.wav' \
  -F 'caller_channel=0'
```

For a protected instance, include `-H "Authorization: Bearer $ACOUSTIC_API_KEY"`.

## Input and caller attribution

`POST /analyze` accepts multipart fields:

| Field | Contract |
| --- | --- |
| `file` | WAV, FLAC, or OGG; up to 12 MiB, 180 seconds, 1–2 channels, 8–96 kHz |
| `caller_channel` | Optional zero-based channel index, explicitly calibrated by the integrator. A mono file must be caller-only and use `0`. |
| `speaker_segments` | Optional JSON array of `{ "role": "user" or "agent", "start": seconds, "end": seconds }` |

Do not assume that Retell always places the caller on a fixed stereo channel. Without an explicit channel, the service uses timestamps to require opposite-channel energy dominance for both roles during non-overlapping speech. If it cannot confidently attribute the caller, it returns `insufficient_audio`. Never send mixed agent/caller audio as caller-only. The service cannot independently verify an explicitly supplied channel or a person's identity.

Audio is decoded in memory and never written to disk or logged. The API does not accept URLs and cannot fetch arbitrary remote resources. The caller (our application server) must download an authorized recording before submitting its bytes.

## Output

```json
{
  "version": "1",
  "status": "available",
  "signal": "elevated",
  "model": {
    "id": "Dpngtm/wav2vec2-emotion-recognition",
    "revision": "033a5751a5bbe5b0b67c2c71e6102c38de35a346",
    "labels": ["angry", "calm", "disgust", "fearful", "happy", "sad", "surprised"]
  },
  "scores": { "fearful": 0.7 },
  "quality": {
    "duration_seconds": 6,
    "sample_rate": 16000,
    "channels": 1,
    "caller_channel": 0,
    "channel_attribution": "explicit",
    "speech_seconds": 3.4,
    "clipping_fraction": 0,
    "rms_dbfs": -20,
    "window_count": 1,
    "analyzed_seconds": 6
  },
  "segments": [
    { "start_seconds": 0, "end_seconds": 6, "signal": "elevated", "scores": { "fearful": 0.7 } }
  ],
  "warnings": ["Scores are model class outputs, not probabilities of panic, danger, or safety."]
}
```

This example omits six score keys and some standard warnings for readability. Actual successful responses include all seven class scores, their mean across analyzed windows, and each window's individual scores. `signal` is elevated if any inspected window passes the heuristic; inspect the segments rather than treating the mean as a panic score.

`status` is `available`, `insufficient_audio`, or `unavailable`. `signal` is always `elevated` or `uncertain`, never “safe.” Silence, fewer than 2 seconds of speech-like audio, clips shorter than 2 seconds, excessive clipping, and unresolved attribution return no emotion scores. WebRTC VAD is a speech-presence heuristic, not a noise-quality guarantee or an emotion classifier. Telephone bandwidth, noise, language, disability, accent, and acted-versus-spontaneous speech can all impair the emotion model.

The service resamples to 16 kHz, examines speech-containing windows of up to 6 seconds, and caps inference at 12 windows distributed across a long file. It reports inspected coverage. It can miss distress between sampled windows. A model error returns `unavailable`, without a reassuring score. One inference runs at a time; concurrent requests receive `unavailable` and can retry.

## Tests and verification

```sh
uv run pytest -q
uv run python smoke_check.py
```

Tests cover silence, short/clipped audio, ambiguous and opposite stereo channels, bounded coverage, threshold interpretation, model failure, authentication, malformed input, and request size. `smoke_check.py` requires the running local service and downloads two public acted CREMA-D clips to the ignored `fixtures-local/` directory, repeating them to meet the speech-duration gate. It records real HTTP/model responses and source hashes in `fixtures-local/verification.json`. Neither check measures disaster triage accuracy. See `PROVENANCE.md` for the model and dataset sources.

With Retell's standard recording URL this is **post-call** analysis. Live transcript updates do not contain raw audio. Live acoustic analysis requires a separate continuous caller-audio capture path; this service does not invent one from transcript events.
