import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackState, ScenarioSnapshot, TranscriptCue } from './types';

export interface PreparedAudio {
  id:string; text:string; speaker:string; voice:string; duration:number;
  filename:string; start:number; end:number;
}
export type AudioStatus = 'loading'|'ready'|'blocked'|'unavailable';
const SILENCE = 'data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YUABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/** A recording may only speak the exact currently available, approved-derived text. */
export function matchingRecording(cue:TranscriptCue|null, manifest:PreparedAudio[]):PreparedAudio|null {
  if (!cue) return null;
  return manifest.find(item => item.id === cue.id && item.text === cue.text && item.start === cue.start && item.end === cue.end) ?? null;
}

export interface PreparedAudioPlayer {
  src:string; currentTime:number; playbackRate:number; preservesPitch:boolean;
  readonly readyState:number; readonly paused:boolean; readonly ended:boolean;
  play:()=>Promise<void>; pause:()=>void; load:()=>void;
}
export interface AudioSyncInput {
  recording:PreparedAudio|null; elapsed:number; speed:1|2; revision:number;
  enabled:boolean; launched:boolean; playing:boolean; hidden:boolean;
}

/**
 * A media clock runs a cue continuously. Only source changes, explicit timeline
 * edits and unmuting align its position; ordinary render ticks never seek it.
 */
export class PreparedAudioController {
  private input:AudioSyncInput|null = null;
  private sourceKey:string|null = null;
  private generation = 0;
  private pending:{generation:number}|null = null;
  private intendingToPlay = false;
  private needsAlignment = false;
  private alignmentPosition = 0;
  private completed = false;
  private blocked = false;
  private unlocked = false;

  constructor(private player:PreparedAudioPlayer, private report:(status:AudioStatus)=>void = ()=>{}) {}

  private invalidate() {
    this.generation++;
    this.pending = null;
    this.intendingToPlay = false;
  }

  private pause() {
    if (this.intendingToPlay || this.pending) this.invalidate();
    if (!this.player.paused) this.player.pause();
  }

  private requestPlay(prime=false) {
    if (this.pending || this.blocked) return;
    const attempt = {generation:this.generation};
    this.pending = attempt;
    this.player.play().then(() => {
      if (attempt.generation !== this.generation || this.pending !== attempt) {
        // A superseded promise must never pause a newer cue or mark it blocked.
        if (!this.intendingToPlay && !this.player.paused) this.player.pause();
        return;
      }
      this.unlocked = true;
      this.report('ready');
      if (prime || !this.intendingToPlay) this.player.pause();
    }).catch((error:Error) => {
      if (attempt.generation !== this.generation || this.pending !== attempt) return;
      if (error.name === 'NotAllowedError') {
        this.blocked = true;
        this.report('blocked');
      } else if (error.name !== 'AbortError') this.report('unavailable');
    }).finally(() => {
      if (this.pending === attempt) this.pending = null;
    });
  }

  sync(input:AudioSyncInput) {
    const previous = this.input;
    this.input = input;
    const clip = input.recording;
    const key = clip ? JSON.stringify([clip.id, clip.filename, clip.text, clip.start, clip.end]) : null;
    const sourceChanged = key !== this.sourceKey;
    const edited = previous !== null && input.revision !== previous.revision;
    const unmuted = previous?.enabled === false && input.enabled;
    if (clip && (sourceChanged || edited || unmuted)) {
      const position = Math.max(0, Math.min(input.elapsed - clip.start, clip.duration));
      // Latch the requested position before loading. Counting decode time as
      // speech would skip the first syllable when loadedmetadata arrives late.
      this.alignmentPosition = sourceChanged && position < .08 ? 0 : position;
    }

    if (sourceChanged) {
      this.invalidate();
      if (!this.player.paused) this.player.pause();
      this.sourceKey = key;
      this.completed = false;
      this.needsAlignment = clip !== null;
      if (clip) {
        this.player.src = `/audio/${clip.filename}`;
        this.player.load();
      }
    } else if (edited || unmuted) {
      this.invalidate();
      if (!this.player.paused) this.player.pause();
      this.completed = false;
      this.needsAlignment = clip !== null;
    }

    if (!clip) {
      this.pause();
      return;
    }
    if (this.player.playbackRate !== input.speed) this.player.playbackRate = input.speed;
    if (!this.player.preservesPitch) this.player.preservesPitch = true;

    if (this.needsAlignment) {
      if (this.player.readyState < 1) {
        this.pause();
        return; // loadedmetadata retries the original requested audio position.
      }
      const position = this.alignmentPosition;
      try {
        // Loading a new clip already places it at zero. Avoid an unnecessary
        // initial seek, and never reinterpret a later metadata event as a seek.
        if (Math.abs(this.player.currentTime - position) > .015) this.player.currentTime = position;
        this.needsAlignment = false;
        this.completed = position >= clip.duration;
      } catch {
        this.pause();
        return;
      }
    }
    if (this.player.ended) this.completed = true;
    const shouldPlay = input.enabled && input.launched && input.playing && !input.hidden && !this.completed;
    if (!shouldPlay) {
      this.pause();
      return;
    }
    this.intendingToPlay = true;
    if (this.player.paused) this.requestPlay();
  }

