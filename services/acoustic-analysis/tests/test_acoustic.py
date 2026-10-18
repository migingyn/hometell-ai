import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from acoustic import (
    AcousticEngine, InvalidAudio, decode_audio, infer_caller_channel,
    prepare_audio, selected_windows, window_signal,
)
from app import app


def wav(samples, rate=16_000):
    output = io.BytesIO()
    sf.write(output, samples, rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


def test_silence_never_loads_model():
    engine = AcousticEngine()
    assessment = engine.analyze(wav(np.zeros(48_000)), 0)
    assert assessment["status"] == "insufficient_audio"
    assert assessment["signal"] == "uncertain"
    assert assessment["scores"] == {}
    assert not engine.loaded


def test_short_and_clipped_audio_rejected():
    short, _, _ = prepare_audio(wav(np.zeros(8000)), 0, [])
    assert any("At least 2 seconds" in warning for warning in short["warnings"])
    clipped, _, _ = prepare_audio(wav(np.ones(48_000)), 0, [])
    assert clipped["quality"]["clipping_fraction"] == 1
    assert any("clipped" in warning for warning in clipped["warnings"])


def test_mono_requires_caller_attribution():
    assessment, _, _ = prepare_audio(wav(np.zeros(48_000)), None, [])
    assert assessment["quality"]["channel_attribution"] == "unresolved"
    assert assessment["quality"]["caller_channel"] is None


def test_stereo_channel_inference_requires_both_roles_and_opposite_channels():
    audio = np.zeros((64_000, 2), dtype=np.float32)
    rng = np.random.default_rng(42)
    audio[:24_000, 1] = rng.normal(0, 0.1, 24_000)  # caller right
    audio[32_000:56_000, 0] = rng.normal(0, 0.1, 24_000)  # agent left
    segments = [{"role": "user", "start": 0, "end": 1.5}, {"role": "agent", "start": 2, "end": 3.5}]
    assert infer_caller_channel(audio, 16_000, segments) == 1
    assert infer_caller_channel(audio, 16_000, segments[:1]) is None
    assert infer_caller_channel(np.column_stack([audio[:, 1], audio[:, 1]]), 16_000, segments) is None
    assert infer_caller_channel(audio, 16_000, [segments[0], {"role": "agent", "start": 0, "end": 1.5}]) is None


def test_bad_audio_and_invalid_channel_rejected():
    with pytest.raises(InvalidAudio):
        decode_audio(b"not audio")
    with pytest.raises(InvalidAudio):
        prepare_audio(wav(np.zeros(48_000)), 1, [])
    with pytest.raises(InvalidAudio):
        decode_audio(wav(np.zeros(16_000 * 181)))


def test_window_selection_is_bounded_and_covers_end():
    samples = np.zeros(180 * 16_000)
    windows = selected_windows(samples, np.ones(180 * 50, dtype=bool))
    assert len(windows) == 12
    assert windows[0][0] == 0
    assert windows[-1][1] == len(samples)
    assert selected_windows(samples, np.zeros(180 * 50, dtype=bool)) == []


def test_only_high_fear_class_creates_elevated_review_signal():
    assert window_signal({"fearful": 0.7, "angry": 0.1, "calm": 0.2}) == "elevated"
    assert window_signal({"fearful": 0.3, "angry": 0.7}) == "uncertain"
    assert window_signal({"fearful": 0.1, "calm": 0.9}) == "uncertain"


def test_model_failure_cannot_return_reassuring_scores(monkeypatch):
    engine = AcousticEngine()
    monkeypatch.setattr("acoustic.speech_mask", lambda samples: np.ones(len(samples) // 320, dtype=bool))

    def failed_load():
        raise RuntimeError("Fixture model unavailable")

    monkeypatch.setattr(engine, "load", failed_load)
    samples = np.sin(np.arange(48_000) * 2 * np.pi * 180 / 16_000) * 0.1
    assessment = engine.analyze(wav(samples), 0)
    assert assessment["status"] == "unavailable"
    assert assessment["signal"] == "uncertain"
    assert assessment["scores"] == {}


def test_http_auth_and_validation(monkeypatch):
    monkeypatch.setenv("ACOUSTIC_API_KEY", "local-test-secret")
    client = TestClient(app)
    files = {"file": ("silence.wav", wav(np.zeros(48_000)), "audio/wav")}
    assert client.post("/analyze", files=files, data={"caller_channel": "0"}).status_code == 401
    headers = {"Authorization": "Bearer local-test-secret"}
    response = client.post("/analyze", files=files, data={"caller_channel": "0"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_audio"
    assert client.post("/analyze", files=files, data={"speaker_segments": "oops"}, headers=headers).status_code == 400
    assert client.post("/analyze", content=b"", headers={**headers, "Content-Length": str(13 * 1024 * 1024)}).status_code == 413
    chunks = iter([
        b'--limit-test\r\nContent-Disposition: form-data; name="file"; filename="large.wav"\r\nContent-Type: audio/wav\r\n\r\n',
        *[b"0" * (1024 * 1024) for _ in range(13)],
        b"\r\n--limit-test--\r\n",
    ])
    response = client.post("/analyze", content=chunks, headers={**headers, "Content-Type": "multipart/form-data; boundary=limit-test"})
    assert response.status_code == 413
