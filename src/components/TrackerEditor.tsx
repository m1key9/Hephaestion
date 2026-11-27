import { useState } from 'react';
import { addStarters, db, deleteTracker, uid } from '../lib/db';
import type { FieldType, Tracker, TrackerField } from '../lib/types';

export const PALETTE = ['#e8e1cf', '#ff3b1f', '#c9a227', '#2f6bff', '#7a7a72', '#3fbf6f', '#b04cff', '#ff8a00', '#00c2c7', '#ff4f9a'];

const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'number', label: 'NUMBER', hint: 'pages, km, sets…' },
  { type: 'duration', label: 'TIME', hint: 'minutes' },
  { type: 'scale', label: 'SCALE 1–5', hint: 'intensity, mood, focus' },
  { type: 'text', label: 'TEXT', hint: 'book title, what you studied' },
];

interface Props {
  trackers: Tracker[];
  onClose: () => void;
}

export function TrackerEditor({ trackers, onClose }: Props) {
  const [editing, setEditing] = useState<Tracker | null>(null);

  const startNew = () =>
    setEditing({
      id: uid(),
      name: '',
      color: PALETTE[trackers.length % PALETTE.length],
      fields: [],
      createdAt: Date.now(),
      archived: false,
    });

  if (editing) {
    return <EditOne tracker={editing} isNew={!trackers.some((t) => t.id === editing.id)} onDone={() => setEditing(null)} />;
  }

  const active = trackers.filter((t) => !t.archived);
  const archived = trackers.filter((t) => t.archived);

  return (
    <div className="sheet" role="dialog" aria-label="Trackers">
      <header className="sheet-head">
        <h2>TRACKERS</h2>
        <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <p className="muted">
        A tracker is anything you want to see across days. On its own it's a single tap: did it, or didn't.
        Add details only if you want them.
      </p>
      {trackers.length === 0 && (
        <button className="solid wide" onClick={addStarters}>
          ADD STARTERS: READING · GYM · LATIN · GREEK · WORK
        </button>
      )}
      <ul className="tracker-list">
        {active.map((t) => (
          <TrackerItem key={t.id} t={t} onEdit={() => setEditing(t)} />
        ))}
      </ul>
      <button className="solid wide" onClick={startNew}>+ NEW TRACKER</button>
      {archived.length > 0 && (
        <>
          <h3>ARCHIVED</h3>
          <ul className="tracker-list">
            {archived.map((t) => (
              <TrackerItem key={t.id} t={t} onEdit={() => setEditing(t)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TrackerItem({ t, onEdit }: { t: Tracker; onEdit: () => void }) {
  return (
    <li>
      <button className="tracker-item" onClick={onEdit} style={{ '--c': t.color } as React.CSSProperties}>
        <span className="swatch" />
        <span>{t.name}</span>
        <span className="muted small">{t.fields.length ? t.fields.map((f) => f.label).join(' · ') : 'check only'}</span>
      </button>
    </li>
  );
}

function EditOne({ tracker, isNew, onDone }: { tracker: Tracker; isNew: boolean; onDone: () => void }) {
  const [t, setT] = useState<Tracker>(tracker);
  const update = (patch: Partial<Tracker>) => setT({ ...t, ...patch });
  const setField = (id: string, patch: Partial<TrackerField>) =>
    update({ fields: t.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const save = async () => {
    if (!t.name.trim()) return;
    await db.trackers.put({ ...t, name: t.name.trim(), fields: t.fields.filter((f) => f.label.trim()) });
    onDone();
  };

  return (
    <div className="sheet" role="dialog" aria-label="Edit tracker">
      <header className="sheet-head">
        <h2>{isNew ? 'NEW TRACKER' : 'EDIT TRACKER'}</h2>
        <button className="ghost" onClick={onDone} aria-label="Back">✕</button>
      </header>

      <label className="field">
        <span className="field-label">NAME</span>
        <input autoFocus={isNew} value={t.name} onChange={(e) => update({ name: e.target.value })} placeholder="Reading" />
      </label>

      <div className="field">
        <span className="field-label">COLOR</span>
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={c === t.color ? 'on' : ''}
              style={{ background: c }}
              onClick={() => update({ color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
          <input type="color" value={t.color} onChange={(e) => update({ color: e.target.value })} aria-label="Custom color" />
        </div>
      </div>

      <h3>DETAILS (OPTIONAL)</h3>
      <p className="muted small">Things you might want to note when you mark it. You never have to fill them in.</p>
      <ul className="field-list">
        {t.fields.map((f) => (
          <li key={f.id} className="field-edit">
            <input value={f.label} onChange={(e) => setField(f.id, { label: e.target.value })} placeholder="Label" aria-label="Detail label" />
            <select value={f.type} onChange={(e) => setField(f.id, { type: e.target.value as FieldType })} aria-label="Detail type">
              {FIELD_TYPES.map((ft) => (
                <option key={ft.type} value={ft.type}>{ft.label}</option>
              ))}
            </select>
            {f.type === 'number' && (
              <input className="unit-input" value={f.unit ?? ''} onChange={(e) => setField(f.id, { unit: e.target.value })} placeholder="unit" aria-label="Unit" />
            )}
            <button className="ghost small" onClick={() => update({ fields: t.fields.filter((x) => x.id !== f.id) })} aria-label="Remove detail">✕</button>
          </li>
        ))}
      </ul>
      <div className="chips">
        {FIELD_TYPES.map((ft) => (
          <button
            key={ft.type}
            className="ghost small"
            title={ft.hint}
            onClick={() => update({ fields: [...t.fields, { id: uid(), label: '', type: ft.type }] })}
          >
            + {ft.label}
          </button>
        ))}
      </div>

      <div className="sheet-actions">
        <button className="solid" onClick={save} disabled={!t.name.trim()}>SAVE</button>
        {!isNew && (
          <>
            <button className="ghost" onClick={async () => { await db.trackers.put({ ...t, archived: !t.archived }); onDone(); }}>
              {t.archived ? 'UNARCHIVE' : 'ARCHIVE'}
            </button>
            <button
              className="ghost danger"
              onClick={async () => {
                if (confirm(`Delete “${t.name}” and every day it was marked? Archive keeps the history instead.`)) {
                  await deleteTracker(t.id);
                  onDone();
                }
              }}
            >
              DELETE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
