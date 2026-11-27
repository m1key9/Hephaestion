import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DayField, type DayMark, type Dimension } from './components/DayField';
import { DayPanel } from './components/DayPanel';
import { TrackerEditor } from './components/TrackerEditor';
import { db, exportBackup, importBackup, sortTrackers } from './lib/db';
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

const DIM_KEY = 'hephaestion.dimension';

function loadDimension(): Dimension {
  try {
    return localStorage.getItem(DIM_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

export default function App() {
  const today = useToday();
  const trackers = useLiveQuery(async () => sortTrackers(await db.trackers.toArray())) ?? [];
  const entries = useLiveQuery(() => db.entries.toArray()) ?? [];
  const noteDates = useLiveQuery(async () => new Set((await db.notes.orderBy('date').uniqueKeys()) as string[])) ?? new Set<string>();

  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState({ key: today, nonce: 0 });
  const [filter, setFilter] = useState<string | null>(null);
  const [view, setView] = useState<'field' | 'trackers' | 'newTracker' | 'menu'>('field');
  const [dimension, setDimension] = useState<Dimension>(loadDimension);
  const [flat, setFlat] = useState(dimension === '2d');
  const [zoomIn, setZoomIn] = useState(0);

  const toggleDimension = () => {
    // Showing flat (by choice or because you zoomed out): go back to 3D, zooming in if needed.
    const next: Dimension = flat ? '3d' : '2d';
    if (flat) setZoomIn(Date.now());
    setDimension(next);
    try {
      localStorage.setItem(DIM_KEY, next);
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  };

  const active = useMemo(() => trackers.filter((t) => !t.archived), [trackers]);
  const byId = useMemo(() => new Map(trackers.map((t) => [t.id, t])), [trackers]);

  const marks = useMemo(() => {
    const m = new Map<string, DayMark>();
    const get = (k: string) => {
      let v = m.get(k);
      if (!v) m.set(k, (v = { colors: [], note: false }));
      return v;
    };
    for (const e of entries) {
      if (filter && e.trackerId !== filter) continue;
      const t = byId.get(e.trackerId);
      if (!t) continue;
      // Counted trackers stack one layer per time (up to 4), so heavy days stand taller.
      const layers = t.multi ? Math.min(e.count ?? 1, 4) : 1;
      for (let i = 0; i < layers; i++) get(e.date).colors.push(t.color);
    }
    // Keep each day's layers in tracker order, so stacks read the same way every day.
    const rank = new Map(trackers.map((t, i) => [t.color, i]));
    for (const v of m.values()) v.colors.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    if (!filter) for (const d of noteDates) get(d).note = true;
    return m;
  }, [entries, noteDates, byId, trackers, filter]);

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
      <DayField
        marks={marks}
        today={today}
        selected={selected}
        focus={focus}
        panelOpen={!!selected}
        dimension={dimension}
        zoomIn={zoomIn}
        onFlatChange={setFlat}
        onSelect={goTo}
      />

      <header className="top">
        <div className="brand">
          <span className="wordmark">Hephaestion</span>
          <span className="sub">{filter ? `Showing ${byId.get(filter)?.name}` : 'A field of days'}</span>
        </div>
        <nav className="actions">
          <button className="ghost" onClick={() => goTo(today)}>Today</button>
          <button className="ghost" onClick={() => setView('trackers')}>Trackers</button>
          <button className="ghost" onClick={() => setView('menu')} aria-label="Menu">•••</button>
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
                title={s ? `${s.current} days running · longest ${s.longest} · ${s.total} in all` : undefined}
              >
                <span className="swatch" />
                {t.name}
                {s && s.current > 0 && <span className="streak">· {s.current}</span>}
              </button>
            );
          })}
          <button className="chip add" onClick={() => setView('newTracker')} aria-label="New tracker">+</button>
        </div>
      )}

      {active.length === 0 && view === 'field' && !selected && (
        <div className="empty">
          <p>Every box is a day.</p>
          <p className="muted">Set up what you want to track, then tap a day to mark it and write.</p>
          <button className="solid" onClick={() => setView('trackers')}>Begin</button>
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
          onNewTracker={() => setView('newTracker')}
        />
      )}

      <button
        className="dims"
        onClick={toggleDimension}
        aria-label={flat ? 'Switch to 3D' : 'Switch to flat 2D map'}
        title={flat ? 'Switch to 3D' : 'Switch to flat 2D map'}
      >
        {flat ? '3D' : '2D'}
      </button>

      {view === 'trackers' && <TrackerEditor trackers={trackers} onClose={() => setView('field')} />}
      {view === 'newTracker' && <TrackerEditor trackers={trackers} startNew onClose={() => setView('field')} />}
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
        <h2>Archive</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <p className="muted">
        Everything you write lives only on this device. Nothing is uploaded anywhere. That also means if this
        device is lost or its browser data is cleared, it's gone — so keep a backup.
      </p>
      <div className="sheet-actions column">
        <button className="solid wide" onClick={download}>Export backup</button>
        <button className="ghost wide" onClick={() => fileRef.current?.click()}>Restore from backup</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
        />
      </div>
      {msg && <p className="status">{msg}</p>}
      <h3>On your phone</h3>
      <p className="muted small">
        Open this page in Safari (iPhone) or Chrome (Android) and choose “Add to Home Screen”. It then opens
        full-screen like an app, works offline, and the browser is far less likely to clear its data.
      </p>
    </div>
  );
}
