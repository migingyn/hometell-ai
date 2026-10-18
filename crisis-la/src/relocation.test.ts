import { describe, expect, it } from 'vitest';
import {
  fallbackPoint, fallbackRelocationPath, relocationEndpointVisible,
  relocationGeometry, relocationHeightsChanged,
} from './relocation';

describe('relocation relationship geometry', () => {
  it('joins the exact pin anchors even when the two sites have different terrain heights', () => {
    const school = { lat: 34.1079254, lon: -118.2773743, height: 716.2 };
    const destination = { lat: 34.0716, lon: -118.2475, height: 645.8 };
    const geometry = relocationGeometry(school, destination);
    expect(geometry).toHaveLength(51);
    expect(geometry[0]).toEqual(school);
    expect(geometry.at(-1)).toEqual(destination);
    expect(geometry[25].height).toBeCloseTo((school.height + destination.height) / 2 + 1200);
  });

  it('hides a relationship as soon as an endpoint is offscreen or near a clipped edge', () => {
    const visible = (x: number, y: number) => relocationEndpointVisible({ x, y }, 1000, 700, true, true);
    expect(visible(200, 300)).toBe(true);
    expect(visible(-1, 300)).toBe(false);
    expect(visible(200, -1)).toBe(false);
    expect(visible(1001, 300)).toBe(false);
    expect(visible(200, 701)).toBe(false);
    expect(visible(200, 8)).toBe(false);
  });

  it('rejects points behind the camera or globe despite plausible screen coordinates', () => {
    expect(relocationEndpointVisible({ x: 300, y: 300 }, 1000, 700, false, true)).toBe(false);
    expect(relocationEndpointVisible({ x: 300, y: 300 }, 1000, 700, true, false)).toBe(false);
    expect(relocationEndpointVisible(undefined, 1000, 700, true, true)).toBe(false);
    expect(relocationEndpointVisible({ x: NaN, y: 300 }, 1000, 700, true, true)).toBe(false);
  });

  it('keeps geometry stable until terrain heights change meaningfully', () => {
    expect(relocationHeightsChanged(null, [700, 600])).toBe(true);
    expect(relocationHeightsChanged([700, 600], [700, 600])).toBe(false);
    expect(relocationHeightsChanged([700, 600], [700.3, 599.8])).toBe(false);
    expect(relocationHeightsChanged([700, 600], [701, 600])).toBe(true);
    expect(relocationHeightsChanged([0, 0], [700, 600])).toBe(true);
  });

  it('uses the same fallback coordinate transform for the curve endpoints and pins', () => {
    const school = fallbackPoint(34.1079254, -118.2773743);
    const destination = fallbackPoint(34.0716, -118.2475);
    const path = fallbackRelocationPath(school, destination);
    expect(path.startsWith(`M${school.x} ${school.y} `)).toBe(true);
    expect(path.endsWith(`${destination.x} ${destination.y}`)).toBe(true);
    expect(school.x).toBeCloseTo(576.7871, 3);
    expect(destination.y).toBeCloseTo(366.8571, 3);
  });
});
