import {describe, expect, it, vi} from 'vitest';
import manifest from '../public/audio/manifest.json';
import {matchingRecording, PreparedAudioController} from './audio';
import type {AudioStatus, AudioSyncInput, PreparedAudio, PreparedAudioPlayer} from './audio';
import {CONTEXT_CUES, VERIFICATION_CUES} from './scenario';
import {deriveSnapshot, initialPlaybackState, playbackReducer} from './engine';

describe('prepared speech stays consistent with the approved story',()=>{
  it('has matching local recordings for every authored narration and verification cue',()=>{
    for(const cue of [...CONTEXT_CUES,...VERIFICATION_CUES]) {
      const recording=matchingRecording(cue,manifest);
      expect(recording?.speaker).toBe(cue.speaker);
      expect(recording?.duration).toBeGreaterThan(.2);
      expect(recording!.duration).toBeLessThan(cue.end-cue.start);
    }
    expect(new Set(manifest.map(item=>item.id)).size).toBe(manifest.length);
  });
  it('cannot select the next answer recording before approval, and matches the approved-derived answer afterward',()=>{
    const launched=playbackReducer(initialPlaybackState,{type:'launch'});
    const gate=playbackReducer(launched,{type:'seek',elapsed:150});
    expect(matchingRecording(deriveSnapshot(gate).activeCue,manifest)).toBeNull();
    const approved=playbackReducer(gate,{type:'approve'});
    const speaking=playbackReducer(approved,{type:'seek',elapsed:150});
    const snapshot=deriveSnapshot(speaking);
    expect(matchingRecording(snapshot.activeCue,manifest)?.text).toBe(snapshot.answer);
    const rewind=playbackReducer(speaking,{type:'seek',elapsed:60});
    expect(matchingRecording(deriveSnapshot(rewind).activeCue,manifest)).toBeNull();
  });
  it('refuses stale text or timing instead of speaking a contradictory recording',()=>{
    const cue=VERIFICATION_CUES[1];
    expect(matchingRecording({...cue,text:'The old address is still correct.'},manifest)).toBeNull();
    expect(matchingRecording({...cue,start:cue.start+.1},manifest)).toBeNull();
  });
});

class FakePlayer implements PreparedAudioPlayer {
  src = '';
  playbackRate = 1;
  preservesPitch = false;
  readyState = 1;
  paused = true;
  ended = false;
  seeks:number[] = [];
  private time = 0;
  get currentTime() { return this.time; }
  set currentTime(value:number) { this.time = value; this.ended = false; this.seeks.push(value); }
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(() => { this.time = 0; this.ended = false; this.paused = true; });
  advance(seconds:number) { this.time += seconds; }
  finish() { this.ended = true; this.paused = true; }
}

