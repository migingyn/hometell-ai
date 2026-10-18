import { APPROVAL_TIME, CHAPTERS, DURATION, REPORTS, SITES, VERIFICATION_CUES, CONTEXT_CUES } from './scenario';
import type {
  ApprovedFacts, PlaybackAction, PlaybackState, ScenarioSnapshot, TranscriptCue,
} from './types';

export const initialPlaybackState: PlaybackState = {
  elapsed: 0,
  launched: false,
  playing: false,
  speed: 1,
  presenterMode: false,
  approvedAt: null,
  approvalMode: null,
  captions: true,
  selectedReportId: null,
};

function hasApproval(state: PlaybackState): boolean {
  return state.approvedAt === APPROVAL_TIME && state.approvalMode !== null;
}

function selectedAt(id: string | null, elapsed: number): string | null {
  return REPORTS.some((report) => report.id === id && report.at <= elapsed) ? id : null;
}

function resetState(state: PlaybackState, launched: boolean, playing: boolean): PlaybackState {
  return {
    ...initialPlaybackState,
    speed: state.speed,
    presenterMode: state.presenterMode,
    captions: state.captions,
    launched,
    playing,
  };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'launch':
      return resetState(state, true, true);
    case 'reset':
      // Return to the start inside the launched experience. Preferences survive,
      // while publication and report selection are always cleared.
      return resetState(state, state.launched, false);
    case 'togglePlay':
      if (
        !state.launched || state.elapsed >= DURATION ||
        (!hasApproval(state) && state.elapsed >= APPROVAL_TIME)
      ) {
        return state.playing ? { ...state, playing: false } : state;
      }
      return { ...state, playing: !state.playing };
    case 'tick': {
      if (!state.launched || !state.playing || !Number.isFinite(action.delta) || action.delta <= 0) {
        return state;
      }
      // Clamp before multiplying so even oversized finite deltas cannot overflow.
      const target = Math.min(DURATION, state.elapsed + Math.min(action.delta, DURATION) * state.speed);
      if (!hasApproval(state) && target >= APPROVAL_TIME) {
        if (!state.presenterMode) {
          return { ...state, elapsed: APPROVAL_TIME, playing: false };
        }
        // Only forward clock progression can perform scripted approval. Seeking,
        // toggling Presenter mode, and deriveSnapshot never publish anything.
        return {
          ...state,
          elapsed: target,
          playing: target < DURATION,
          approvedAt: APPROVAL_TIME,
          approvalMode: 'scripted',
        };
      }
      return { ...state, elapsed: target, playing: target < DURATION };
    }
    case 'seek': {
      if (!Number.isFinite(action.elapsed)) return state;
      const requested = Math.min(DURATION, Math.max(0, action.elapsed));
      const approvalSurvives = hasApproval(state) && requested >= APPROVAL_TIME;
      const target = approvalSurvives ? requested : Math.min(APPROVAL_TIME, requested);
      const blocked = !approvalSurvives && target >= APPROVAL_TIME;
      return {
        ...state,
        elapsed: target,
        approvedAt: approvalSurvives ? APPROVAL_TIME : null,
        approvalMode: approvalSurvives ? state.approvalMode : null,
        playing: state.playing && !blocked && target < DURATION,
        selectedReportId: selectedAt(state.selectedReportId, target),
      };
    }
    case 'approve':
      if (!state.launched || state.elapsed !== APPROVAL_TIME || hasApproval(state)) return state;
      return {
        ...state,
        approvedAt: APPROVAL_TIME,
        approvalMode: 'manual',
        playing: true,
      };
    case 'setSpeed':
      return action.speed === 1 || action.speed === 2 ? { ...state, speed: action.speed } : state;
    case 'setPresenter':
      return { ...state, presenterMode: action.enabled };
    case 'toggleCaptions':
      return { ...state, captions: !state.captions };
    case 'selectReport':
      return { ...state, selectedReportId: selectedAt(action.id, state.elapsed) };
  }
}

function factsFromApproval(state: PlaybackState): ApprovedFacts | null {
  if (!hasApproval(state) || state.elapsed < APPROVAL_TIME) return null;
  return {
    revision: 1,
    location: SITES.destination.name,
    previousLocation: SITES.school.name,
    address: SITES.destination.address,
    supplies: 'food and drinking water',
    closingTime: null,
    quote: VERIFICATION_CUES
      .filter((cue) => cue.id === 'verify-address' || cue.id === 'verify-former-site' || cue.id === 'verify-supplies')
      .map((cue) => cue.text).join(' '),
    approvedAt: APPROVAL_TIME,
    mode: state.approvalMode ?? 'manual',
  };
}

function answerFromFacts(facts: ApprovedFacts): string {
  return `You can get ${facts.supplies} at ${facts.address}, in the ${facts.location}. ` +
    `Pickup has moved from ${facts.previousLocation}. I don’t have a confirmed closing time yet.`;
}

export function deriveSnapshot(state: PlaybackState): ScenarioSnapshot {
  const elapsed = state.elapsed;
  const chapter = CHAPTERS.find((candidate) => elapsed >= candidate.start && elapsed < candidate.end)
    ?? CHAPTERS[CHAPTERS.length - 1];
  const reports = REPORTS.filter((report) => report.at <= elapsed);
  const waterReports = reports.filter((report) => report.category === 'water');
  const approvedFacts = factsFromApproval(state);
  const answer = approvedFacts && elapsed >= 140 ? answerFromFacts(approvedFacts) : null;
  const answerCues: TranscriptCue[] = answer ? [
    {
      id: 'next-caller-question', start: 140, end: 143.2, speaker: 'Caller',
      text: 'Where can I pick up drinking water?',
    },
    {
      id: 'next-caller-answer', start: 143.2, end: 171, speaker: 'Agent', text: answer,
      evidenceFields: ['address', 'location', 'previousLocation', 'supplies', 'closingTime'],
    },
  ] : [];
  const transcript = [...CONTEXT_CUES, ...VERIFICATION_CUES, ...answerCues].filter((cue) => cue.start <= elapsed);
  return {
    chapter,
    reports,
    distinctOrigins: new Set(reports.map((report) => report.originId)).size,
    waterReports,
    waterOrigins: new Set(waterReports.map((report) => report.originId)).size,
    transcript,
    activeCue: transcript.find((cue) => elapsed >= cue.start && elapsed < cue.end) ?? null,
    approvedFacts,
    answer,
    awaitingApproval: state.launched && elapsed >= APPROVAL_TIME && !hasApproval(state),
    complete: state.launched && hasApproval(state) && elapsed >= DURATION,
  };
}

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
