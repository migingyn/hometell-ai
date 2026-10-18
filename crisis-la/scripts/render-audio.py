#!/usr/bin/env python3
"""Offline Kokoro neural asset builder; not imported by the application.

Default: render full-quality candidates into an external cache. Publication is
explicit, after cue windows have been coordinated. No speech is played aloud.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('SOURCECHECK_AUDIO_CACHE', str(Path.home() / 'Library/Caches/sourcecheck-kokoro')))
PUBLIC = ROOT / 'public/audio'
CANDIDATES = CACHE / 'candidates/neural-la-conversational-v1'
VOICE_MAP = {'Guide': 'af_heart', 'Agent': 'af_heart', 'Caller': 'af_bella', 'Coordinator': 'am_michael'}
DEFAULT_CUES = [{'id': 'mission-intro',
  'start': 1,
  'end': 14,
  'speaker': 'Guide',
  'text': 'In this fictional scenario, Hurricane Rachel has hit Los Angeles. You’re running the hotline. A '
          'caller needs water, but the pickup address may have changed.'},
 {'id': 'resident-first-question',
  'start': 14,
  'end': 23,
  'speaker': 'Caller',
  'text': 'Hi, I need some drinking water. Is pickup still at John Marshall High?'},
 {'id': 'mission-question',
  'start': 44,
  'end': 55,
  'speaker': 'Guide',
  'text': 'Some people say the school. Others say pickup has moved. Let’s call the coordinator and check '
          'which address is right.'},
 {'id': 'verify-question',
  'start': 65,
  'end': 71.8,
  'speaker': 'Agent',
  'text': 'Hi, I’m checking the water pickup location for our hotline. Are you still at John Marshall High?'},
 {'id': 'verify-address',
  'start': 71.8,
  'end': 78.6,
  'speaker': 'Coordinator',
  'text': 'We’ve moved to the Dodger Stadium parking lot, at 1000 Vin Scully Avenue.'},
 {'id': 'verify-former-site',
  'start': 78.6,
  'end': 82.5,
  'speaker': 'Coordinator',
  'text': 'Flooding closed our pickup site at the school.'},
 {'id': 'verify-supplies',
  'start': 82.5,
  'end': 86.3,
  'speaker': 'Coordinator',
  'text': 'You can get food and drinking water here.'},
 {'id': 'verify-hours-question',
  'start': 86.3,
  'end': 93,
  'speaker': 'Agent',
  'text': 'Okay, 1000 Vin Scully Avenue, instead of the school. What time do you close today?'},
 {'id': 'verify-hours-unknown',
  'start': 93,
  'end': 110,
  'speaker': 'Coordinator',
  'text': 'I don’t have a confirmed closing time yet.'},
 {'id': 'next-caller-question',
  'start': 140,
  'end': 143.2,
  'speaker': 'Caller',
  'text': 'Where can I pick up drinking water?'},
 {'id': 'next-caller-answer',
  'start': 143.2,
  'end': 171,
  'speaker': 'Agent',
  'text': 'You can get food and drinking water at 1000 Vin Scully Avenue, in the Dodger Stadium parking lot. '
          'Pickup has moved from John Marshall High School. I don’t have a confirmed closing time yet.'}]


def command(args):
 return subprocess.run(args,check=True,capture_output=True,text=True)


def probe(path):
 return float(json.loads(command(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(path)]).stdout)['format']['duration'])


def validate(path):
 result=command(['ffmpeg','-hide_banner','-nostats','-i',str(path),'-af','volumedetect','-f','null','-'])
 levels={}
 for name in ['mean_volume','max_volume']:
  match=re.search(rf'{name}:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB',result.stderr)
  if not match: raise RuntimeError(f'Missing {name}: {path}')
  levels[name]=float(match.group(1))
 if not math.isfinite(levels['mean_volume']) or levels['mean_volume'] < -45 or levels['max_volume'] < -30:
  raise RuntimeError(f'Silent/low-level output: {path}, {levels}')
 return levels


def speech_text(text):
 # Display/caption text keeps exact curly apostrophes and address digits.
 return text.replace('’', "'").replace('1000', 'one thousand')


def encode(wav,mp3,seconds):
 # Linear two-pass gain targets -18 LUFS while retaining pauses and dynamics.
 analysis=command(['ffmpeg','-hide_banner','-nostats','-i',str(wav),'-af',
  'loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-'])
 blocks=re.findall(r'\{\s*"input_i".*?\}',analysis.stderr,re.S)
 if not blocks: raise RuntimeError('No loudness analysis returned')
 measured=json.loads(blocks[-1])
 filters=(f"loudnorm=I=-18:TP=-1.5:LRA=11:measured_I={measured['input_i']}:"
  f"measured_LRA={measured['input_lra']}:measured_TP={measured['input_tp']}:"
  f"measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:linear=true,"
  f"afade=t=in:st=0:d=0.01,afade=t=out:st={max(0,seconds-0.015):.6f}:d=0.015")
 command(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(wav),'-af',filters,
  '-ar','24000','-ac','1','-codec:a','libmp3lame','-q:a','2',str(mp3)])
 return measured


def render_one(model,cue,output,voice):
 import soundfile as sf
 identifier=cue['id']
 if not re.fullmatch('[a-z0-9-]+',identifier): raise ValueError('Unsafe cue identifier')
 spoken=speech_text(cue['text'])
 # No atempo, no aggressive silence removal. Preserve the neural model output.
 samples,sample_rate=model.create(spoken,voice=voice,speed=1.0,lang='en-us',trim=False,
  sentence_pause=0.25,clause_pause=0.12)
 raw_duration=len(samples)/sample_rate
 wav=output/f'{identifier}.wav'
 mp3=output/f'{identifier}.mp3'
 sf.write(str(wav),samples,sample_rate,subtype='PCM_24')
 encode(wav,mp3,raw_duration)
 levels=validate(mp3)
 row={**cue,'voice':voice,'engine':'kokoro-onnx','scenario':'la-rachel','model':'Kokoro-82M v1.0',
  'speed':1.0,'spokenText':spoken,'rawDuration':round(raw_duration,6),
  'duration':round(probe(mp3),6),'filename':mp3.name,'bytes':mp3.stat().st_size,
  'meanVolumeDb':levels['mean_volume'],'maxVolumeDb':levels['max_volume'],
  'targetLufs':-18,'sentencePause':0.25,'clausePause':0.12}
 print(json.dumps({'id':identifier,'voice':voice,'rawSeconds':row['rawDuration'],
  'encodedSeconds':row['duration']},ensure_ascii=False),flush=True)
 return row


def load_cues():
 manifest=PUBLIC/'manifest.json'
 if manifest.is_file():
  entries=json.loads(manifest.read_text())
  if entries and entries[0].get('engine')=='kokoro-onnx' and entries[0].get('scenario')=='la-rachel':
   return [{k:e[k] for k in ['id','start','end','speaker','text']} for e in entries]
 return DEFAULT_CUES


def candidates(output,coordinator,compare):
 from kokoro_onnx import Kokoro
 import importlib.metadata
 model_path=CACHE/'models/kokoro-v1.0.onnx'
 voices_path=CACHE/'models/voices-v1.0.bin'
 if not model_path.is_file() or not voices_path.is_file():
  raise RuntimeError(f'Model files missing under {model_path.parent}; see docs/AUDIO_ASSETS.md')
 output.mkdir(parents=True,exist_ok=True)
 model=Kokoro(str(model_path),str(voices_path))
 voices={**VOICE_MAP,'Coordinator':coordinator}
 rows=[]
 reuse_manifest=ROOT.parent/'crisis/public/audio/manifest.json'
 reusable=json.loads(reuse_manifest.read_text()) if reuse_manifest.is_file() else []
 for cue in load_cues():
  voice=voices[cue['speaker']]
  match=next((r for r in reusable if r.get('text')==cue['text'] and r.get('voice')==voice
   and r.get('engine')=='kokoro-onnx' and r.get('speed')==1.0 and r.get('targetLufs')==-18),None)
  if match and (reuse_manifest.parent/match['filename']).is_file():
   destination=output/f"{cue['id']}.mp3"
   shutil.copy2(reuse_manifest.parent/match['filename'],destination)
   validate(destination)
   row={**match,**cue,'scenario':'la-rachel','filename':destination.name,'reusedExactText':True}
   row['bytes']=destination.stat().st_size
   row['duration']=round(probe(destination),6)
   print(json.dumps({'id':cue['id'],'voice':voice,'rawSeconds':row['rawDuration'],
    'encodedSeconds':row['duration'],'reused':True},ensure_ascii=False),flush=True)
  else:
   row=render_one(model,cue,output,voice)
  rows.append(row)
 (output/'candidate-manifest.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
 if compare:
  alternate='am_fenrir' if coordinator=='am_michael' else 'am_michael'
  cue={**next(c for c in DEFAULT_CUES if c['id']=='verify-address'),
   'id':f'coordinator-comparison-{alternate.replace("_","-")}'}
  comparison=render_one(model,cue,output,alternate)
  (output/'coordinator-comparison.json').write_text(json.dumps(comparison,indent=2,ensure_ascii=False)+'\n')
 info={'package':importlib.metadata.version('kokoro-onnx'),'modelSource':
  'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx',
  'voicesSource':'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin',
  'modelSha256':hashlib.file_digest(model_path.open('rb'),'sha256').hexdigest(),
  'voicesSha256':hashlib.file_digest(voices_path.open('rb'),'sha256').hexdigest(),
  'modelLicense':'Apache-2.0','libraryLicense':'MIT','outsideRepository':True}
 (output/'build-info.json').write_text(json.dumps(info,indent=2)+'\n')
 print(f'CANDIDATES READY: {output}',flush=True)


def write_docs(rows):
 total=sum(r['bytes'] for r in rows)
 table='\n'.join(f"| `{r['id']}` | {r['speaker']} / `{r['voice']}` | {r['start']}–{r['end']} s | {r['duration']:.3f} s | `{r['filename']}` |" for r in rows)
 text=f'''# Prepared local neural speech

These are synthetic scenario voices for the fictional Hurricane Rachel / Los Angeles replay, made locally with Kokoro-82M v1.0 through kokoro-onnx. They are not historical calls, voice clones, or the proprietary ChatGPT voice. Real Los Angeles place names are geographic anchors; the disaster, flooding, and aid operations are fictional. The browser plays prepared MP3 files only; no model, Python package, API, or speech-generation service runs in the application.

## Published inventory

{len(rows)} mono 24 kHz MP3 clips, {total:,} bytes, {sum(r['duration'] for r in rows):.3f} encoded seconds. Guide/Agent use `af_heart`, Caller uses `af_bella`, and Coordinator uses `{next(r['voice'] for r in rows if r['speaker']=='Coordinator')}`. Display text and final timing remain in [manifest.json](../public/audio/manifest.json).

{sum(bool(r.get('reusedExactText')) for r in rows)} clips reuse exact matching Kokoro speech byte-for-byte from the existing prepared set; the other {sum(not bool(r.get('reusedExactText')) for r in rows)} clips were rendered for the Los Angeles dialogue. Only the LA copies are published here; the original application assets are unchanged.

| Cue | Speaker / neural voice | Final replay window | Encoded duration | Published filename |
| --- | --- | --- | --- | --- |
{table}

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

A timings JSON may be an array of `{{id,start,end}}` objects or an object mapping IDs to `{{start,end}}`. Publication refuses clips that exceed their final window minus 0.2 seconds. Each published filename contains `kokoro-v1` and an audio-content hash to prevent reuse of a cached system-voice clip. The script never alters duration to force a fit and never plays through system speakers. Raw WAVs and candidate manifests remain external; only final MP3s and the manifest are published.

## Sources and licences

- [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx): MIT; [licence](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE).
- [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M): Apache 2.0; [voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md). The official ONNX conversion and voice pack are linked above.

No network voice API, private key, browser speech synthesis, background music, historical recording, or CCTV footage is used. Captions remain complete while muted. The prerecorded final answer must still obey the application's approval gate.
'''
 (ROOT/'docs/AUDIO_ASSETS.md').write_text(text)


def publish(output,timings_path):
 rows=json.loads((output/'candidate-manifest.json').read_text())
 candidate_names={r['id']:r['filename'] for r in rows}
 if timings_path:
  timing=json.loads(timings_path.read_text())
  if isinstance(timing,list): timing={r['id']:r for r in timing}
 else:
  timing={r['id']:r for r in json.loads((PUBLIC/'manifest.json').read_text())}
 for row in rows:
  if row['id'] not in timing: raise ValueError(f'Missing approved timing: {row["id"]}')
  row.update({k:timing[row['id']][k] for k in ['start','end']})
  if row['duration'] > row['end']-row['start']-0.2:
   raise ValueError(f'Window too short: {row["id"]}, needs {row["duration"]+0.2:.3f}s')
  validate(output/row['filename'])
 PUBLIC.mkdir(parents=True,exist_ok=True)
 for row in rows:
  source=output/candidate_names[row['id']]
  digest=hashlib.sha256(source.read_bytes()).hexdigest()[:10]
  row['filename']=f"{row['id']}-kokoro-v1-{digest}.mp3"
  shutil.copy2(source,PUBLIC/row['filename'])
  validate(PUBLIC/row['filename'])
  if abs(probe(PUBLIC/row['filename'])-row['duration'])>0.002:
   raise RuntimeError(f'Published duration mismatch: {row["id"]}')
 pending=PUBLIC/'.manifest.pending.json'
 pending.write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
 os.replace(pending,PUBLIC/'manifest.json')
 # Only the eleven explicitly superseded system-voice names are removed.
 for row in rows:
  old=PUBLIC/f"{row['id']}.mp3"
  if old.is_file(): old.unlink()
 write_docs(rows)
 print(f'PUBLISHED {len(rows)} Kokoro clips; {sum(r["bytes"] for r in rows):,} bytes',flush=True)


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output-dir',type=Path,default=CANDIDATES)
 parser.add_argument('--coordinator-voice',choices=['am_michael','am_fenrir'],default='am_michael')
 parser.add_argument('--compare-coordinator',action='store_true')
 parser.add_argument('--publish',action='store_true')
 parser.add_argument('--timings-json',type=Path)
 parser.add_argument('--check',action='store_true')
 args=parser.parse_args()
 if args.check:
  rows=json.loads((PUBLIC/'manifest.json').read_text())
  for row in rows:
   validate(PUBLIC/row['filename'])
   actual=probe(PUBLIC/row['filename'])
   if abs(actual-row['duration'])>0.002 or actual>row['end']-row['start']-0.2:
    raise RuntimeError(f'Duration/window mismatch: {row["id"]}')
  print(f'Checked {len(rows)} full MP3 decodes, levels, and final timing windows.')
 elif args.publish: publish(args.output_dir,args.timings_json)
 else: candidates(args.output_dir,args.coordinator_voice,args.compare_coordinator)


if __name__=='__main__': main()
