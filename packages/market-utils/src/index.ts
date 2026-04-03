/**
 * NYSE observed holidays for 2026–2027.
 * Source: https://www.nyse.com/trade/hours-calendars
 * Note: 2025 dates omitted — already passed. TODO: Add 2028 dates when NYSE publishes them.
 */
export const US_MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King, Jr. Day
  '2026-02-16', // Washington's Birthday
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed — Jul 4 is Sat)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King, Jr. Day
  '2027-02-15', // Washington's Birthday
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed — Jun 19 is Sat)
  '2027-07-05', // Independence Day (observed — Jul 4 is Sun)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving Day
  '2027-12-24', // Christmas Day (observed — Dec 25 is Sat)
]);

/** Check if a YYYY-MM-DD date string falls on an NYSE holiday. */
export function isUSMarketHoliday(dateKey: string): boolean {
  return US_MARKET_HOLIDAYS.has(dateKey);
}

/** Format a Date (assumed already in ET) to a YYYY-MM-DD key. */
export function toMarketDateKey(et: Date): string {
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}
