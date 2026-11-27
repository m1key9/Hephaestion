import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { BudgetError, NoKeyError, reflectArc, reflectWeek, weekStart } from '../lib/ai';
import { fromKey } from '../lib/dates';
import type { Reflection } from '../lib/types';

/** Mood across the weeks, as one quiet line. */
function MoodLine({ weeks }: { weeks: Reflection[] }) {
  const pts = weeks.filter((w) => typeof w.mood === 'number');
  if (pts.length < 2) return null;
  const W = 320;
  const H = 70;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (m: number) => H / 2 - (m * H) / 2.4;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.mood!).toFixed(1)}`).join(' ');
  return (
    <figure className="moodline">
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} preserveAspectRatio="none" role="img" aria-label="Mood across recent weeks">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="axis" />
        <path d={d} className="line" />
        {pts.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.mood!)} r="3" className="dot">
            <title>{`${p.title}: ${p.themes?.join(', ')}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <span>{fromKey(pts[0].period).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>mood, week by week</span>
        <span>{fromKey(pts[pts.length - 1].period).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </figcaption>
    </figure>
  );
}

export function ArcSheet({ today, hasKey, onClose, onSettings }: {
  today: string; hasKey: boolean; onClose: () => void; onSettings: () => void;
}) {
  const all = useLiveQuery(() => db.reflections.toArray()) ?? [];
  const arc = all.find((r) => r.kind === 'arc');
  const months = all.filter((r) => r.kind === 'month').sort((a, b) => b.period.localeCompare(a.period));
  const weeks = all.filter((r) => r.kind === 'week').sort((a, b) => a.period.localeCompare(b.period));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg('');
    try {
      const r = await fn();
      if (r === null) setMsg('There’s nothing written or marked there yet.');
    } catch (e) {
      setMsg(e instanceof NoKeyError || e instanceof BudgetError || e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sheet arc" role="dialog" aria-label="Your arc">
      <header className="sheet-head">
        <h2>Your arc</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>

      {!hasKey && (
        <div className="callout">
          <p>
            Your arc is written by Claude from your notes and marks: a summary each week, a chapter each month, and a
            living portrait that changes as you do.
          </p>
          <button className="solid" onClick={onSettings}>Connect Claude</button>
        </div>
      )}

      {arc ? (
        <section className="portrait">
          <p className="archetype">{arc.title}</p>
          {arc.text.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {arc.turning && <p className="turning">{arc.turning}</p>}
          <div className="threads">
            {!!arc.tensions?.length && (
              <div>
                <h3>Tensions</h3>
                <ul>{arc.tensions.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
            {!!arc.growing?.length && (
              <div>
                <h3>Growing</h3>
                <ul>{arc.growing.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
          </div>
          <p className="faint small">
            Rewritten {new Date(arc.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
          </p>
        </section>
      ) : (
        hasKey && <p className="muted">Your arc appears after your first reflected week.</p>
      )}

      <MoodLine weeks={weeks.slice(-16)} />

      {hasKey && (
        <div className="sheet-actions">
          <button className="ghost" disabled={!!busy} onClick={() => run('week', () => reflectWeek(weekStart(today), today))}>
            {busy === 'week' ? 'Reflecting…' : 'Reflect on this week'}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => run('arc', reflectArc)}>
            {busy === 'arc' ? 'Rewriting…' : 'Rewrite the arc'}
          </button>
        </div>
      )}
      {msg && <p className="status">{msg}</p>}

      {months.length > 0 && (
        <>
          <h3>Chapters</h3>
          <ol className="chapters">
            {months.map((m) => (
              <li key={m.id}>
                <span className="chapter-when">
                  {fromKey(`${m.period}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <span className="chapter-title">{m.title}</span>
                <p>{m.text}</p>
              </li>
            ))}
          </ol>
        </>
      )}

      {weeks.length > 0 && (
        <>
          <h3>Weeks</h3>
          <ol className="weeks">
            {[...weeks].reverse().map((w) => (
              <li key={w.id}>
                <span className="chapter-when">
                  {w.title}
                  {w.partial ? ' · so far' : ''}
                </span>
                <p>{w.text}</p>
                {!!w.themes?.length && <span className="themes">{w.themes.join(' · ')}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
