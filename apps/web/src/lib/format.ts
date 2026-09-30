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
