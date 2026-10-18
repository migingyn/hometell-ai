export type Tone = 'cyan' | 'amber' | 'red' | 'green' | 'muted';
export type ChapterId = 'arrival' | 'reports' | 'question' | 'verification' | 'review' | 'answer';

export interface GeoPoint { lat: number; lon: number }
export interface Site extends GeoPoint {
  id: 'school' | 'destination';
  name: string;
  shortName: string;
  address: string;
  coordinateSource: string;
}
export interface ScenarioReport extends GeoPoint {
  id: string;
  at: number;
  title: string;
  detail: string;
  area: string;
  category: 'water' | 'power' | 'access' | 'hours';
  source: string;
  originId: string;
  tone: Tone;
  relatedSite?: Site['id'];
}
export interface TranscriptCue {
  id: string;
  start: number;
  end: number;
  speaker: 'Agent' | 'Coordinator' | 'Caller' | 'Guide';
  text: string;
  evidenceFields?: string[];
}
export interface Chapter {
  id: ChapterId;
  number: string;
  start: number;
  end: number;
  label: string;
  title: string;
  subtitle: string;
}
export interface ApprovedFacts {
  revision: 1;
  location: string;
  previousLocation: string;
  address: string;
  supplies: string;
  closingTime: null;
  quote: string;
  approvedAt: number;
  mode: 'manual' | 'scripted';
}
export interface PlaybackState {
  elapsed: number;
  launched: boolean;
  playing: boolean;
  speed: 1 | 2;
  presenterMode: boolean;
  approvedAt: number | null;
  approvalMode: 'manual' | 'scripted' | null;
  captions: boolean;
  selectedReportId: string | null;
}
export type PlaybackAction =
  | { type: 'launch' }
  | { type: 'togglePlay' }
  | { type: 'tick'; delta: number }
  | { type: 'seek'; elapsed: number }
  | { type: 'approve' }
  | { type: 'reset' }
  | { type: 'setSpeed'; speed: 1 | 2 }
  | { type: 'setPresenter'; enabled: boolean }
  | { type: 'toggleCaptions' }
  | { type: 'selectReport'; id: string | null };

export interface ScenarioSnapshot {
  chapter: Chapter;
  reports: ScenarioReport[];
  distinctOrigins: number;
  waterReports: ScenarioReport[];
  waterOrigins: number;
  transcript: TranscriptCue[];
  activeCue: TranscriptCue | null;
  approvedFacts: ApprovedFacts | null;
  answer: string | null;
  awaitingApproval: boolean;
  complete: boolean;
}
