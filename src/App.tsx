import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DayField, type DayMark, type Dimension } from './components/DayField';
import { DayPanel } from './components/DayPanel';
import { TrackerEditor } from './components/TrackerEditor';
import { Home } from './components/Home';
import { DeadlinesSheet } from './components/Deadlines';
import { ArcSheet } from './components/Arc';
import { START_DATE, db, exportBackup, importBackup, setStartDate, sortTrackers } from './lib/db';
import { AI_AUTO, AI_BUDGET, AI_KEY, BUDGETS, catchUp, setSetting, spentThisMonth, testKey } from './lib/ai';
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

type Sheet = null | 'trackers' | 'newTracker' | 'menu' | 'deadlines' | 'arc';

export default function App() {
  const today = useToday();
  const trackers = useLiveQuery(async () => sortTrackers(await db.trackers.toArray())) ?? [];
  const entries = useLiveQuery(() => db.entries.toArray()) ?? [];
  const noteDates = useLiveQuery(async () => new Set((await db.notes.orderBy('date').uniqueKeys()) as string[])) ?? new Set<string>();
  const deadlines = useLiveQuery(() => db.deadlines.toArray()) ?? [];
  // null = never chosen; undefined = still loading
  const startSetting = useLiveQuery(async () => (await db.settings.get(START_DATE))?.value ?? null);
  const hasKey = !!useLiveQuery(async () => (await db.settings.get(AI_KEY))?.value);

  const [mode, setMode] = useState<'home' | 'field'>('home');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState({ key: today, nonce: 0 });
  const [filter, setFilter] = useState<string | null>(null);
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
      // Counted trackers get one stripe per time (up to 4), so heavy days show it.
      const layers = t.multi ? Math.min(e.count ?? 1, 4) : 1;
      for (let i = 0; i < layers; i++) get(e.date).colors.push(t.color);
    }
    // Keep each day's stripes in tracker order, so they read the same way every day.
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

  // The field begins on the chosen day. Before one is chosen, it begins with your earliest record, or today.
  const startDate = useMemo(() => {
    if (startSetting) return startSetting < today ? startSetting : today;
    let first = today;
    for (const e of entries) if (e.date < first) first = e.date;
    for (const d of noteDates) if (d < first) first = d;
    return first;
  }, [startSetting, entries, noteDates, today]);

  const deadlineDays = useMemo(() => new Set(deadlines.filter((d) => !d.done).map((d) => d.date)), [deadlines]);

  const goTo = (key: string) => {
    if (key < startDate) return;
    setSelected(key);
    setFocus({ key, nonce: Date.now() });
  };

  const enterField = () => {
    setMode('field');
    setSheet(null);
    setSelected(null);
    setFocus({ key: today, nonce: Date.now() });
    setZoomIn(Date.now());
  };

  const goHome = () => {
    setMode('home');
    setSelected(null);
    setSheet(null);
  };

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  // Once a session, quietly catch up on any reflections that are due.
  const caughtUp = useRef(false);
  useEffect(() => {
    if (!hasKey || caughtUp.current || startSetting === undefined) return;
    caughtUp.current = true;
    catchUp(today, startDate).catch(() => {
      /* budget reached or offline: the Arc page offers to try again by hand */
    });
  }, [hasKey, today, startDate, startSetting]);

  const needsWelcome = startSetting === null && active.length === 0;
  const closeSheet = () => setSheet(null);

  return (
    <div className={`app ${mode}`}>
      <DayField
        marks={marks}
        today={today}
        selected={selected}
        deadlines={deadlineDays}
        focus={focus}
        panelOpen={!!selected}
        dimension={dimension}
        zoomIn={zoomIn}
        ambient={mode === 'home'}
        onFlatChange={setFlat}
        onSelect={goTo}
        startDate={startDate}
      />

      {mode === 'home' && !needsWelcome && (
        <Home
          today={today}
          trackers={active}
          deadlines={deadlines}
          hasKey={hasKey}
          onEnterField={enterField}
          onDeadlines={() => setSheet('deadlines')}
          onArc={() => setSheet('arc')}
          onSettings={() => setSheet('menu')}
          onNewTracker={() => setSheet('newTracker')}
        />
      )}

      {needsWelcome && !sheet && (
        <Welcome
          today={today}
          onBegin={async (d) => {
            await setStartDate(d);
            setSheet('trackers');
          }}
        />
      )}

      {mode === 'field' && (
        <>
          <header className="top">
            <button className="back" onClick={goHome} aria-label="Home">
              <span aria-hidden>←</span>
              <span className="brand">
                <span className="wordmark">Hephaestion</span>
                <span className="sub">{filter ? `Showing ${byId.get(filter)?.name}` : 'The field'}</span>
              </span>
            </button>
            <nav className="actions">
              <button className="ghost" onClick={() => goTo(today)}>Today</button>
              <button className="ghost" onClick={() => setSheet('trackers')}>Trackers</button>
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
              <button className="chip add" onClick={() => setSheet('newTracker')} aria-label="New tracker">+</button>
            </div>
          )}

          {selected && !sheet && (
            <DayPanel
              date={selected}
              today={today}
              trackers={active}
              onDate={goTo}
              startDate={startDate}
              onClose={() => setSelected(null)}
              onManageTrackers={() => setSheet('trackers')}
              onNewTracker={() => setSheet('newTracker')}
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
        </>
      )}

      {sheet === 'trackers' && <TrackerEditor trackers={trackers} onClose={closeSheet} />}
      {sheet === 'newTracker' && <TrackerEditor trackers={trackers} startNew onClose={closeSheet} />}
      {sheet === 'deadlines' && <DeadlinesSheet deadlines={deadlines} today={today} onClose={closeSheet} />}
      {sheet === 'arc' && <ArcSheet today={today} hasKey={hasKey} onClose={closeSheet} onSettings={() => setSheet('menu')} />}
      {sheet === 'menu' && <Menu startDate={startDate} today={today} hasKey={hasKey} onClose={closeSheet} />}
    </div>
  );
}

