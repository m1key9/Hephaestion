import Dexie, { type EntityTable } from 'dexie';
import type { AiUsage, Deadline, Entry, FieldValue, Note, Reflection, Tracker } from './types';

/** Everything lives in IndexedDB on this device. Nothing is sent anywhere. */
export const db = new Dexie('hephaestion') as Dexie & {
  trackers: EntityTable<Tracker, 'id'>;
  entries: EntityTable<Entry, 'id'>;
  notes: EntityTable<Note, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  deadlines: EntityTable<Deadline, 'id'>;
  reflections: EntityTable<Reflection, 'id'>;
  aiUsage: EntityTable<AiUsage, 'id'>;
};

export interface Setting {
  key: string;
  value: string;
}

db.version(1).stores({
  trackers: 'id, createdAt',
  entries: 'id, date, trackerId',
  notes: 'id, date, createdAt',
});
db.version(2).stores({ settings: 'key' });
db.version(3).stores({ deadlines: 'id, date' });
db.version(4).stores({ reflections: 'id, kind, period', aiUsage: 'id, month' });

/** The first day of the field. Nothing before it is drawn. */
export const START_DATE = 'startDate';

export async function setStartDate(key: string): Promise<void> {
  await db.settings.put({ key: START_DATE, value: key });
}

export const uid = () => crypto.randomUUID();

export const entryId = (date: string, trackerId: string) => `${date}|${trackerId}`;

export async function toggleEntry(date: string, trackerId: string): Promise<void> {
  const id = entryId(date, trackerId);
  const existing = await db.entries.get(id);
  if (existing) await db.entries.delete(id);
  else await db.entries.put({ id, date, trackerId, values: {}, updatedAt: Date.now() });
}

/** For counting trackers: add or remove one occurrence. Reaching zero unmarks the day. */
export async function bumpCount(date: string, trackerId: string, delta: number): Promise<void> {
  const id = entryId(date, trackerId);
  await db.transaction('rw', db.entries, async () => {
    const e = await db.entries.get(id);
    const next = (e ? (e.count ?? 1) : 0) + delta;
    if (next <= 0) {
      if (e) await db.entries.delete(id);
      return;
    }
    await db.entries.put({ ...(e ?? { id, date, trackerId, values: {} }), count: next, updatedAt: Date.now() });
  });
}

export const trackerOrder = (t: Tracker) => t.order ?? t.createdAt;

export function sortTrackers(ts: Tracker[]): Tracker[] {
  return [...ts].sort((a, b) => trackerOrder(a) - trackerOrder(b));
}

/** Swap a tracker with its neighbour in the list. */
export async function moveTracker(list: Tracker[], id: string, dir: -1 | 1): Promise<void> {
  const sorted = sortTrackers(list);
  const i = sorted.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  const updated = sorted.map((t, k) => ({ ...t, order: k }));
  [updated[i].order, updated[j].order] = [j, i];
  await db.trackers.bulkPut(updated);
}

export async function setEntryValue(
  date: string,
  trackerId: string,
  fieldId: string,
  value: FieldValue | null,
): Promise<void> {
  const id = entryId(date, trackerId);
  await db.transaction('rw', db.entries, async () => {
    const e = (await db.entries.get(id)) ?? { id, date, trackerId, values: {}, updatedAt: 0 };
    const values = { ...e.values };
    if (value === null || value === '') delete values[fieldId];
    else values[fieldId] = value;
    await db.entries.put({ ...e, values, updatedAt: Date.now() });
  });
}

export async function deleteTracker(id: string): Promise<void> {
  await db.transaction('rw', db.trackers, db.entries, async () => {
    await db.entries.where('trackerId').equals(id).delete();
    await db.trackers.delete(id);
  });
}

export const STARTERS: { name: string; color: string }[] = [
  { name: 'Reading', color: '#e9e6f2' },
  { name: 'Gym', color: '#ff5d73' },
  { name: 'Latin', color: '#f2b94b' },
  { name: 'Greek', color: '#4f8dff' },
  { name: 'Work', color: '#8f6bff' },
];

export async function addStarters(): Promise<void> {
  const now = Date.now();
  await db.trackers.bulkAdd(
    STARTERS.map((s, i) => ({ id: uid(), name: s.name, color: s.color, fields: [], createdAt: now + i, archived: false })),
  );
}

// ---- backup ----

export interface Backup {
  app: 'hephaestion';
  version: 1;
  exportedAt: string;
  trackers: Tracker[];
  entries: Entry[];
  notes: Note[];
  settings?: Setting[];
  deadlines?: Deadline[];
  reflections?: Reflection[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'hephaestion',
    version: 1,
    exportedAt: new Date().toISOString(),
    trackers: await db.trackers.toArray(),
    entries: await db.entries.toArray(),
    notes: await db.notes.toArray(),
    settings: (await db.settings.toArray()).filter((s) => s.key !== 'aiKey'),
    deadlines: await db.deadlines.toArray(),
    // Your settings travel with the backup, but never your API key.
    reflections: await db.reflections.toArray(),
  };
}

export async function importBackup(data: unknown): Promise<void> {
  const b = data as Backup;
  if (!b || b.app !== 'hephaestion' || !Array.isArray(b.trackers) || !Array.isArray(b.entries) || !Array.isArray(b.notes)) {
    throw new Error('Not a Hephaestion backup file.');
  }
  await db.transaction('rw', [db.trackers, db.entries, db.notes, db.settings, db.deadlines, db.reflections], async () => {
    const key = await db.settings.get('aiKey');
    await Promise.all([
      db.trackers.clear(), db.entries.clear(), db.notes.clear(), db.settings.clear(), db.deadlines.clear(), db.reflections.clear(),
    ]);
    if (key) await db.settings.put(key);
    await db.trackers.bulkPut(b.trackers);
    await db.entries.bulkPut(b.entries);
    await db.notes.bulkPut(b.notes);
    if (Array.isArray(b.settings)) await db.settings.bulkPut(b.settings);
    if (Array.isArray(b.deadlines)) await db.deadlines.bulkPut(b.deadlines);
    if (Array.isArray(b.reflections)) await db.reflections.bulkPut(b.reflections);
  });
}
