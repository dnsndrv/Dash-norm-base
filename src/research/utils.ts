import type { Creative, MetricKey } from './types';

export function pct(v: number | null): string {
  return v != null ? (v * 100).toFixed(1) + '%' : '—';
}

export function pctN(v: number | null): number | null {
  return v != null ? Math.round(v * 1000) / 10 : null;
}

export function avg(arr: (number | null)[]): number | null {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function computeAverages(
  creatives: Creative[],
): Record<MetricKey, number | null> {
  const keys: MetricKey[] = [
    'intent', 'like', 'clarity', 'uniqueness', 'brandRecognition',
    'brandRecall', 'productRecall', 'brandFit', 'brandAttitude',
    'interesting', 'relevance', 'useMore', 'startUsing',
    'correctFeatures', 'incorrectFeatures',
  ];
  const result: Partial<Record<MetricKey, number | null>> = {};
  for (const k of keys) {
    result[k] = avg(creatives.map(c => c.metrics[k]));
  }
  return result as Record<MetricKey, number | null>;
}

export function deviationClass(val: number | null, avgVal: number | null): string {
  if (val == null || avgVal == null) return '';
  const diff = val - avgVal;
  if (diff > 0.05) return 'text-[var(--color-success)] bg-[var(--color-success-light)]';
  if (diff < -0.05) return 'text-[var(--color-error)] bg-[var(--color-error-light)]';
  return '';
}

export function pearson(x: (number | null)[], y: (number | null)[]): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] != null && y[i] != null) pairs.push([x[i]!, y[i]!]);
  }
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (const [xi, yi] of pairs) {
    num += (xi - mx) * (yi - my);
    dx += (xi - mx) ** 2;
    dy += (yi - my) ** 2;
  }
  const d = Math.sqrt(dx * dy);
  return d ? num / d : 0;
}

export function avgByKey(
  creatives: Creative[],
  accessor: (c: Creative) => Record<string, number | null> | undefined,
): Record<string, number | null> {
  if (!creatives.length) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const c of creatives) {
    const obj = accessor(c);
    if (!obj) continue;
    for (const [k, v] of Object.entries(obj)) {
      if (v != null) {
        sums[k] = (sums[k] ?? 0) + v;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }
  const result: Record<string, number | null> = {};
  for (const k of Object.keys(sums)) {
    result[k] = counts[k] ? sums[k] / counts[k] : null;
  }
  return result;
}

export function getUniqueValues(creatives: Creative[], field: keyof Creative): string[] {
  return [...new Set(creatives.map(c => String(c[field] ?? '')))].filter(Boolean).sort();
}

/**
 * One-sample z-test for a proportion.
 * p  — observed proportion (filtered average)
 * p0 — reference proportion (global average / norm)
 * n  — effective sample size (sum of respondent bases)
 */
export function zTestProp(
  p: number | null,
  p0: number | null,
  n: number,
): number | null {
  if (p == null || p0 == null || n <= 0) return null;
  if (p0 <= 0 || p0 >= 1) return null;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  return se > 0 ? (p - p0) / se : null;
}

export function zScoreColor(z: number | null): string {
  if (z == null) return '';
  if (z >= 1.96) return 'text-[var(--color-success)]';
  if (z <= -1.96) return 'text-[var(--color-error)]';
  if (z >= 1.645) return 'text-[var(--color-success)] opacity-60';
  if (z <= -1.645) return 'text-[var(--color-error)] opacity-60';
  return '';
}

export function totalBase(creatives: Creative[]): number {
  return creatives.reduce((s, c) => s + (c.base || 0), 0);
}
