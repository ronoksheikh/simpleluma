export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 45) return 'just now';
  const units: Array<[number, string]> = [[60, 'min'], [3600, 'hour'], [86400, 'day'], [2592000, 'month']];
  let label = 'min';
  let value = Math.round(seconds / 60);
  for (const [size, name] of units) {
    if (seconds >= size) {
      label = name;
      value = Math.floor(seconds / size);
    }
  }
  return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

export const timeOfDay = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** 13.7k, 1.2M: compact token counts. */
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const seconds = (s: number): string => `${s.toFixed(s < 10 ? 2 : 1)}s`;

/** "scenes/02-unfold.js" → "Unfold". */
export function sceneLabel(path: string): string {
  const stem = path.split('/').pop()!.replace(/\.m?js$/, '').replace(/^\d+[-_]?/, '');
  return (stem.charAt(0).toUpperCase() + stem.slice(1)).replace(/[-_]+/g, ' ') || path;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
