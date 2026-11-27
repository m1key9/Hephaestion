import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { bumpCount, db, setEntryValue, toggleEntry, uid } from '../lib/db';
import { addDays, dayOfYear, fromKey } from '../lib/dates';
import type { Entry, FieldValue, Tracker, TrackerField } from '../lib/types';

const NOTE_SOFT_LIMIT = 280;

interface Props {
  date: string;
  today: string;
  trackers: Tracker[];
  onDate: (key: string) => void;
  onClose: () => void;
  onManageTrackers: () => void;
  onNewTracker: () => void;
}

export function DayPanel({ date, today, trackers, onDate, onClose, onManageTrackers, onNewTracker }: Props) {
  const entries = useLiveQuery(() => db.entries.where('date').equals(date).toArray(), [date]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('date').equals(date).sortBy('createdAt'), [date]) ?? [];
  const byTracker = new Map(entries.map((e) => [e.trackerId, e]));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = trackers.find((t) => t.id === openId && t.fields.length > 0);

  const d = fromKey(date);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const monthYear = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const when = date === today ? 'Today' : date > today ? 'Not yet' : weekday;

  return (
    <aside className="panel" aria-label={`Day ${date}`}>
      <div className="grabber" aria-hidden />
      <header className="day-head">
        <div className="day-date">
          <span className="day-num">{d.getDate()}</span>
          <span className="day-words">
            <span className="day-when">{when}</span>
            <span className="day-month" title={`Day ${dayOfYear(date)} of the year`}>{monthYear}</span>
          </span>
        </div>
        <nav className="day-nav">
          <button className="icon" onClick={() => onDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <button className="icon" onClick={() => onDate(addDays(date, 1))} aria-label="Next day">›</button>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </nav>
      </header>

      {trackers.length === 0 ? (
        <p className="muted">
          Nothing to track yet. <button className="link" onClick={onManageTrackers}>Set up trackers</button>
        </p>
      ) : (
        <div className="pills">
          {trackers.map((t) => (
            <Pill
              key={t.id}
              tracker={t}
              date={date}
              entry={byTracker.get(t.id)}
              open={openId === t.id}
              onDetails={() => setOpenId(openId === t.id ? null : t.id)}
            />
          ))}
          <button className="pill add" onClick={onNewTracker} aria-label="Track something new">+</button>
        </div>
      )}

      {open && (
        <div className="details" style={{ '--c': open.color } as React.CSSProperties}>
          <div className="details-title">{open.name}</div>
          {open.fields.map((f) => (
            <FieldInput
              key={`${f.id}-${date}`}
              field={f}
              value={byTracker.get(open.id)?.values[f.id]}
              onChange={(v) => setEntryValue(date, open.id, f.id, v)}
            />
          ))}
          <p className="faint small">Optional. Filling one in marks the day.</p>
        </div>
      )}

      <section className="notes-section">
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <p>{n.text}</p>
              <div className="note-meta">
                <span>{new Date(n.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                {n.sealed && <span className="sealed" title="Never shared with AI reflections">sealed</span>}
                <button
                  className="note-delete"
                  onClick={() => confirm('Delete this note?') && db.notes.delete(n.id)}
                  aria-label="Delete note"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <Composer date={date} />
      </section>
    </aside>
  );
}

function Pill({ tracker, date, entry, open, onDetails }: {
  tracker: Tracker; date: string; entry?: Entry; open: boolean; onDetails: () => void;
}) {
  const done = !!entry;
  const count = entry ? (entry.count ?? 1) : 0;
  const hasFields = tracker.fields.length > 0;
  const summary =
    done && hasFields
      ? tracker.fields
          .filter((f) => entry.values[f.id] !== undefined)
          .map((f) => formatValue(f, entry.values[f.id]))
          .join(' · ')
      : '';

  return (
    <div className={`pill ${done ? 'done' : ''} ${open ? 'open' : ''}`} style={{ '--c': tracker.color } as React.CSSProperties}>
      <button
        className="pill-main"
        onClick={() => (tracker.multi ? bumpCount(date, tracker.id, 1) : toggleEntry(date, tracker.id))}
        aria-pressed={done}
      >
        <span className="dot" />
        <span>{tracker.name}</span>
        {tracker.multi && count > 0 && <span className="pill-count">{count}</span>}
        {summary && <span className="pill-sum">{summary}</span>}
      </button>
      {tracker.multi && done && (
        <button className="pill-side" onClick={() => bumpCount(date, tracker.id, -1)} aria-label={`One less ${tracker.name}`}>
          −
        </button>
      )}
      {hasFields && (
        <button className="pill-side" onClick={onDetails} aria-expanded={open} aria-label={`${tracker.name} details`}>
          {open ? '–' : '…'}
        </button>
      )}
    </div>
  );
}

function formatValue(f: TrackerField, v: FieldValue): string {
  if (f.type === 'scale') return `${v}/5`;
  if (f.type === 'duration') {
    const m = Number(v);
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  }
  if (f.type === 'number') return `${v}${f.unit ? ` ${f.unit}` : ''}`;
  return String(v);
}

function FieldInput({ field, value, onChange }: { field: TrackerField; value?: FieldValue; onChange: (v: FieldValue | null) => void }) {
  const id = `f-${field.id}`;
  if (field.type === 'scale') {
    return (
      <div className="field">
        <span className="field-label">{field.label}</span>
        <div className="scale">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={value === n ? 'on' : ''} onClick={() => onChange(value === n ? null : n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'text') {
    return (
      <label className="field" htmlFor={id}>
        <span className="field-label">{field.label}</span>
        <input id={id} type="text" defaultValue={(value as string) ?? ''} onBlur={(e) => onChange(e.target.value.trim() || null)} />
      </label>
    );
  }
  const unit = field.type === 'duration' ? 'min' : field.unit;
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{field.label}</span>
      <span className="num">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          defaultValue={value ?? ''}
          onBlur={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

function Composer({ date }: { date: string }) {
  const [text, setText] = useState('');
  const [sealed, setSealed] = useState(false);
  const post = async () => {
    const t = text.trim();
    if (!t) return;
    await db.notes.add({ id: uid(), date, text: t, createdAt: Date.now(), sealed });
    setText('');
    setSealed(false);
  };
  const left = NOTE_SOFT_LIMIT - text.length;
  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What happened? How did it feel?"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
        }}
      />
      <div className="composer-bar">
        <button
          className={`seal ${sealed ? 'on' : ''}`}
          onClick={() => setSealed(!sealed)}
          aria-pressed={sealed}
          title="Sealed notes will never be shared with AI reflections"
        >
          {sealed ? 'Sealed' : 'Seal'}
        </button>
        {text.length > 200 && <span className={`count ${left < 0 ? 'over' : ''}`}>{left}</span>}
        <button className="solid" onClick={post} disabled={!text.trim()}>
          Post
        </button>
      </div>
    </div>
  );
}
