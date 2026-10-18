"""Experimental acoustic evidence, kept separate from transcript/medical urgency."""

from __future__ import annotations

import io
import logging
import math
import os
import threading
from typing import Any

import numpy as np
import soundfile as sf
import webrtcvad
from scipy.signal import resample_poly

MODEL_ID = "Dpngtm/wav2vec2-emotion-recognition"
MODEL_REVISION = "033a5751a5bbe5b0b67c2c71e6102c38de35a346"
LABELS = ["angry", "calm", "disgust", "fearful", "happy", "sad", "surprised"]
SAMPLE_RATE = 16_000
MAX_DURATION_SECONDS = 180
MAX_FILE_BYTES = 12 * 1024 * 1024
WINDOW_SECONDS = 6
MAX_WINDOWS = 12
BASE_WARNINGS = [
    "Experimental English acted-speech model; not validated on disaster calls or medical emergencies.",
    "Scores are model class outputs, not probabilities of panic, danger, or safety.",
    "An uncertain result must never lower situation-based urgency or replace operator review.",
]


class InvalidAudio(ValueError):
    pass


def result(status: str = "insufficient_audio", **kwargs: Any) -> dict[str, Any]:
    return {
        "version": "1",
        "status": status,
        "signal": "uncertain",
        "model": {"id": MODEL_ID, "revision": MODEL_REVISION, "labels": LABELS},
        "scores": {},
        "quality": {},
        "segments": [],
        "warnings": list(BASE_WARNINGS),
        **kwargs,
    }


def decode_audio(data: bytes) -> tuple[np.ndarray, int]:
    if not data or len(data) > MAX_FILE_BYTES:
        raise InvalidAudio("Audio must contain 1 byte to 12 MiB.")
    try:
        with sf.SoundFile(io.BytesIO(data)) as source:
            if source.format not in {"WAV", "WAVEX", "FLAC", "OGG"}:
                raise InvalidAudio("Use WAV, FLAC, or OGG audio.")
            if source.channels not in {1, 2}:
                raise InvalidAudio("Use mono caller-only or two-channel party-separated audio.")
            if source.samplerate < 8_000 or source.samplerate > 96_000:
                raise InvalidAudio("Sample rate must be between 8 kHz and 96 kHz.")
            if source.frames / source.samplerate > MAX_DURATION_SECONDS:
                raise InvalidAudio("Audio is limited to 180 seconds per request.")
            audio = source.read(dtype="float32", always_2d=True)
            rate = source.samplerate
    except InvalidAudio:
        raise
    except (RuntimeError, ValueError, OSError) as exc:
        raise InvalidAudio("Unable to decode audio. Use an uncorrupted WAV, FLAC, or OGG file.") from exc
    if not len(audio) or not np.isfinite(audio).all():
        raise InvalidAudio("Audio must have finite samples.")
    return audio, rate


def infer_caller_channel(audio: np.ndarray, rate: int, segments: list[dict[str, Any]]) -> int | None:
    """Require opposite-channel dominance for both speakers; never assume left/right."""
    if audio.shape[1] != 2:
        return None
    valid: list[tuple[str, float, float]] = []
    duration = len(audio) / rate
    for segment in segments:
        role, start, end = segment.get("role"), segment.get("start"), segment.get("end")
        if role not in {"user", "agent"} or isinstance(start, bool) or isinstance(end, bool):
            continue
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration + 0.05:
            valid.append((role, float(start), min(float(end), duration)))
    energies: dict[str, list[np.ndarray]] = {"user": [], "agent": []}
    clean_seconds = {"user": 0.0, "agent": 0.0}
    for role, start, end in valid:
        if end - start < 0.15:
            continue
        # Exclude overlap instead of letting louder agent speech identify the caller.
        if any(other_role != role and other_start < end and other_end > start
               for other_role, other_start, other_end in valid):
            continue
        window = audio[int(start * rate):int(end * rate)]
        power = np.mean(window.astype(np.float64) ** 2, axis=0)
        if float(np.max(power)) < 1e-7:
            continue
        energies[role].append(power)
        clean_seconds[role] += end - start
    if any(clean_seconds[role] < 0.6 for role in energies):
        return None
    dominant = {}
    for role, values in energies.items():
        power = np.median(np.stack(values), axis=0)
        channel = int(np.argmax(power))
        if power[channel] / max(float(power[1 - channel]), 1e-10) < 4:
            return None
        dominant[role] = channel
    return dominant["user"] if dominant["user"] != dominant["agent"] else None


