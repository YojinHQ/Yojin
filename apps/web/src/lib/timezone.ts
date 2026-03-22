const TIMEZONE_KEY = 'yojin-timezone';

export function getTimezone(): string {
  const stored = localStorage.getItem(TIMEZONE_KEY);
  if (stored) return stored;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

export function setTimezone(tz: string): void {
  localStorage.setItem(TIMEZONE_KEY, tz);
}
