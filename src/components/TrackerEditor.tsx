import { useState } from 'react';
import { addStarters, db, deleteTracker, moveTracker, sortTrackers, uid } from '../lib/db';
import type { FieldType, Tracker, TrackerField } from '../lib/types';

/** Muted, earthy defaults. Any color is allowed through the picker at the end. */
export const PALETTE = [
  '#8f6bff', // violet
  '#e9e6f2', // bone
  '#ff5d73', // coral
  '#f2b94b', // amber
  '#4f8dff', // blue
  '#3fcf8e', // mint
  '#2ec4d6', // cyan
  '#ff8a4c', // tangerine
  '#d46bff', // orchid
  '#9a8f80', // stone
  '#7a5a45', // umber
  '#5c6370', // slate
];

const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'number', label: 'Number', hint: 'pages, km, sets…' },
  { type: 'duration', label: 'Time', hint: 'minutes' },
  { type: 'scale', label: 'Scale 1–5', hint: 'intensity, mood, focus' },
  { type: 'text', label: 'Text', hint: 'book title, what you studied' },
];

interface Props {
  trackers: Tracker[];
  /** Open straight into a blank tracker. */
  startNew?: boolean;
  onClose: () => void;
}

const blank = (n: number): Tracker => ({
  id: uid(),
  name: '',
  color: PALETTE[n % PALETTE.length],
  fields: [],
  order: Date.now(),
  createdAt: Date.now(),
  archived: false,
});

export function TrackerEditor({ trackers, startNew, onClose }: Props) {
  const [editing, setEditing] = useState<Tracker | null>(() => (startNew ? blank(trackers.length) : null));

  if (editing) {
    return (
      <EditOne
        tracker={editing}
        isNew={!trackers.some((t) => t.id === editing.id)}
        onDone={() => (startNew ? onClose() : setEditing(null))}
      />
    );
  }

  const sorted = sortTrackers(trackers);
  const active = sorted.filter((t) => !t.archived);
  const archived = sorted.filter((t) => t.archived);

  return (
    <div className="sheet" role="dialog" aria-label="Trackers">
      <header className="sheet-head">
        <h2>Trackers</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <p className="muted">
        Anything you want to see across your days: Latin, the gym, a bad night's sleep. Give it a name and a color.
        It's a single tap unless you ask for more.
      </p>
      {trackers.length === 0 && (
        <button className="solid wide" onClick={addStarters}>
          Start with Reading, Gym, Latin, Greek, Work
        </button>
      )}
      <ul className="tracker-list">
        {active.map((t, i) => (
          <TrackerItem
            key={t.id}
            t={t}
            onEdit={() => setEditing(t)}
            onUp={i > 0 ? () => moveTracker(active, t.id, -1) : undefined}
            onDown={i < active.length - 1 ? () => moveTracker(active, t.id, 1) : undefined}
          />
        ))}
      </ul>
      <button className="solid wide" onClick={() => setEditing(blank(trackers.length))}>+ New tracker</button>
      {archived.length > 0 && (
        <>
          <h3>Archived</h3>
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

function describe(t: Tracker) {
  const bits = [];
  if (t.multi) bits.push('counted');
  bits.push(...t.fields.map((f) => f.label.toLowerCase()));
  return bits.length ? bits.join(' · ') : 'a single tap';
}

function TrackerItem({ t, onEdit, onUp, onDown }: { t: Tracker; onEdit: () => void; onUp?: () => void; onDown?: () => void }) {
  return (
    <li className="tracker-row">
      <button className="tracker-item" onClick={onEdit} style={{ '--c': t.color } as React.CSSProperties}>
        <span className="swatch" />
        <span>{t.name}</span>
        <span className="muted">{describe(t)}</span>
      </button>
      {(onUp || onDown) && (
        <span className="order">
          <button onClick={onUp} disabled={!onUp} aria-label={`Move ${t.name} up`}>▲</button>
          <button onClick={onDown} disabled={!onDown} aria-label={`Move ${t.name} down`}>▼</button>
        </span>
      )}
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
        <h2>{isNew ? 'New tracker' : 'Edit tracker'}</h2>
        <button className="icon" onClick={onDone} aria-label="Back">×</button>
      </header>

      <label className="field">
        <span className="field-label">Name</span>
        <input
          autoFocus={isNew}
          value={t.name}
          onChange={(e) => update({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Latin, Shits taken, Called mum…"
        />
      </label>

      <div className="field">
        <span className="field-label">Color</span>
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
          <input type="color" value={t.color} onChange={(e) => update({ color: e.target.value })} aria-label="Any color" />
        </div>
        <div className="preview" style={{ '--c': t.color } as React.CSSProperties}>
          <span className="swatch" /> {t.name.trim() || 'Your tracker'}
        </div>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={!!t.multi} onChange={(e) => update({ multi: e.target.checked })} />
        <span>
          Count it
          <small>For things that can happen more than once a day. Each tap adds one.</small>
        </span>
      </label>

      <h3>Details, if you want them</h3>
      <p className="muted small">Things you might note when you mark it. You never have to fill them in.</p>
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
            <button className="ghost small" onClick={() => update({ fields: t.fields.filter((x) => x.id !== f.id) })} aria-label="Remove detail">×</button>
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
        <button className="solid" onClick={save} disabled={!t.name.trim()}>Save</button>
        {!isNew && (
          <>
            <button className="ghost" onClick={async () => { await db.trackers.put({ ...t, archived: !t.archived }); onDone(); }}>
              {t.archived ? 'Unarchive' : 'Archive'}
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
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
