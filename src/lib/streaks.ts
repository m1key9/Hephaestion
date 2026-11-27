import { addDays } from './dates';

export interface StreakInfo {
  current: number;
  longest: number;
  total: number;
}

/**
 * Current streak counts back from today; if today isn't marked yet it counts back
 * from yesterday, so an unbroken streak doesn't read as 0 before you've logged today.
 */
export function streakInfo(days: Set<string>, today: string): StreakInfo {
  let start = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(start)) {
    current++;
    start = addDays(start, -1);
  }

  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest, total: days.size };
}
