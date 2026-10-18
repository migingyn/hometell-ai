import { describe, expect, it } from 'vitest';
import { deriveSnapshot, formatTime, initialPlaybackState, playbackReducer } from './engine';
import { APPROVAL_TIME, CHAPTERS, DURATION, REPORTS, VERIFICATION_CUES } from './scenario';
import type { PlaybackAction, PlaybackState } from './types';

const reduce = (actions: PlaybackAction[], start = initialPlaybackState): PlaybackState =>
  actions.reduce(playbackReducer, start);

function atGate(): PlaybackState {
  return reduce([{ type: 'launch' }, { type: 'tick', delta: 130 }]);
}

function approved(): PlaybackState {
  return playbackReducer(atGate(), { type: 'approve' });
}

describe('approval-gated playback', () => {
  it('launches cleanly and stops exactly at the review gate, even on a large tick', () => {
    const state = reduce([{ type: 'launch' }, { type: 'tick', delta: Number.MAX_VALUE }]);
    expect(state.elapsed).toBe(APPROVAL_TIME);
    expect(state.playing).toBe(false);
    expect(state.approvedAt).toBeNull();
    expect(deriveSnapshot(state).awaitingApproval).toBe(true);
    expect(deriveSnapshot(state).approvedFacts).toBeNull();
    expect(deriveSnapshot(state).answer).toBeNull();
  });

  it('cannot bypass review by seeking, pressing play, or enabling Presenter mode', () => {
    const state = reduce([
      { type: 'launch' },
      { type: 'setPresenter', enabled: true },
      { type: 'seek', elapsed: DURATION },
      { type: 'togglePlay' },
      { type: 'tick', delta: 20 },
    ]);
    expect(state.elapsed).toBe(APPROVAL_TIME);
    expect(state.playing).toBe(false);
    expect(state.approvedAt).toBeNull();
    expect(state.approvalMode).toBeNull();
    expect(deriveSnapshot(state).answer).toBeNull();
  });

  it('accepts manual approval only at the gate and makes repeated approval idempotent', () => {
    const early = reduce([{ type: 'launch' }, { type: 'seek', elapsed: 109 }]);
    expect(playbackReducer(early, { type: 'approve' })).toBe(early);
    expect(playbackReducer(initialPlaybackState, { type: 'approve' })).toBe(initialPlaybackState);
    const state = approved();
    expect(state.approvedAt).toBe(APPROVAL_TIME);
    expect(state.approvalMode).toBe('manual');
    expect(state.playing).toBe(true);
    expect(playbackReducer(state, { type: 'approve' })).toBe(state);
    expect(deriveSnapshot(state).approvedFacts?.mode).toBe('manual');
    expect(deriveSnapshot(state).answer).toBeNull();
  });

  it('creates the next answer from approved facts only when the answer chapter is reached', () => {
    const before = playbackReducer(approved(), { type: 'seek', elapsed: 139.99 });
    expect(deriveSnapshot(before).answer).toBeNull();
    expect(deriveSnapshot(before).transcript.some((cue) => cue.id.startsWith('next-caller'))).toBe(false);
    const state = playbackReducer(before, { type: 'tick', delta: 0.01 });
    const snapshot = deriveSnapshot(state);
    expect(snapshot.answer).toContain(snapshot.approvedFacts?.address);
    expect(snapshot.answer).toContain(snapshot.approvedFacts?.location);
    expect(snapshot.answer).toContain('I don’t have a confirmed closing time yet');
    expect(snapshot.approvedFacts?.closingTime).toBeNull();
    expect(snapshot.transcript.map((cue) => cue.id)).toContain('next-caller-question');
    expect(snapshot.transcript.map((cue) => cue.id)).not.toContain('next-caller-answer');
    const speaking = deriveSnapshot(playbackReducer(state, { type: 'seek', elapsed: 148 }));
    expect(speaking.activeCue?.text).toBe(speaking.answer);
  });

  it('revokes approval before the gate and requires review again on replay', () => {
    const rewind = playbackReducer(approved(), { type: 'seek', elapsed: 109 });
    expect(rewind.approvedAt).toBeNull();
    expect(rewind.approvalMode).toBeNull();
    expect(deriveSnapshot(rewind).approvedFacts).toBeNull();
    const replay = playbackReducer(rewind, { type: 'tick', delta: 30 });
    expect(replay.elapsed).toBe(APPROVAL_TIME);
    expect(replay.playing).toBe(false);
    expect(deriveSnapshot(replay).answer).toBeNull();
  });

  it('preserves approval when rewinding within the approved portion', () => {
    const end = playbackReducer(approved(), { type: 'seek', elapsed: DURATION });
    const review = playbackReducer(end, { type: 'seek', elapsed: APPROVAL_TIME });
    expect(review.approvedAt).toBe(APPROVAL_TIME);
    expect(review.approvalMode).toBe('manual');
    expect(deriveSnapshot(review).awaitingApproval).toBe(false);
    expect(deriveSnapshot(review).answer).toBeNull();
  });

  it('performs scripted approval only when a playing tick reaches the gate', () => {
    const state = reduce([
      { type: 'setPresenter', enabled: true },
      { type: 'launch' },
      { type: 'tick', delta: 109 },
    ]);
    expect(state.approvedAt).toBeNull();
    const crossed = playbackReducer(state, { type: 'tick', delta: 2 });
    expect(crossed.elapsed).toBe(111);
    expect(crossed.approvedAt).toBe(APPROVAL_TIME);
    expect(crossed.approvalMode).toBe('scripted');
    expect(crossed.playing).toBe(true);
    expect(deriveSnapshot(crossed).approvedFacts?.mode).toBe('scripted');
  });

  it('honors double speed, clamps to the end, and does not restart on play', () => {
    const state = reduce([
      { type: 'setSpeed', speed: 2 },
      { type: 'setPresenter', enabled: true },
      { type: 'launch' },
      { type: 'tick', delta: 60 },
    ]);
    expect(state.elapsed).toBe(120);
    expect(state.approvalMode).toBe('scripted');
    const end = playbackReducer(state, { type: 'tick', delta: Number.MAX_VALUE });
    expect(end.elapsed).toBe(DURATION);
    expect(end.playing).toBe(false);
    expect(deriveSnapshot(end).complete).toBe(true);
    expect(playbackReducer(end, { type: 'togglePlay' })).toBe(end);
  });

  it('ignores malformed/nonforward ticks, and paused ticks do not advance', () => {
    const started = playbackReducer(initialPlaybackState, { type: 'launch' });
    for (const delta of [NaN, Infinity, -Infinity, -1, 0]) {
      expect(playbackReducer(started, { type: 'tick', delta })).toBe(started);
    }
    const paused = playbackReducer(started, { type: 'togglePlay' });
    expect(playbackReducer(paused, { type: 'tick', delta: 5 })).toBe(paused);
    expect(playbackReducer(initialPlaybackState, { type: 'tick', delta: 5 })).toBe(initialPlaybackState);
  });

  it('handles nonfinite, negative and oversized seeks without leaking approval', () => {
    const state = approved();
    for (const elapsed of [NaN, Infinity, -Infinity]) {
      expect(playbackReducer(state, { type: 'seek', elapsed })).toBe(state);
    }
    const negative = playbackReducer(state, { type: 'seek', elapsed: -50 });
    expect(negative.elapsed).toBe(0);
    expect(negative.approvedAt).toBeNull();
    const huge = playbackReducer(negative, { type: 'seek', elapsed: Number.MAX_VALUE });
    expect(huge.elapsed).toBe(APPROVAL_TIME);
    expect(huge.approvedAt).toBeNull();
  });

  it('resets publication and selection while retaining playback preferences', () => {
    const state = reduce([
      { type: 'setPresenter', enabled: true },
      { type: 'setSpeed', speed: 2 },
      { type: 'toggleCaptions' },
      { type: 'launch' },
      { type: 'tick', delta: 60 },
      { type: 'selectReport', id: 'school-original' },
      { type: 'reset' },
    ]);
    expect(state).toEqual({
      ...initialPlaybackState,
      launched: true, speed: 2, presenterMode: true, captions: false,
    });
    const snapshot = deriveSnapshot(state);
    expect(snapshot.reports).toHaveLength(0);
    expect(snapshot.transcript).toHaveLength(0);
    expect(snapshot.approvedFacts).toBeNull();
    expect(snapshot.answer).toBeNull();
    expect(snapshot.complete).toBe(false);
  });
});

