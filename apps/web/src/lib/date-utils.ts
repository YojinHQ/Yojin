export function parseUTC(dateStr: string): Date {
  if (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) return new Date(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + 'T00:00:00Z');
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

const ET_HM_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

export function etMinuteOfDay(dateStr: string): number {
  const parts = ET_HM_FORMATTER.formatToParts(parseUTC(dateStr));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}
