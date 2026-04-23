export function parseUTC(dateStr: string): Date {
  if (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

export function etMinuteOfDay(dateStr: string): number {
  const d = parseUTC(dateStr);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}