describe('authored scenario projections', () => {
  it('derives message and declared-origin counts from the visible fixture IDs', () => {
    const beforeRepost = deriveSnapshot(reduce([{ type: 'launch' }, { type: 'seek', elapsed: 25 }]));
    const afterRepost = deriveSnapshot(reduce([{ type: 'launch' }, { type: 'seek', elapsed: 26 }]));
    expect(afterRepost.waterReports.length).toBe(beforeRepost.waterReports.length + 1);
    expect(afterRepost.waterOrigins).toBe(beforeRepost.waterOrigins);
    const all = deriveSnapshot(atGate());
    expect(all.reports).toHaveLength(REPORTS.length);
    expect(all.distinctOrigins).toBe(new Set(REPORTS.map((report) => report.originId)).size);
    expect(all.waterReports).toHaveLength(6);
    expect(all.waterOrigins).toBe(3);
    expect(all.distinctOrigins).toBeLessThan(all.reports.length);
  });

  it('shows only elapsed transcript turns and chooses the active cue at exact boundaries', () => {
    const snapshot = (elapsed: number) => deriveSnapshot(reduce([
      { type: 'launch' }, { type: 'seek', elapsed },
    ]));
    expect(snapshot(64.9).transcript.map(cue=>cue.id)).toEqual(['mission-intro','resident-first-question','mission-question']);
    expect(snapshot(14).activeCue?.speaker).toBe('Caller');
    expect(snapshot(44).activeCue?.speaker).toBe('Guide');
    expect(snapshot(65).activeCue?.id).toBe(VERIFICATION_CUES[0].id);
    const coordinatorStart = VERIFICATION_CUES[1].start;
    expect(snapshot(coordinatorStart - .01).transcript).toHaveLength(4);
    expect(snapshot(coordinatorStart).activeCue?.id).toBe('verify-address');
    expect(snapshot(coordinatorStart).transcript.every((cue) => cue.start <= coordinatorStart)).toBe(true);
    expect(snapshot(APPROVAL_TIME).activeCue).toBeNull();
  });

  it('selects the correct chapter at every boundary and the end', () => {
    for (const chapter of CHAPTERS) {
      const state = chapter.start > APPROVAL_TIME
        ? playbackReducer(approved(), { type: 'seek', elapsed: chapter.start })
        : reduce([{ type: 'launch' }, { type: 'seek', elapsed: chapter.start }]);
      expect(deriveSnapshot(state).chapter.id).toBe(chapter.id);
    }
    expect(deriveSnapshot(playbackReducer(approved(), { type: 'seek', elapsed: DURATION })).chapter.id).toBe('answer');
  });

  it('removes a selected future report when rewinding and rejects unknown selections', () => {
    const selected = playbackReducer(atGate(), { type: 'selectReport', id: 'destination-field-note' });
    expect(selected.selectedReportId).toBe('destination-field-note');
    const rewound = playbackReducer(selected, { type: 'seek', elapsed: 20 });
    expect(rewound.selectedReportId).toBeNull();
    expect(playbackReducer(rewound, { type: 'selectReport', id: 'not-a-report' }).selectedReportId).toBeNull();
  });

  it('formats the simulation clock without negative or nonfinite output', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65.9)).toBe('01:05');
    expect(formatTime(DURATION)).toBe('02:55');
    expect(formatTime(-5)).toBe('00:00');
    expect(formatTime(NaN)).toBe('00:00');
    expect(formatTime(Infinity)).toBe('00:00');
  });
});
