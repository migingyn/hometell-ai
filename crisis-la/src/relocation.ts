export interface RelocationAnchor {
  lat: number;
  lon: number;
  height: number;
}

export interface ScreenPoint { x: number; y: number }

/** A geographic relationship, raised between the same anchors as the site pins. */
export function relocationGeometry(start: RelocationAnchor, end: RelocationAnchor): RelocationAnchor[] {
  return Array.from({ length: 51 }, (_, index) => {
    // Preserve exact endpoint heights, rather than a nearly-zero sine offset.
    if (index === 0) return { ...start };
    if (index === 50) return { ...end };
    const t = index / 50;
    return {
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
      height: start.height + (end.height - start.height) * t + Math.sin(t * Math.PI) * 1200,
    };
  });
}

/** A relationship is meaningful only when both complete anchors are in view. */
export function relocationEndpointVisible(
  point: ScreenPoint | undefined,
  width: number,
  height: number,
  inFront: boolean,
  globeVisible: boolean,
): boolean {
  const margin = 18;
  return Boolean(
    point && inFront && globeVisible &&
    Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= margin && point.x <= width - margin &&
    point.y >= margin && point.y <= height - margin,
  );
}

/** Ignore sub-meter terrain refinement so a static relationship cannot jitter. */
export function relocationHeightsChanged(previous: readonly number[] | null, next: readonly number[]): boolean {
  return !previous || previous.length !== next.length ||
    next.some((height, index) => Math.abs(height - previous[index]) > 0.5);
}

/** Matches the fallback map's percentage-based marker positions exactly. */
export function fallbackPoint(lat: number, lon: number): ScreenPoint {
  return { x: (lon + 118.56) / 0.49 * 1000, y: (34.2 - lat) / 0.28 * 800 };
}

export function fallbackRelocationPath(start: ScreenPoint, end: ScreenPoint): string {
  return `M${start.x} ${start.y} Q${(start.x + end.x) / 2 + 160} ${(start.y + end.y) / 2} ${end.x} ${end.y}`;
}
