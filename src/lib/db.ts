import Dexie, { type EntityTable } from 'dexie';
import type { Entry, FieldValue, Note, Tracker } from './types';

/** Everything lives in IndexedDB on this device. Nothing is sent anywhere. */
export const db = new Dexie('hephaestion') as Dexie & {
  trackers: EntityTable<Tracker, 'id'>;
  entries: EntityTable<Entry, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  trackers: 'id, createdAt',
  entries: 'id, date, trackerId',
  notes: 'id, date, createdAt',
});

export const uid = () => crypto.randomUUID();

export const entryId = (date: string, trackerId: string) => `${date}|${trackerId}`;

export async function toggleEntry(date: string, trackerId: string): Promise<void> {
  const id = entryId(date, trackerId);
  const existing = await db.entries.get(id);
  if (existing) await db.entries.delete(id);
  else await db.entries.put({ id, date, trackerId, values: {}, updatedAt: Date.now() });
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
  { name: 'Reading', color: '#e8e1cf' },
  { name: 'Gym', color: '#ff3b1f' },
  { name: 'Latin', color: '#c9a227' },
  { name: 'Greek', color: '#2f6bff' },
  { name: 'Work', color: '#7a7a72' },
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
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'hephaestion',
    version: 1,
    exportedAt: new Date().toISOString(),
    trackers: await db.trackers.toArray(),
    entries: await db.entries.toArray(),
    notes: await db.notes.toArray(),
  };
}

export async function importBackup(data: unknown): Promise<void> {
  const b = data as Backup;
  if (!b || b.app !== 'hephaestion' || !Array.isArray(b.trackers) || !Array.isArray(b.entries) || !Array.isArray(b.notes)) {
    throw new Error('Not a Hephaestion backup file.');
  }
  await db.transaction('rw', db.trackers, db.entries, db.notes, async () => {
    await Promise.all([db.trackers.clear(), db.entries.clear(), db.notes.clear()]);
    await db.trackers.bulkPut(b.trackers);
    await db.entries.bulkPut(b.entries);
    await db.notes.bulkPut(b.notes);
  });
}
