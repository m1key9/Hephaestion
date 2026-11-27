/** All dates are local calendar days, keyed as YYYY-MM-DD. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Monday = 0 … Sunday = 6. */
export function weekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function daysInYear(year: number): number {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

/** Row of a day inside its year's block: weeks run Monday→Sunday, row 0 holds Jan 1. */
export function weekRow(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.round((d.getTime() - jan1.getTime()) / 86_400_000);
  return Math.floor((dayOfYear + weekday(jan1)) / 7);
}

/** Every day of a year with its grid cell. */
export function yearCells(year: number): { key: string; col: number; row: number }[] {
  const cells = [];
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    cells.push({ key: toKey(d), col: weekday(d), row: weekRow(d) });
    d.setDate(d.getDate() + 1);
  }
  return cells;
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatLong(key: string): string {
  const d = fromKey(key);
  return `${DAYS[weekday(d)]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayOfYear(key: string): number {
  const d = fromKey(key);
  return Math.round((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
}
