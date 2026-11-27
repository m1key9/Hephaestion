import { useState } from 'react';
import { db, uid } from '../lib/db';
import { fromKey } from '../lib/dates';
import { addToCalendar, daysUntil } from '../lib/ics';
import type { Deadline } from '../lib/types';

export function whenLabel(date: string, today: string): string {
  const n = daysUntil(date, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n < 14) return `In ${n} days`;
  if (n < 60) return `In ${Math.round(n / 7)} weeks`;
  return `In ${Math.round(n / 30)} months`;
}

export function shortDate(date: string): string {
  return fromKey(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Overdue first, then soonest; finished ones last. */
export function sortDeadlines(list: Deadline[]): Deadline[] {
  return [...list].sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));
}

export function DeadlineRow({ d, today, onEdit }: { d: Deadline; today: string; onEdit?: () => void }) {
  const n = daysUntil(d.date, today);
  const tone = d.done ? 'done' : n < 0 ? 'late' : n <= 3 ? 'soon' : '';
  return (
    <li className={`deadline ${tone}`}>
      <button
        className="check"
        onClick={() => db.deadlines.update(d.id, { done: !d.done })}
        aria-pressed={d.done}
        aria-label={d.done ? `Mark ${d.title} not done` : `Mark ${d.title} done`}
      />
      <button className="deadline-body" onClick={onEdit} disabled={!onEdit}>
        <span className="deadline-title">{d.title}</span>
        <span className="deadline-when">
          {shortDate(d.date)}
          {d.time ? ` · ${d.time}` : ''}
        </span>
      </button>
      <span className="deadline-count">{d.done ? 'Done' : whenLabel(d.date, today)}</span>
    </li>
  );
}

export function DeadlinesSheet({ deadlines, today, onClose }: { deadlines: Deadline[]; today: string; onClose: () => void }) {
  const [editing, setEditing] = useState<Deadline | null>(null);

  if (editing) {
    return (
      <EditDeadline
        d={editing}
        isNew={!deadlines.some((x) => x.id === editing.id)}
        today={today}
        onDone={() => setEditing(null)}
      />
    );
  }

  const sorted = sortDeadlines(deadlines);
  const open = sorted.filter((d) => !d.done);
  const done = sorted.filter((d) => d.done);

  return (
    <div className="sheet" role="dialog" aria-label="Deadlines">
      <header className="sheet-head">
        <h2>Deadlines</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <p className="muted small">The few dates that really matter. Each one can go straight into your calendar so your phone reminds you.</p>
      {open.length === 0 && <p className="faint">Nothing coming up.</p>}
      <ul className="deadlines">
        {open.map((d) => (
          <DeadlineRow key={d.id} d={d} today={today} onEdit={() => setEditing(d)} />
        ))}
      </ul>
      <button
        className="solid wide"
        onClick={() => setEditing({ id: uid(), title: '', date: today, remindDays: 3, done: false, createdAt: Date.now() })}
      >
        + New deadline
      </button>
      {done.length > 0 && (
        <>
          <h3>Done</h3>
          <ul className="deadlines">
            {done.map((d) => (
              <DeadlineRow key={d.id} d={d} today={today} onEdit={() => setEditing(d)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const REMIND = [
  { v: 0, label: 'On the day' },
  { v: 1, label: '1 day before' },
  { v: 3, label: '3 days before' },
  { v: 7, label: 'A week before' },
  { v: 14, label: 'Two weeks before' },
];

function EditDeadline({ d, isNew, today, onDone }: { d: Deadline; isNew: boolean; today: string; onDone: () => void }) {
  const [x, setX] = useState<Deadline>(d);
  const [saved, setSaved] = useState(!isNew);
  const update = (patch: Partial<Deadline>) => setX({ ...x, ...patch });

  const save = async () => {
    if (!x.title.trim()) return;
    const clean = { ...x, title: x.title.trim(), note: x.note?.trim() || undefined, time: x.time || undefined };
    await db.deadlines.put(clean);
    setX(clean);
    setSaved(true);
    return clean;
  };

  return (
    <div className="sheet" role="dialog" aria-label={isNew ? 'New deadline' : 'Edit deadline'}>
      <header className="sheet-head">
        <h2>{isNew && !saved ? 'New deadline' : x.title || 'Deadline'}</h2>
        <button className="icon" onClick={onDone} aria-label="Back">×</button>
      </header>
      <label className="field">
        <span className="field-label">What</span>
        <input autoFocus={isNew} value={x.title} onChange={(e) => update({ title: e.target.value })} placeholder="Latin exam, rent, visa renewal…" />
      </label>
      <div className="field-pair">
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" value={x.date} onChange={(e) => e.target.value && update({ date: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Time (optional)</span>
          <input type="time" value={x.time ?? ''} onChange={(e) => update({ time: e.target.value || undefined })} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Remind me</span>
        <select value={x.remindDays ?? 0} onChange={(e) => update({ remindDays: Number(e.target.value) })}>
          {REMIND.map((r) => (
            <option key={r.v} value={r.v}>{r.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Note (optional)</span>
        <textarea rows={2} value={x.note ?? ''} onChange={(e) => update({ note: e.target.value })} />
      </label>
      <p className="faint small">{x.date >= today ? whenLabel(x.date, today) : `${whenLabel(x.date, today)}: already passed`}</p>

      <div className="sheet-actions">
        <button className="solid" disabled={!x.title.trim()} onClick={async () => { await save(); onDone(); }}>Save</button>
        <button
          className="ghost"
          disabled={!x.title.trim()}
          onClick={async () => {
            const clean = await save();
            if (clean) await addToCalendar(clean);
          }}
        >
          Add to calendar
        </button>
        {!isNew && (
          <button
            className="ghost danger"
            onClick={async () => {
              if (confirm(`Delete “${x.title}”?`)) {
                await db.deadlines.delete(x.id);
                onDone();
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
      <p className="faint small">
        “Add to calendar” saves this deadline, then opens it in your calendar app with the reminder already set.
      </p>
    </div>
  );
}
