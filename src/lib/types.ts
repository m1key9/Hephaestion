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
  updatedAt: number;
}

export interface Note {
  id: string;
  date: string;
  text: string;
  createdAt: number;
  /** Sealed notes are never sent to AI reflections (once those exist). */
  sealed: boolean;
}
