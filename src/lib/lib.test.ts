import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addDays, fromKey, toKey, weekRow, yearCells } from './dates';
import { streakInfo } from './streaks';
import { bumpCount, db, exportBackup, importBackup, moveTracker, setEntryValue, sortTrackers, toggleEntry } from './db';

describe('dates', () => {
  it('round-trips keys and crosses month/year boundaries', () => {
    expect(toKey(fromKey('2026-03-09'))).toBe('2026-03-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('lays out a year in Monday-first week rows', () => {
    const cells = yearCells(2026);
    expect(cells).toHaveLength(365);
    // 2026-01-01 is a Thursday.
    expect(cells[0]).toEqual({ key: '2026-01-01', col: 3, row: 0 });
    expect(weekRow(fromKey('2026-01-05'))).toBe(1); // first Monday
    expect(yearCells(2024)).toHaveLength(366);
  });
});

describe('streaks', () => {
  it('counts current streak from yesterday when today is not marked', () => {
    const s = streakInfo(new Set(['2026-11-24', '2026-11-25', '2026-11-26']), '2026-11-27');
    expect(s.current).toBe(3);
  });
  it('tracks longest and total', () => {
    const s = streakInfo(new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-02-10', '2026-11-27']), '2026-11-27');
    expect(s).toEqual({ current: 1, longest: 3, total: 5 });
  });
  it('is zero when the chain is broken', () => {
    expect(streakInfo(new Set(['2026-11-20']), '2026-11-27').current).toBe(0);
  });
});

describe('db', () => {
  it('toggles entries, stores optional detail, and round-trips a backup', async () => {
    await db.trackers.put({ id: 't1', name: 'Gym', color: '#f00', fields: [], createdAt: 1, archived: false });
    await toggleEntry('2026-11-27', 't1');
    expect(await db.entries.count()).toBe(1);
    await setEntryValue('2026-11-27', 't1', 'f1', 5);
    expect((await db.entries.get('2026-11-27|t1'))?.values).toEqual({ f1: 5 });

    const backup = await exportBackup();
    await toggleEntry('2026-11-27', 't1');
    expect(await db.entries.count()).toBe(0);
    await importBackup(JSON.parse(JSON.stringify(backup)));
    expect(await db.entries.count()).toBe(1);
    await expect(importBackup({ nope: true })).rejects.toThrow();
  });

  it('counts repeat occurrences and unmarks at zero', async () => {
    await bumpCount('2026-11-26', 't1', 1);
    await bumpCount('2026-11-26', 't1', 1);
    expect((await db.entries.get('2026-11-26|t1'))?.count).toBe(2);
    await bumpCount('2026-11-26', 't1', -1);
    await bumpCount('2026-11-26', 't1', -1);
    expect(await db.entries.get('2026-11-26|t1')).toBeUndefined();
  });

  it('reorders trackers', async () => {
    await db.trackers.put({ id: 't2', name: 'Latin', color: '#ff0', fields: [], createdAt: 2, archived: false });
    await moveTracker(await db.trackers.toArray(), 't2', -1);
    expect(sortTrackers(await db.trackers.toArray()).map((t) => t.id)).toEqual(['t2', 't1']);
  });
});

describe('deadlines', async () => {
  const { deadlineIcs, daysUntil } = await import('./ics');
  it('counts days to a deadline', () => {
    expect(daysUntil('2026-12-01', '2026-11-27')).toBe(4);
    expect(daysUntil('2026-11-20', '2026-11-27')).toBe(-7);
  });
  it('writes an all-day calendar event with reminders', () => {
    const ics = deadlineIcs(
      { id: 'd1', title: 'Latin exam, part 2', date: '2026-12-10', remindDays: 3, done: false, createdAt: 0 },
      new Date(Date.UTC(2026, 10, 27)),
    );
    expect(ics).toContain('SUMMARY:Latin exam\\, part 2');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261210');
    expect(ics).toContain('DTEND;VALUE=DATE:20261211');
    expect(ics).toContain('TRIGGER:PT9H');
    expect(ics).toContain('TRIGGER:-P2DT15H');
  });
});
