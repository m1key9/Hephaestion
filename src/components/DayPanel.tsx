import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { bumpCount, db, setEntryValue, toggleEntry, uid } from '../lib/db';
import { addDays, dayOfYear, formatLong } from '../lib/dates';
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
  const future = date > today;

  return (
    <aside className="panel" aria-label={`Day ${date}`}>
      <header className="panel-head">
        <button className="ghost" onClick={() => onDate(addDays(date, -1))} aria-label="Previous day">←</button>
        <div className="panel-title">
          <h2>{formatLong(date)}</h2>
          <span className="meta">
            day {dayOfYear(date)}
            {date === today ? ' · today' : future ? ' · not yet' : ''}
          </span>
        </div>
        <button className="ghost" onClick={() => onDate(addDays(date, 1))} aria-label="Next day">→</button>
        <button className="ghost close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <section>
        <h3>Marks</h3>
        {trackers.length === 0 && (
          <p className="muted">
            Nothing to track yet. <button className="link" onClick={onManageTrackers}>Set up trackers</button>
          </p>
        )}
        <ul className="marks">
          {trackers.map((t) => (
            <TrackerRow key={`${t.id}-${date}`} tracker={t} date={date} entry={byTracker.get(t.id)} />
          ))}
        </ul>
        {trackers.length > 0 && (
          <button className="link add-tracker" onClick={onNewTracker}>+ track something new</button>
        )}
      </section>

      <section>
        <h3>Notes</h3>
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <div className="note-meta">
                <span>{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {n.sealed && <span title="Sealed: never shared with AI reflections">■ sealed</span>}
                <button
                  className="link danger"
                  onClick={() => confirm('Delete this note?') && db.notes.delete(n.id)}
                  aria-label="Delete note"
                >
                  delete
                </button>
              </div>
              <p>{n.text}</p>
            </li>
          ))}
        </ul>
        <Composer date={date} />
      </section>
    </aside>
  );
}

function TrackerRow({ tracker, date, entry }: { tracker: Tracker; date: string; entry?: Entry }) {
  const done = !!entry;
  const [open, setOpen] = useState(false);
  const hasFields = tracker.fields.length > 0;
  const count = entry ? (entry.count ?? 1) : 0;
  return (
    <li className={`mark ${done ? 'done' : ''}`} style={{ '--c': tracker.color } as React.CSSProperties}>
      <div className="mark-row">
        <button
          className="mark-toggle"
          onClick={() => (tracker.multi ? bumpCount(date, tracker.id, 1) : toggleEntry(date, tracker.id))}
          aria-pressed={done}
        >
          <span className="swatch" />
          <span className="mark-name">{tracker.name}</span>
          <span className="mark-state">{tracker.multi ? (count ? `× ${count}` : 'tap to count') : done ? 'done' : '—'}</span>
        </button>
        {tracker.multi && done && (
          <span className="counter">
            <button onClick={() => bumpCount(date, tracker.id, -1)} aria-label={`One less ${tracker.name}`}>−</button>
          </span>
        )}
        {hasFields && (
          <button className="ghost small" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Details">
            {open ? '−' : '+'}
          </button>
        )}
      </div>
      {hasFields && !open && done && Object.keys(entry.values).length > 0 && (
        <div className="mark-summary">
          {tracker.fields
            .filter((f) => entry.values[f.id] !== undefined)
            .map((f) => `${f.label} ${formatValue(f, entry.values[f.id])}`)
            .join(' · ')}
        </div>
      )}
      {hasFields && open && (
        <div className="fields">
          {tracker.fields.map((f) => (
            <FieldInput key={f.id} field={f} value={entry?.values[f.id]} onChange={(v) => setEntryValue(date, tracker.id, f.id, v)} />
          ))}
          <p className="muted small">Details are optional. Filling one in marks the day.</p>
        </div>
      )}
    </li>
  );
}

function formatValue(f: TrackerField, v: FieldValue): string {
  if (f.type === 'scale') return `${v}/5`;
  if (f.type === 'duration') {
    const m = Number(v);
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  }
  if (f.type === 'number') return `${v}${f.unit ? ` ${f.unit}` : ''}`;
  return `“${v}”`;
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
  const over = text.length > NOTE_SOFT_LIMIT;
  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What happened. What you felt."
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
        }}
      />
      <div className="composer-bar">
        <button
          className={`ghost small ${sealed ? 'on' : ''}`}
          onClick={() => setSealed(!sealed)}
          aria-pressed={sealed}
          title="Sealed notes will never be shared with AI reflections"
        >
          {sealed ? '■ sealed' : '□ seal'}
        </button>
        <span className={`count ${over ? 'over' : ''}`}>{text.length}/{NOTE_SOFT_LIMIT}</span>
        <button className="solid" onClick={post} disabled={!text.trim()}>
          Post
        </button>
      </div>
    </div>
  );
}
