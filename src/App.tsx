import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DayField, type DayMark } from './components/DayField';
import { DayPanel } from './components/DayPanel';
import { TrackerEditor } from './components/TrackerEditor';
import { db, exportBackup, importBackup } from './lib/db';
import { todayKey } from './lib/dates';
import { streakInfo } from './lib/streaks';

function useToday() {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const id = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

export default function App() {
  const today = useToday();
  const trackers = useLiveQuery(() => db.trackers.orderBy('createdAt').toArray()) ?? [];
  const entries = useLiveQuery(() => db.entries.toArray()) ?? [];
  const noteDates = useLiveQuery(async () => new Set((await db.notes.orderBy('date').uniqueKeys()) as string[])) ?? new Set<string>();

  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState({ key: today, nonce: 0 });
  const [filter, setFilter] = useState<string | null>(null);
  const [view, setView] = useState<'field' | 'trackers' | 'menu'>('field');

  const active = useMemo(() => trackers.filter((t) => !t.archived), [trackers]);
  const colorOf = useMemo(() => new Map(trackers.map((t) => [t.id, t.color])), [trackers]);

  const marks = useMemo(() => {
    const m = new Map<string, DayMark>();
    const get = (k: string) => {
      let v = m.get(k);
      if (!v) m.set(k, (v = { colors: [], note: false }));
      return v;
    };
    for (const e of entries) {
      if (filter && e.trackerId !== filter) continue;
      const c = colorOf.get(e.trackerId);
      if (c) get(e.date).colors.push(c);
    }
    if (!filter) for (const d of noteDates) get(d).note = true;
    return m;
  }, [entries, noteDates, colorOf, filter]);

  const streaks = useMemo(() => {
    const byTracker = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!byTracker.has(e.trackerId)) byTracker.set(e.trackerId, new Set());
      byTracker.get(e.trackerId)!.add(e.date);
    }
    return new Map(active.map((t) => [t.id, streakInfo(byTracker.get(t.id) ?? new Set(), today)]));
  }, [entries, active, today]);

  const goTo = (key: string) => {
    setSelected(key);
    setFocus({ key, nonce: Date.now() });
  };

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  return (
    <div className="app">
      <DayField marks={marks} today={today} selected={selected} focus={focus} panelOpen={!!selected} onSelect={goTo} />

      <header className="top">
        <div className="brand">
          <span className="wordmark">HEPHAESTION</span>
          <span className="sub">{filter ? `FILTER: ${trackers.find((t) => t.id === filter)?.name.toUpperCase()}` : 'FIELD OF DAYS'}</span>
        </div>
        <nav className="actions">
          <button className="ghost" onClick={() => goTo(today)}>TODAY</button>
          <button className="ghost" onClick={() => setView('trackers')}>TRACKERS</button>
          <button className="ghost" onClick={() => setView('menu')} aria-label="Menu">≡</button>
        </nav>
      </header>

      {active.length > 0 && (
        <div className="legend" role="toolbar" aria-label="Filter by tracker">
          {active.map((t) => {
            const s = streaks.get(t.id);
            return (
              <button
                key={t.id}
                className={`chip ${filter === t.id ? 'on' : ''} ${filter && filter !== t.id ? 'dim' : ''}`}
                style={{ '--c': t.color } as React.CSSProperties}
                onClick={() => setFilter(filter === t.id ? null : t.id)}
                title={s ? `Current ${s.current} · Longest ${s.longest} · Total ${s.total}` : undefined}
              >
                <span className="swatch" />
                {t.name.toUpperCase()}
                {s && s.current > 0 && <span className="streak">{s.current}D</span>}
              </button>
            );
          })}
        </div>
      )}

      {active.length === 0 && view === 'field' && !selected && (
        <div className="empty">
          <p>EVERY BOX IS A DAY.</p>
          <p className="muted">Set up what you want to track, then tap a day to mark it and write.</p>
          <button className="solid" onClick={() => setView('trackers')}>BEGIN</button>
        </div>
      )}

      {selected && view === 'field' && (
        <DayPanel
          date={selected}
          today={today}
          trackers={active}
          onDate={goTo}
          onClose={() => setSelected(null)}
          onManageTrackers={() => setView('trackers')}
        />
      )}

      {view === 'trackers' && <TrackerEditor trackers={trackers} onClose={() => setView('field')} />}
      {view === 'menu' && <Menu onClose={() => setView('field')} />}
    </div>
  );
}

function Menu({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const download = async () => {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hephaestion-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Backup saved.');
  };

  const restore = async (file: File) => {
    if (!confirm('Replace everything on this device with this backup?')) return;
    try {
      await importBackup(JSON.parse(await file.text()));
      setMsg('Backup restored.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label="Menu">
      <header className="sheet-head">
        <h2>ARCHIVE</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <p className="muted">
        Everything you write lives only on this device. Nothing is uploaded anywhere. That also means if this
        device is lost or its browser data is cleared, it's gone — so keep a backup.
      </p>
      <div className="sheet-actions column">
        <button className="solid wide" onClick={download}>EXPORT BACKUP</button>
        <button className="ghost wide" onClick={() => fileRef.current?.click()}>RESTORE FROM BACKUP</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
        />
      </div>
      {msg && <p className="status">{msg}</p>}
      <h3>ON YOUR PHONE</h3>
      <p className="muted small">
        Open this page in Safari (iPhone) or Chrome (Android) and choose “Add to Home Screen”. It then opens
        full-screen like an app, works offline, and the browser is far less likely to clear its data.
      </p>
    </div>
  );
}
