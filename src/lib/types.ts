/** A detail a tracker can optionally record each day. Every field is optional to fill in. */
export type FieldType = 'number' | 'scale' | 'duration' | 'text';

export interface TrackerField {
  id: string;
  label: string;
  type: FieldType;
  /** Unit shown after a number, e.g. "pages", "kg". */
  unit?: string;
}

export interface Tracker {
  id: string;
  name: string;
  color: string;
  /** Empty means the tracker is a simple did-it / didn't check. */
  fields: TrackerField[];
  /** Counts instead of a single check: can happen more than once a day. */
  multi?: boolean;
  /** Sort position in lists. */
  order?: number;
  createdAt: number;
  archived: boolean;
}

export type FieldValue = number | string;

/** One tracker marked on one day. Its existence means "done"; values are optional detail. */
export interface Entry {
  id: string; // `${date}|${trackerId}`
  date: string; // YYYY-MM-DD, local time
  trackerId: string;
  values: Record<string, FieldValue>;
  /** Times it happened that day, for counting trackers. Absent means once. */
  count?: number;
  updatedAt: number;
}

export interface Deadline {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  /** Optional time of day, HH:MM. */
  time?: string;
  note?: string;
  /** Days before to be reminded (used for the calendar alarm). */
  remindDays?: number;
  done: boolean;
  createdAt: number;
}

/** Something Claude wrote back: a week's summary, a month's chapter, or the arc. */
export interface Reflection {
  id: string; // week:YYYY-MM-DD (its Monday) · month:YYYY-MM · arc
  kind: 'week' | 'month' | 'arc';
  period: string;
  end?: string;
  /** A week reflected on before it was over. */
  partial?: boolean;
  title: string;
  text: string;
  themes?: string[];
  mood?: number; // -1..1
  energy?: number; // 0..1
  tensions?: string[];
  growing?: string[];
  turning?: string;
  createdAt: number;
}

export interface AiUsage {
  id: string;
  at: number;
  month: string; // YYYY-MM
  cost: number; // dollars
  kind: string;
}

export interface Note {
  id: string;
  date: string;
  text: string;
  createdAt: number;
  /** Sealed notes are never sent to AI reflections (once those exist). */
  sealed: boolean;
}