  unlock() {
    this.blocked = false;
    if (this.input?.recording && this.input.enabled) {
      this.sync(this.input);
      // A paused timeline stays paused; the user's gesture allows its later play.
      if (!this.input.playing) this.report('ready');
      return;
    }
    if (this.unlocked) return;
    this.invalidate();
    if (!this.player.paused) this.player.pause();
    this.sourceKey = null;
    this.player.src = SILENCE;
    this.player.load();
    this.requestPlay(true);
  }

  stop() {
    this.invalidate();
    if (!this.player.paused) this.player.pause();
  }
}

export function usePreparedAudio(state:PlaybackState, snapshot:ScenarioSnapshot, revision:number) {
  const element = useRef<HTMLAudioElement>(null);
  const controller = useRef<PreparedAudioController|null>(null);
  const [manifest, setManifest] = useState<PreparedAudio[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<AudioStatus>('loading');
  const recording = matchingRecording(snapshot.activeCue, manifest);
  const latest = useRef({state, recording, enabled, revision});
  latest.current = {state, recording, enabled, revision};
  const input = useCallback(():AudioSyncInput => ({
    ...latest.current.state,
    recording:latest.current.recording,
    enabled:latest.current.enabled,
    revision:latest.current.revision,
    hidden:document.hidden,
  }), []);
  const sync = useCallback(() => controller.current?.sync(input()), [input]);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/audio/manifest.json', {signal:abort.signal})
      .then(response => {if(!response.ok) throw new Error('Audio manifest unavailable');return response.json();})
      .then((items:PreparedAudio[]) => {
        if (!Array.isArray(items) || !items.every(item =>
          typeof item.id === 'string' && typeof item.filename === 'string' &&
          typeof item.text === 'string' && Number.isFinite(item.duration) && item.duration > 0 &&
          Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start
        )) throw new Error('Invalid audio manifest');
        setManifest(items);
        setStatus('ready');
        // Warm the small local recordings without creating additional playing
        // media elements. A failed prefetch does not disable working captions.
        for (const item of items) {
          void fetch(`/audio/${item.filename}`, {signal:abort.signal})
            .then(response => response.ok ? response.arrayBuffer() : undefined).catch(()=>{});
        }
      }).catch(error => {if(error.name !== 'AbortError') setStatus('unavailable');});
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const player = element.current;
    if (!player) return;
    const active = new PreparedAudioController(player, setStatus);
    controller.current = active;
    const error = () => setStatus('unavailable');
    player.addEventListener('loadedmetadata', sync);
    player.addEventListener('ended', sync);
    player.addEventListener('error', error);
    document.addEventListener('visibilitychange', sync);
    active.sync(input());
    return () => {
      active.stop();
      if (controller.current === active) controller.current = null;
      player.removeEventListener('loadedmetadata', sync);
      player.removeEventListener('ended', sync);
      player.removeEventListener('error', error);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [input, sync]);

  useEffect(() => { sync(); }, [state.elapsed, state.playing, state.speed, state.launched, enabled, revision, recording, sync]);

  const unlock = useCallback(() => {
    if (!latest.current.enabled) return;
    controller.current?.sync(input());
    controller.current?.unlock();
  }, [input]);
  const toggle = useCallback(() => {
    if (status === 'blocked') { unlock(); return; }
    const next = !latest.current.enabled;
    latest.current.enabled = next;
    setEnabled(next);
    controller.current?.sync(input());
    if (next) controller.current?.unlock();
  }, [status, input, unlock]);
  const stop = useCallback(() => controller.current?.stop(), []);
  return {element,enabled,status,toggle,unlock,stop};
}
