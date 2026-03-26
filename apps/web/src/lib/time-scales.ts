export const timeScales = ['7D', '1M', '3M', 'YTD'] as const;
export type TimeScale = (typeof timeScales)[number];

const SCALE_DAYS: Record<TimeScale, number> = {
  '7D': 7,
  '1M': 30,
  '3M': 90,
  YTD: Infinity,
};

export function getScaleDays(scale: TimeScale): number {
  if (scale === 'YTD') {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000));
  }
  return SCALE_DAYS[scale];
}
