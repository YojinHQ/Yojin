import { useState, useEffect } from 'react';

type MarketStatus = 'open' | 'pre-market' | 'after-hours' | 'closed';

interface MarketState {
  status: MarketStatus;
  label: string;
}

/** Returns current US equity market status based on NYSE hours (Eastern Time). */
export function useMarketStatus(): MarketState {
  const [state, setState] = useState<MarketState>(() => compute());

  useEffect(() => {
    const id = setInterval(() => setState(compute()), 60_000);
    return () => clearInterval(id);
  }, []);

  return state;
}

function compute(): MarketState {
  const now = new Date();
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const day = et.weekday;
  const hour = parseInt(et.hour, 10);
  const minute = parseInt(et.minute, 10);
  const time = hour * 60 + minute;

  // Weekends
  if (day === 'Sat' || day === 'Sun') return { status: 'closed', label: 'Closed' };

  // Pre-market: 4:00 AM – 9:29 AM ET
  if (time >= 240 && time < 570) return { status: 'pre-market', label: 'Pre-Market' };

  // Regular: 9:30 AM – 3:59 PM ET
  if (time >= 570 && time < 960) return { status: 'open', label: 'Market Open' };

  // After-hours: 4:00 PM – 7:59 PM ET
  if (time >= 960 && time < 1200) return { status: 'after-hours', label: 'After Hours' };

  return { status: 'closed', label: 'Closed' };
}
