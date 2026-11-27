import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { fromKey } from '../lib/dates';
import type { Deadline, Tracker } from '../lib/types';
import { Composer, Pill } from './DayPanel';
import { DeadlineRow, sortDeadlines } from './Deadlines';

interface Props {
  today: string;
  trackers: Tracker[];
  deadlines: Deadline[];
  hasKey: boolean;
  onEnterField: () => void;
  onDeadlines: () => void;
  onArc: () => void;
  onSettings: () => void;
  onNewTracker: () => void;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

/** The centre: today at a glance, what's coming, what the arc says, and the way into the field. */
export function Home({ today, trackers, deadlines, hasKey, onEnterField, onDeadlines, onArc, onSettings, onNewTracker }: Props) {
  const entries = useLiveQuery(() => db.entries.where('date').equals(today).toArray(), [today]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('date').equals(today).sortBy('createdAt'), [today]) ?? [];
  const latest = useLiveQuery(async () => {
    const weeks = await db.reflections.where('kind').equals('week').toArray();
    return weeks.sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
  });
  const arc = useLiveQuery(() => db.reflections.get('arc'));
  const byTracker = new Map(entries.map((e) => [e.trackerId, e]));
  const upcoming = sortDeadlines(deadlines).filter((d) => !d.done).slice(0, 3);
  const d = fromKey(today);

  return (
    <main className="home">
      <header className="home-top">
        <span className="wordmark">Hephaestion</span>
        <button className="icon" onClick={onSettings} aria-label="Settings">⋯</button>
      </header>

      <section className="home-date">
        <span className="home-greet">{greeting()}</span>
        <h1>
          {d.toLocaleDateString(undefined, { weekday: 'long' })}
          <span>{d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</span>
        </h1>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Today</h3>
        </div>
        {trackers.length ? (
          <div className="pills">
            {trackers.map((t) => (
              <Pill key={t.id} tracker={t} date={today} entry={byTracker.get(t.id)} open={false} onDetails={onEnterField} />
            ))}
            <button className="pill add" onClick={onNewTracker} aria-label="Track something new">+</button>
          </div>
        ) : (
          <button className="link" onClick={onNewTracker}>Set up what you want to track</button>
        )}
        {notes.length > 0 && (
          <ul className="notes home-notes">
            {notes.map((n) => (
              <li key={n.id} className="note"><p>{n.text}</p></li>
            ))}
          </ul>
        )}
        <Composer date={today} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Deadlines</h3>
          <button className="link" onClick={onDeadlines}>{upcoming.length ? 'All' : '+ Add'}</button>
        </div>
        {upcoming.length ? (
          <ul className="deadlines">
            {upcoming.map((x) => (
              <DeadlineRow key={x.id} d={x} today={today} onEdit={onDeadlines} />
            ))}
          </ul>
        ) : (
          <p className="faint small">Nothing pressing.</p>
        )}
      </section>

      <button className="card reflection" onClick={onArc}>
        <div className="card-head">
          <h3>Your arc</h3>
          {arc && <span className="archetype-chip">{arc.title}</span>}
        </div>
        {latest ? (
          <>
            <span className="faint small">{latest.title}{latest.partial ? ' · so far' : ''}</span>
            <p>{latest.text}</p>
          </>
        ) : (
          <p className="muted">
            {hasKey
              ? 'Your first reflection arrives once a week has something in it.'
              : 'Connect Claude to get a short reflection each week and a portrait of your arc over time.'}
          </p>
        )}
      </button>

      <button className="enter" onClick={onEnterField}>
        <span>Enter the field</span>
        <span className="enter-arrow" aria-hidden>→</span>
      </button>
    </main>
  );
}