def speech_mask(samples: np.ndarray) -> np.ndarray:
    """20 ms WebRTC VAD frames; this is a speech-presence heuristic, not emotion."""
    size = SAMPLE_RATE // 50
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    detector = webrtcvad.Vad(2)
    return np.array([
        detector.is_speech(pcm[start:start + size].tobytes(), SAMPLE_RATE)
        for start in range(0, len(pcm) - size + 1, size)
    ], dtype=bool)


def prepare_audio(data: bytes, caller_channel: int | None, speaker_segments: list[dict[str, Any]]) -> tuple[dict[str, Any], np.ndarray | None, np.ndarray | None]:
    audio, rate = decode_audio(data)
    attribution = "explicit" if caller_channel is not None else "unresolved"
    if caller_channel is not None and (caller_channel < 0 or caller_channel >= audio.shape[1]):
        raise InvalidAudio("caller_channel must select an existing zero-based channel.")
    if caller_channel is None:
        caller_channel = infer_caller_channel(audio, rate, speaker_segments)
        if caller_channel is not None:
            attribution = "transcript_energy"
    quality = {
        "duration_seconds": round(len(audio) / rate, 3),
        "sample_rate": rate,
        "channels": int(audio.shape[1]),
        "caller_channel": caller_channel,
        "channel_attribution": attribution,
        "speech_seconds": 0,
        "clipping_fraction": 0,
        "rms_dbfs": None,
        "window_count": 0,
        "analyzed_seconds": 0,
    }
    if caller_channel is None:
        return result(quality=quality, warnings=BASE_WARNINGS + [
            "Caller channel could not be attributed. Supply calibrated caller_channel or separate caller/agent timestamps."
        ]), None, None
    mono = audio[:, caller_channel]
    quality["clipping_fraction"] = round(float(np.mean(np.abs(mono) >= 0.999)), 6)
    rms = float(np.sqrt(np.mean(mono.astype(np.float64) ** 2)))
    quality["rms_dbfs"] = round(20 * math.log10(max(rms, 1e-10)), 2)
    if rate != SAMPLE_RATE:
        divisor = math.gcd(rate, SAMPLE_RATE)
        mono = resample_poly(mono, SAMPLE_RATE // divisor, rate // divisor).astype(np.float32)
    mask = speech_mask(mono)
    quality["speech_seconds"] = round(float(np.sum(mask)) * 0.02, 3)
    problems = []
    if quality["duration_seconds"] < 2:
        problems.append("At least 2 seconds of audio is required.")
    if quality["speech_seconds"] < 2:
        problems.append("Fewer than 2 seconds of speech-like audio was detected.")
    if quality["rms_dbfs"] < -48:
        problems.append("Audio is too quiet for reliable analysis.")
    if quality["clipping_fraction"] > 0.05:
        problems.append("More than 5% of caller samples are clipped.")
    warnings = list(BASE_WARNINGS)
    if rate < SAMPLE_RATE:
        warnings.append("Narrowband telephone audio was upsampled; model performance is unvalidated on this bandwidth.")
    if attribution == "explicit":
        warnings.append("Channel selection was supplied by the integrator; this service cannot verify the speaker's identity.")
    if problems:
        return result(quality=quality, warnings=warnings + problems), None, None
    return result(quality=quality, warnings=warnings), mono, mask


def selected_windows(samples: np.ndarray, mask: np.ndarray) -> list[tuple[int, int]]:
    size = WINDOW_SECONDS * SAMPLE_RATE
    candidates = []
    for start in range(0, len(samples), size):
        end = min(start + size, len(samples))
        frame_start, frame_end = start // 320, end // 320
        if (end - start) / SAMPLE_RATE >= 2 and int(np.sum(mask[frame_start:frame_end])) * 0.02 >= 1:
            candidates.append((start, end))
    if len(candidates) <= MAX_WINDOWS:
        return candidates
    # Spread bounded compute over the complete call rather than silently keeping only its start.
    return [candidates[int(index)] for index in np.linspace(0, len(candidates) - 1, MAX_WINDOWS, dtype=int)]


def window_signal(scores: dict[str, float]) -> str:
    # Heuristic review cue. A high fear class is not a calibrated panic probability.
    if scores.get("fearful", 0) >= 0.65 and max(scores, key=scores.get) == "fearful":
        return "elevated"
    return "uncertain"


class AcousticEngine:
    def __init__(self) -> None:
        self._processor = None
        self._model = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        # Standard HTTPS is easier to reproduce behind restricted networks than Xet peers.
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
        import torch
        torch.set_num_threads(2)
        processor = AutoFeatureExtractor.from_pretrained(MODEL_ID, revision=MODEL_REVISION, trust_remote_code=False)
        model = AutoModelForAudioClassification.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, trust_remote_code=False, use_safetensors=True,
        )
        actual_labels = [model.config.id2label[index] for index in range(model.config.num_labels)]
        if actual_labels != LABELS:
            raise RuntimeError("Pinned model label mapping does not match the service contract.")
        model.eval()
        self._processor, self._model = processor, model

    def analyze(self, data: bytes, caller_channel: int | None = None, speaker_segments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        prepared, samples, mask = prepare_audio(data, caller_channel, speaker_segments or [])
        if samples is None or mask is None:
            return prepared
        windows = selected_windows(samples, mask)
        if not windows:
            prepared["warnings"].append("No window contains enough speech for inference.")
            return prepared
        if not self._lock.acquire(blocking=False):
            return {**prepared, "status": "unavailable", "warnings": prepared["warnings"] + ["Analyzer is busy; retry later."]}
        try:
            if not self.loaded:
                self.load()
            import torch
            segments = []
            for start, end in windows:
                inputs = self._processor(samples[start:end], sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
                with torch.inference_mode():
                    values = torch.softmax(self._model(**inputs).logits[0], dim=-1).cpu().tolist()
                if not all(math.isfinite(value) for value in values):
                    raise RuntimeError("Model returned non-finite class scores.")
                scores = {label: round(float(value), 6) for label, value in zip(LABELS, values)}
                segments.append({
                    "start_seconds": round(start / SAMPLE_RATE, 3),
                    "end_seconds": round(end / SAMPLE_RATE, 3),
                    "signal": window_signal(scores),
                    "scores": scores,
                })
            scores = {label: round(float(np.mean([segment["scores"][label] for segment in segments])), 6) for label in LABELS}
            prepared["quality"]["window_count"] = len(segments)
            prepared["quality"]["analyzed_seconds"] = round(sum((end - start) / SAMPLE_RATE for start, end in windows), 3)
            if len(windows) == MAX_WINDOWS and len(samples) > MAX_WINDOWS * WINDOW_SECONDS * SAMPLE_RATE:
                prepared["warnings"].append("Bounded sampling inspected at most 12 windows; uninspected intervals may contain distress.")
            return {
                **prepared, "status": "available", "scores": scores, "segments": segments,
                "signal": "elevated" if any(segment["signal"] == "elevated" for segment in segments) else "uncertain",
            }
        except Exception:
            # Do not turn missing weights, network errors, or model failure into a reassuring score.
            logging.getLogger(__name__).exception("Acoustic inference failed (audio is not logged)")
            return {**prepared, "status": "unavailable", "warnings": prepared["warnings"] + ["Acoustic model inference failed; inspect service logs and retry."]}
        finally:
            self._lock.release()
