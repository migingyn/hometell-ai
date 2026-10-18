export interface CameraFrame { at: number; lat: number; lon: number; range: number; heading: number; pitch: number }
/** Authored camera direction, independent of the skin and event fixtures. */
export const CAMERA_FRAMES: CameraFrame[] = [
  { at: 0, lat: 34.2, lon: -119.0, range: 5100000, heading: 0, pitch: -82 },
  { at: 5, lat: 34.07, lon: -118.32, range: 190000, heading: 5, pitch: -67 },
  { at: 12, lat: 34.065, lon: -118.31, range: 65000, heading: 7, pitch: -48 },
  { at: 36, lat: 34.065, lon: -118.31, range: 60000, heading: 10, pitch: -48 },
  { at: 46, lat: 34.1079, lon: -118.2774, range: 4700, heading: 9, pitch: -48 },
  { at: 61, lat: 34.08975, lon: -118.2624, range: 16500, heading: 9, pitch: -58 },
  { at: 110, lat: 34.08975, lon: -118.2624, range: 15000, heading: 9, pitch: -56 },
  { at: 125, lat: 34.08975, lon: -118.2624, range: 11000, heading: 10, pitch: -52 },
  { at: 140, lat: 34.0716, lon: -118.2475, range: 3000, heading: 12, pitch: -48 },
  { at: 160, lat: 34.0716, lon: -118.2475, range: 3000, heading: 12, pitch: -48 },
  { at: 175, lat: 34.08975, lon: -118.2624, range: 12500, heading: 10, pitch: -54 },
];
export function cameraAt(elapsed: number, reducedMotion: boolean): CameraFrame {
  if (reducedMotion && elapsed < 12) return CAMERA_FRAMES[2];
  const right = CAMERA_FRAMES.findIndex(frame => frame.at > elapsed);
  if (right === -1) return CAMERA_FRAMES.at(-1)!;
  if (right === 0) return CAMERA_FRAMES[0];
  const a = CAMERA_FRAMES[right - 1], b = CAMERA_FRAMES[right];
  let t = (elapsed - a.at) / (b.at - a.at);
  t = t * t * (3 - 2 * t);
  if (reducedMotion) t = 0;
  return { at: elapsed, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
    range: Math.exp(Math.log(a.range) + (Math.log(b.range) - Math.log(a.range)) * t),
    heading: a.heading + (b.heading - a.heading) * t, pitch: a.pitch + (b.pitch - a.pitch) * t };
}
