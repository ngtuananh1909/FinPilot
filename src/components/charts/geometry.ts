/** Pure chart geometry: no React, no DOM, no financial rules. */

export interface XY {
  x: number;
  y: number;
}

export interface XValue {
  x: number;
  value: number;
}

/** Maps a domain interval onto a pixel interval. A zero-width domain maps to the range midpoint. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/**
 * Y domain covering every value with padding so lines never touch the frame.
 * Flat series and single values get a visible range instead of a zero-height one.
 */
export function computeYDomain(values: readonly number[], padRatio = 0.1): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [-1, 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  let pad = (max - min) * padRatio;
  if (pad === 0) pad = Math.max(Math.abs(max) * padRatio, 1);
  return [min - pad, max + pad];
}

/** "Nice" tick values (1, 2, 5 x 10^n) inside [min, max]. Always sorted ascending, no -0. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  const rawStep = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  const step = niceResidual * magnitude;
  const ticks: number[] = [];
  for (let k = Math.ceil(min / step); k * step <= max; k += 1) {
    const tick = k * step;
    ticks.push(tick === 0 ? 0 : tick);
  }
  return ticks;
}

/**
 * Indices of the x labels to print: first and last always, evenly spread, at most `maxLabels`.
 * Pick `maxLabels` from the pixel width so labels never overlap (about 50-56px per "24/11").
 */
export function selectTickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const labels = Math.min(count, Math.max(2, Math.floor(maxLabels)));
  const indices = new Set<number>();
  for (let i = 0; i < labels; i += 1) indices.add(Math.round((i * (count - 1)) / (labels - 1)));
  return [...indices].sort((a, b) => a - b);
}

/** Largest label count that keeps `minSpacingPx` between labels over `innerWidthPx`. */
export function maxLabelsFor(innerWidthPx: number, minSpacingPx: number): number {
  return Math.max(2, Math.floor(innerWidthPx / minSpacingPx) + 1);
}

const round2 = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path "M x y L x y ..." for a polyline. Empty for no points. */
export function linePath(points: readonly XY[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round2(p.x)} ${round2(p.y)}`).join("");
}

/**
 * Polygons (in data space) between a series and a horizontal threshold, wherever the series is
 * strictly below it. Crossings are interpolated so the shading starts and ends exactly on the
 * threshold. Each polygon is closed back along the threshold. A value equal to the threshold is
 * NOT below it (same rule as the engine: breach means balance < reserve).
 */
export function belowThresholdPolygons(points: readonly XValue[], threshold: number): XValue[][] {
  const polygons: XValue[][] = [];
  let current: XValue[] | null = null;
  const finish = () => {
    if (current && current.length >= 2) {
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (last.x !== first.x) polygons.push([...current, { x: last.x, value: threshold }, { x: first.x, value: threshold }]);
    }
    current = null;
  };
  const crossing = (a: XValue, b: XValue): XValue => ({
    x: a.x + ((threshold - a.value) / (b.value - a.value)) * (b.x - a.x),
    value: threshold,
  });
  points.forEach((point, i) => {
    const below = point.value < threshold;
    const prev = i > 0 ? points[i - 1]! : null;
    const prevBelow = prev ? prev.value < threshold : false;
    if (prev && below !== prevBelow) {
      const cross = crossing(prev, point);
      if (below) current = [cross];
      else current?.push(cross);
    }
    if (below) {
      if (!current) current = [];
      current.push(point);
    } else {
      finish();
    }
  });
  finish();
  return polygons;
}

export function polygonPath(points: readonly XY[]): string {
  return points.length === 0 ? "" : `${linePath(points)}Z`;
}
