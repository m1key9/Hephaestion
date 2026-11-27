import type { Deadline } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

/** Calendar text needs commas, semicolons and newlines escaped. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * A one-event calendar file. Opening it on a phone offers "Add to Calendar", and the alarm inside
 * means the phone's own calendar does the reminding — no server needed.
 */
export function deadlineIcs(d: Deadline, now = new Date()): string {
  const [y, m, day] = d.date.split('-').map(Number);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hephaestion//Deadlines//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'];
  lines.push(`UID:${d.id}@hephaestion`, `DTSTAMP:${stamp(now)}`, `SUMMARY:${esc(d.title)}`);
  if (d.time) {
    const [hh, mm] = d.time.split(':').map(Number);
    const start = new Date(y, m - 1, day, hh, mm);
    const end = new Date(start.getTime() + 30 * 60_000);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
  } else {
    const next = new Date(y, m - 1, day + 1);
    lines.push(`DTSTART;VALUE=DATE:${y}${pad(m)}${pad(day)}`);
    lines.push(`DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`);
  }
  if (d.note) lines.push(`DESCRIPTION:${esc(d.note)}`);
  // Remind on the day itself, plus the chosen number of days before.
  // All-day events count from midnight, so reminders land at 9am; timed ones count from the start.
  for (const days of new Set([0, d.remindDays ?? 0])) {
    let trigger: string;
    if (d.time) trigger = days === 0 ? '-PT1H' : `-P${days}D`;
    else trigger = days === 0 ? 'PT9H' : `-P${days - 1}DT15H`;
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.title)}`, `TRIGGER:${trigger}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Hand the file to the phone: the share sheet where available, otherwise a download. */
export async function addToCalendar(d: Deadline): Promise<void> {
  const name = `${d.title.replace(/[^\w\- ]+/g, '').trim() || 'deadline'}.ics`;
  const file = new File([deadlineIcs(d)], name, { type: 'text/calendar' });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: d.title });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whole days from `today` to the deadline; negative once it's passed. */
export function daysUntil(date: string, today: string): number {
  const [a, b] = [date, today].map((k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((a - b) / 86_400_000);
}
