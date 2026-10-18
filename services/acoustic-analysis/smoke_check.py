"""Exercise the real HTTP/model path with public acted speech, not private calls."""

import hashlib
import io
import json
import os
from pathlib import Path
import urllib.request

import httpx
import numpy as np
import soundfile as sf

ROOT = Path(__file__).parent / "fixtures-local"
SOURCE = "https://media.githubusercontent.com/media/CheyneyComputerScience/CREMA-D/1658cd342dff90010aa843eaeebd53610a08b1dc/AudioWAV/"
BASE_URL = "http://127.0.0.1:8019"


def main():
    ROOT.mkdir(exist_ok=True)
    api_key = os.environ.get("ACOUSTIC_API_KEY")
    client = httpx.Client(timeout=60, headers={"Authorization": f"Bearer {api_key}"} if api_key else {})
    health = client.get(f"{BASE_URL}/health")
    health.raise_for_status()
    results = []
    prepared_audio = []
    for name in ["1001_DFA_FEA_XX.wav", "1001_DFA_NEU_XX.wav"]:
        path = ROOT / name
        if not path.exists() or path.stat().st_size < 1000:
            with urllib.request.urlopen(SOURCE + name, timeout=30) as response:
                data = response.read(1024 * 1024)
            path.write_bytes(data)
        data = path.read_bytes()
        audio, rate = sf.read(io.BytesIO(data))
        # Original utterances are too short for our gate. Repeat one actor's same clip
        # to exercise inference, making no claim about independent model accuracy.
        repeated = np.concatenate([audio, np.zeros(rate // 10), audio, np.zeros(rate // 10), audio])
        output = io.BytesIO()
        sf.write(output, repeated, rate, format="WAV", subtype="PCM_16")
        (ROOT / ("smoke-repeated-" + name)).write_bytes(output.getvalue())
        prepared_audio.append((repeated, rate))
        response = client.post(f"{BASE_URL}/analyze", files={"file": (name, output.getvalue(), "audio/wav")}, data={"caller_channel": "0"})
        response.raise_for_status()
        assessment = response.json()
        assert assessment["status"] == "available", assessment
        assert len(assessment["scores"]) == 7
        results.append({
            "source": SOURCE + name,
            "source_sha256": hashlib.sha256(data).hexdigest(),
            "transformation": "Repeated three times with 100 ms silence; inference smoke test only.",
            "assessment": assessment,
        })
    caller, rate = prepared_audio[0]
    agent, agent_rate = prepared_audio[1]
    assert rate == agent_rate
    gap = rate // 2
    stereo = np.zeros((len(caller) + gap + len(agent), 2))
    stereo[:len(caller), 1] = caller
    stereo[len(caller) + gap:, 0] = agent
    output = io.BytesIO()
    sf.write(output, stereo, rate, format="WAV", subtype="PCM_16")
    (ROOT / "constructed-stereo.wav").write_bytes(output.getvalue())
    timestamps = [
        {"role": "user", "start": 0, "end": len(caller) / rate},
        {"role": "agent", "start": (len(caller) + gap) / rate, "end": len(stereo) / rate},
    ]
    response = client.post(f"{BASE_URL}/analyze", files={"file": ("constructed-stereo.wav", output.getvalue(), "audio/wav")}, data={"speaker_segments": json.dumps(timestamps)})
    response.raise_for_status()
    stereo_result = response.json()
    assert stereo_result["status"] == "available", stereo_result
    assert stereo_result["quality"]["caller_channel"] == 1
    assert stereo_result["quality"]["channel_attribution"] == "transcript_energy"
    report = {
        "purpose": "Real audio HTTP/model inference smoke check; not independent accuracy validation.",
        "live_retell_audio_verified": False,
        "health": health.json(),
        "results": results,
        "constructed_stereo": {
            "actual_retell_recording": False,
            "description": "Public actor snippets arranged in opposite channels at non-overlapping known times.",
            "speaker_segments": timestamps,
            "assessment": stereo_result,
        },
    }
    (ROOT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
