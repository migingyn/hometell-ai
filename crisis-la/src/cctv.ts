import { SITES } from './scenario';

export interface ScenarioCamera {
  id: 'school' | 'stadium';
  code: string;
  name: string;
  location: string;
  image: string;
  lat: number;
  lon: number;
  availableAt: number;
  reportId: string;
  observation: string;
  question: string;
  direction: string;
}

/** Authored camera fixtures. Images are scene recreations, not real CCTV. */
export const SCENARIO_CAMERAS: ScenarioCamera[] = [
  {
    id: 'school', code: 'LA-014', name: 'School entrance', location: 'John Marshall High · illustrative view',
    image: '/cameras/school.png', lat: SITES.school.lat, lon: SITES.school.lon,
    availableAt: 20, reportId: 'school-original', direction: 'Entrance approach',
    observation: 'Standing water and a barricade at the entrance.',
    question: 'Has pickup moved? Check with the coordinator.',
  },
  {
    id: 'stadium', code: 'LA-027', name: 'Supply staging', location: 'Dodger Stadium · illustrative view',
    image: '/cameras/stadium.png', lat: SITES.destination.lat, lon: SITES.destination.lon,
    availableAt: 75, reportId: 'destination-field-note', direction: 'Parking area',
    observation: 'Tents, water cases, and a truck in the staging area.',
    question: 'Are supplies available to callers? Confirm by phone.',
  },
];

export function camerasAt(elapsed: number): ScenarioCamera[] {
  return SCENARIO_CAMERAS.filter(camera => camera.availableAt <= elapsed);
}

export function cameraForTime(elapsed: number, selectedId: string | null): ScenarioCamera | null {
  const available = camerasAt(elapsed);
  return available.find(camera => camera.id === selectedId) ?? available.at(-1) ?? null;
}

export function cameraClock(seconds: number): string {
  const time = 13 * 3600 + 42 * 60 + Math.max(0, Math.floor(seconds));
  return [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

export function frameAge(camera: ScenarioCamera, elapsed: number): string {
  const age = Math.max(0, Math.floor(elapsed - camera.availableAt));
  return age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ${age % 60}s ago`;
}