function Welcome({ today, onBegin }: { today: string; onBegin: (d: string) => void }) {
  const [date, setDate] = useState(today);
  return (
    <div className="empty">
      <p>Every box is a day.</p>
      <p className="muted">Where does your field begin? Pick a day that means something: today, a birthday, the start of the year.</p>
      <label className="field">
        <span className="field-label">The first day</span>
        <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      <button className="solid" onClick={() => onBegin(date)}>Begin</button>
    </div>
  );
}

function ClaudeSettings({ hasKey }: { hasKey: boolean }) {
  const [key, setKey] = useState('');
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'bad'>('idle');
  const [err, setErr] = useState('');
  const cap = useLiveQuery(async () => Number((await db.settings.get(AI_BUDGET))?.value ?? 1)) ?? 1;
  const auto = useLiveQuery(async () => (await db.settings.get(AI_AUTO))?.value !== 'off') ?? true;
  const spent = useLiveQuery(() => spentThisMonth()) ?? 0;

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setState('testing');
    setErr('');
    try {
      await testKey(k);
      await setSetting(AI_KEY, k);
      setKey('');
      setState('ok');
    } catch (e) {
      setState('bad');
      setErr(e instanceof Error ? e.message : 'That key didn’t work.');
    }
  };

  return (
    <>
      <h3>Claude</h3>
      <p className="muted small">
        Claude writes your weekly reflections, monthly chapters and arc. It reads only what you haven’t sealed, only when
        a reflection is written, and the results stay on this phone. Get a key at console.anthropic.com (buy credits,
        leave auto-reload off), then paste it here. The key stays on this device and is never included in backups.
      </p>
      {hasKey ? (
        <div className="row">
          <span className="ok-dot" /> Connected
          <button className="link danger" onClick={() => confirm('Remove your API key from this device?') && setSetting(AI_KEY, null)}>
            Remove key
          </button>
        </div>
      ) : (
        <div className="key-row">
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Anthropic API key"
          />
          <button className="solid" onClick={save} disabled={!key.trim() || state === 'testing'}>
            {state === 'testing' ? 'Checking…' : 'Connect'}
          </button>
        </div>
      )}
      {state === 'bad' && <p className="status danger">{err}</p>}
      {state === 'ok' && <p className="status">Connected. Your first reflections will be written next time you open the app.</p>}

      <label className="field">
        <span className="field-label">Monthly budget</span>
        <select value={cap} onChange={(e) => setSetting(AI_BUDGET, e.target.value)}>
          {BUDGETS.map((b) => (
            <option key={b} value={b}>${b.toFixed(2)} a month</option>
          ))}
        </select>
      </label>
      <p className="faint small">
        ${spent.toFixed(2)} used this month. Reflections stop before this would be passed. A typical month costs about $0.25.
      </p>
      <label className="toggle">
        <input type="checkbox" checked={auto} onChange={(e) => setSetting(AI_AUTO, e.target.checked ? 'on' : 'off')} />
        <span>
          Write reflections automatically
          <small>When a week or month ends, the next time you open the app.</small>
        </span>
      </label>
    </>
  );
}

function Menu({ startDate, today, hasKey, onClose }: { startDate: string; today: string; hasKey: boolean; onClose: () => void }) {
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
    <div className="sheet" role="dialog" aria-label="Settings">
      <header className="sheet-head">
        <h2>Settings</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <label className="field">
        <span className="field-label">The field begins on</span>
        <input
          type="date"
          value={startDate}
          max={today}
          onChange={(e) => e.target.value && e.target.value <= today && setStartDate(e.target.value)}
        />
      </label>
      <p className="muted small">Nothing before this day is drawn. Anything you recorded earlier is kept, just hidden.</p>

      <ClaudeSettings hasKey={hasKey} />

      <h3>Backup</h3>
      <p className="muted small">
        Everything you write lives only on this device. If the phone is lost or its browser data is cleared, it's gone,
        so export a backup now and then.
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
        Open this page in Safari and choose Share → “Add to Home Screen”. It then opens full-screen like an app, works
        offline, and Safari is far less likely to clear its data.
      </p>
    </div>
  );
}