const authoredCue = VERIFICATION_CUES[0];
const clip:PreparedAudio = {
  ...authoredCue, speaker:authoredCue.speaker, voice:'fixture', filename:'fixture.mp3',
  duration:Math.min(4,(authoredCue.end-authoredCue.start)*.8),
};
function input(overrides:Partial<AudioSyncInput> = {}):AudioSyncInput {
  return {
    recording:clip, elapsed:clip.start, speed:1, revision:0,
    enabled:true, launched:true, playing:true, hidden:false,
    ...overrides,
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('continuous local speech transport', () => {
  it('does not seek or reload an ongoing cue when media drifts beyond the old0.3s threshold', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    for (let frame=1;frame<=4;frame++) {
      player.advance(.6);
      controller.sync(input({elapsed:clip.start+frame*.25}));
    }
    expect(player.currentTime).toBeCloseTo(2.4);
    expect(player.seeks).toEqual([]);
    expect(player.load).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.paused).toBe(false);
  });

  it('pauses and resumes at the media position without replaying part of a word', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    player.advance(.65);
    controller.sync(input({elapsed:clip.start+.6,playing:false}));
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(.65);
    controller.sync(input({elapsed:clip.start+.6}));
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBe(.65);
    expect(player.seeks).toEqual([]);
  });

  it('performs one explicit seek, including while paused, and does not repeat it on render ticks', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    const target = clip.duration/2;
    const edited = input({elapsed:clip.start+target,revision:1,playing:false});
    controller.sync(edited);
    controller.sync(edited);
    expect(player.seeks).toEqual([target]);
    expect(player.paused).toBe(true);
    controller.sync({...edited,playing:true});
    expect(player.currentTime).toBe(target);
    expect(player.seeks).toEqual([target]);
  });

  it('realigns once on unmute while allowing hidden-tab pause/resume without a correction loop', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    player.advance(.4);
    controller.sync(input({elapsed:clip.start+.4,hidden:true}));
    expect(player.paused).toBe(true);
    controller.sync(input({elapsed:clip.start+.4}));
    expect(player.seeks).toEqual([]);
    expect(player.paused).toBe(false);
    controller.sync(input({elapsed:clip.start+.5,enabled:false}));
    expect(player.paused).toBe(true);
    controller.sync(input({elapsed:clip.start+1.2,enabled:false}));
    controller.sync(input({elapsed:clip.start+1.2}));
    expect(player.seeks).toHaveLength(1);
    expect(player.seeks[0]).toBeCloseTo(1.2);
    expect(player.paused).toBe(false);
  });

  it('changes speed without seeking and preserves natural pitch', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    player.advance(.5);
    controller.sync(input({elapsed:clip.start+.5,speed:2}));
    expect(player.playbackRate).toBe(2);
    expect(player.preservesPitch).toBe(true);
    expect(player.currentTime).toBe(.5);
    expect(player.seeks).toEqual([]);
  });

  it('lets the media finish naturally rather than cutting a final word at the estimated file duration', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    player.advance(clip.duration-.2);
    controller.sync(input({elapsed:clip.start+clip.duration+.1}));
    expect(player.paused).toBe(false);
    player.finish();
    controller.sync(input({elapsed:clip.start+clip.duration+.15}));
    controller.sync(input({elapsed:clip.start+clip.duration+.2}));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.seeks).toEqual([]);
  });

  it('does not play a clip when an explicit seek lands after its recorded duration', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input({elapsed:clip.start+clip.duration+.1,revision:1}));
    expect(player.currentTime).toBe(clip.duration);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.paused).toBe(true);
  });

  it('preserves the first syllable when metadata arrives late, without repeatedly seeking', () => {
    const player = new FakePlayer();
    player.readyState = 0;
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    expect(player.play).not.toHaveBeenCalled();
    expect(player.seeks).toEqual([]);
    player.readyState = 1;
    controller.sync(input({elapsed:clip.start+.2}));
    expect(player.currentTime).toBe(0);
    expect(player.seeks).toEqual([]);
    controller.sync(input({elapsed:clip.start+.5}));
    expect(player.seeks).toEqual([]);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('holds an explicit mid-clip seek while the new recording loads', () => {
    const player = new FakePlayer();
    player.readyState = 0;
    const controller = new PreparedAudioController(player);
    controller.sync(input({elapsed:clip.start+2,revision:1}));
    player.readyState = 1;
    controller.sync(input({elapsed:clip.start+2.4,revision:1}));
    expect(player.seeks).toEqual([2]);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('clears an inactive cue so reset/replay can speak the same recording again', () => {
    const player = new FakePlayer();
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    player.finish();
    controller.sync(input({recording:null,elapsed:clip.end+1}));
    controller.sync(input());
    expect(player.load).toHaveBeenCalledTimes(2);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.currentTime).toBe(0);
  });

  it('ignores an old cue play rejection rather than blocking the newer cue', async () => {
    const player = new FakePlayer();
    const statuses:AudioStatus[] = [];
    let rejectOld:(reason:Error)=>void = ()=>{};
    player.play.mockImplementationOnce(()=>new Promise<void>((_,reject)=>{rejectOld=reject;}));
    const controller = new PreparedAudioController(player,status=>statuses.push(status));
    controller.sync(input());
    controller.sync(input({recording:{...clip,id:'second',filename:'second.mp3'}}));
    rejectOld(Object.assign(new Error('Old autoplay attempt'),{name:'NotAllowedError'}));
    await flush();
    expect(statuses).not.toContain('blocked');
    expect(player.paused).toBe(false);
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('pauses a late play resolution after stop instead of allowing a muted or reset cue to escape', async () => {
    const player = new FakePlayer();
    let resolveOld:()=>void = ()=>{};
    player.play.mockImplementationOnce(()=>new Promise<void>(resolve=>{resolveOld=resolve;}));
    const controller = new PreparedAudioController(player);
    controller.sync(input());
    controller.stop();
    player.paused = false;
    resolveOld();
    await flush();
    expect(player.paused).toBe(true);
  });
});
