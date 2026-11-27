import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { fromKey, toKey } from '../lib/dates';

export interface DayMark {
  colors: string[];
  note: boolean;
}

export type Dimension = '3d' | '2d';

interface Props {
  marks: Map<string, DayMark>;
  today: string;
  selected: string | null;
  /** Days with a deadline get a ring. */
  deadlines: Set<string>;
  /** Change the nonce to fly the camera to `key`. */
  focus: { key: string; nonce: number };
  /** The day panel covers part of the screen; frame the focused day in what's left. */
  panelOpen: boolean;
  /** '3d' still flattens on its own when you zoom far out, like a map. '2d' stays flat. */
  dimension: Dimension;
  /** Change the nonce to zoom the camera back in to the normal close view. */
  zoomIn: number;
  /** Home screen: the field hangs far below as a backdrop, drifting, not interactive. */
  ambient: boolean;
  /** Fires when the field visibly crosses between flat and tilted. */
  onFlatChange: (flat: boolean) => void;
  onSelect: (key: string) => void;
  /** First day of the field. Earlier days are just more of the endless grey. */
  startDate: string;
}

/** Shared per-frame state: flat 0 = full 3D, 1 = top-down map. dist = camera distance. */
type View = MutableRefObject<{ flat: number; dist: number }>;

// ---- layout: one month per row, day 1 on the left, months running down the plane ----
const PITCH = 1.12;
const TILE = 1;
const BASE_YEAR = new Date().getFullYear();
const ROW_RADIUS = 90; // months drawn either side of the one you're looking at
const SLOTS = (ROW_RADIUS * 2 + 1) * 31;
const START_DIST = 26;
const AMBIENT_DIST = 30;
/** On the home screen the camera hangs over the empty expanse, off to the side of your days. */
const AMBIENT_OFFSET = new THREE.Vector3(-70, 0, -10);
const TILTED = new THREE.Vector3(0, 24, 15).normalize();
const TOP_DOWN = new THREE.Vector3(0, 1, 0.02).normalize();
/** Zooming out past FLAT_FROM starts laying the field down; by FLAT_AT it's a flat map. */
const FLAT_FROM = 40;
const FLAT_AT = 70;

const monthRow = (year: number, month: number) => (year - BASE_YEAR) * 12 + month;
const rowYear = (row: number) => BASE_YEAR + Math.floor(row / 12);
const rowMonth = (row: number) => ((row % 12) + 12) % 12;
const daysIn = (row: number) => new Date(rowYear(row), rowMonth(row) + 1, 0).getDate();
const cellX = (col: number) => col * PITCH;
const cellZ = (row: number) => row * PITCH;

function keyCell(key: string) {
  const d = fromKey(key);
  return { col: d.getDate() - 1, row: monthRow(d.getFullYear(), d.getMonth()) };
}
function keyPosition(key: string): THREE.Vector3 {
  const { col, row } = keyCell(key);
  return new THREE.Vector3(cellX(col), 0, cellZ(row));
}
const rowAt = (z: number) => Math.round(z / PITCH);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- palette: a muted grey field ----
const BG = '#1b1b1d';
const C_VOID = new THREE.Color('#2a2a2d'); // the endless field beyond your days
const C_FUTURE = new THREE.Color('#303034');
const C_EMPTY = new THREE.Color('#45454a');
const C_NOTE = new THREE.Color('#77777e');
const C_TODAY = '#f2f2f4';
const C_SELECTED = '#8f6bff';
const C_DEADLINE = '#8f6bff';

function writeMatrix(arr: Float32Array, i: number, x: number, y: number, z: number, sy: number, sx = 1, sz = sx) {
  const o = i * 16;
  arr[o] = sx; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

const TILE_H = 0.14;
/** Each mark lifts the day a little; its colors sit on top as stripes. */
const LIFT = 0.16;
const MAX_LIFT_MARKS = 5;
const STRIPE_H = 0.03;
const MAX_STRIPES = 8;
const STRIPE_SLOTS = SLOTS * 3;

/** A slow swell runs through the lived days so the field never sits perfectly still. */
const swell = (t: number, x: number, z: number) => 0.05 * Math.sin(t * 0.6 + x * 0.19 + z * 0.13);

const geometryBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function Days({ marks, today, selected, deadlines, onSelect, startDate, centerRow, view }: Pick<
  Props, 'marks' | 'today' | 'selected' | 'deadlines' | 'onSelect' | 'startDate'
> & { centerRow: number; view: View }) {
  const tiles = useRef<THREE.InstancedMesh>(null);
  const stripes = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(geometryBox, []);

  // Which day sits in which instance slot.
  const layout = useMemo(() => {
    const keys: (string | null)[] = new Array(SLOTS).fill(null);
    const xs = new Float32Array(SLOTS);
    const zs = new Float32Array(SLOTS);
    let i = 0;
    for (let row = centerRow - ROW_RADIUS; row <= centerRow + ROW_RADIUS; row++) {
      const y = rowYear(row);
      const m = rowMonth(row);
      const n = daysIn(row);
      for (let d = 1; d <= n; d++) {
        const key = toKey(new Date(y, m, d));
        if (key < startDate) continue;
        keys[i] = key;
        xs[i] = cellX(d - 1);
        zs[i] = cellZ(row);
        i++;
      }
    }
    return { keys, xs, zs, count: i };
  }, [centerRow, startDate]);

  const stack = useMemo(() => {
    const rgb = new Float32Array(SLOTS * 3);
    const lift = new Float32Array(SLOTS);
    const stripeDay = new Int32Array(STRIPE_SLOTS);
    const stripeIdx = new Int32Array(STRIPE_SLOTS);
    const stripeOf = new Int32Array(STRIPE_SLOTS);
    const stripeRgb = new Float32Array(STRIPE_SLOTS * 3);
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < layout.count; i++) {
      const key = layout.keys[i]!;
      const mark = marks.get(key);
      c.copy(key > today ? C_FUTURE : mark?.note ? C_NOTE : C_EMPTY).toArray(rgb, i * 3);
      const cols = mark?.colors.slice(0, MAX_STRIPES) ?? [];
      lift[i] = Math.min(cols.length, MAX_LIFT_MARKS) * LIFT;
      for (let s = 0; s < cols.length && n < STRIPE_SLOTS; s++, n++) {
        stripeDay[n] = i;
        stripeIdx[n] = s;
        stripeOf[n] = cols.length;
        c.set(cols[s]).toArray(stripeRgb, n * 3);
      }
    }
    return { rgb, lift, stripeDay, stripeIdx, stripeOf, stripeRgb, stripeCount: n };
  }, [layout, marks, today]);

  useLayoutEffect(() => {
    const t = tiles.current;
    const s = stripes.current;
    if (!t || !s) return;
    const c = new THREE.Color();
    for (let i = 0; i < SLOTS; i++) t.setColorAt(i, c.fromArray(stack.rgb, i * 3));
    for (let i = 0; i < stack.stripeCount; i++) s.setColorAt(i, c.fromArray(stack.stripeRgb, i * 3));
    t.instanceColor!.needsUpdate = true;
    if (s.instanceColor) s.instanceColor.needsUpdate = true;
    t.count = layout.count;
    s.count = stack.stripeCount;
  }, [stack, layout]);

  useFrame(({ clock }) => {
    const t = tiles.current;
    const s = stripes.current;
    if (!t || !s) return;
    const time = clock.elapsedTime;
    const f = view.current.flat;
    const live = 1 - f;
    const ta = t.instanceMatrix.array as Float32Array;
    for (let i = 0; i < layout.count; i++) {
      const x = layout.xs[i];
      const z = layout.zs[i];
      const h = TILE_H + stack.lift[i] * live;
      writeMatrix(ta, i, x, swell(time, x, z) * live, z, h, TILE);
    }
    t.instanceMatrix.needsUpdate = true;

    const sa = s.instanceMatrix.array as Float32Array;
    for (let n = 0; n < stack.stripeCount; n++) {
      const i = stack.stripeDay[n];
      const x = layout.xs[i];
      const z = layout.zs[i];
      const top = swell(time, x, z) * live + TILE_H + stack.lift[i] * live;
      const w = 0.9 / stack.stripeOf[n];
      const sx = x - 0.45 + w * (stack.stripeIdx[n] + 0.5);
      writeMatrix(sa, n, sx, top, z, STRIPE_H, w, 0.9);
    }
    s.instanceMatrix.needsUpdate = true;
  });

  const pick = (key: string | null | undefined, e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8 || !key) return;
    e.stopPropagation();
    onSelect(key);
  };

  return (
    <>
      <instancedMesh
        ref={tiles}
        args={[geometry, undefined, SLOTS]}
        onClick={(e) => e.instanceId !== undefined && pick(layout.keys[e.instanceId], e)}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.9} metalness={0} />
      </instancedMesh>
      <instancedMesh
        ref={stripes}
        args={[geometry, undefined, STRIPE_SLOTS]}
        onClick={(e) => e.instanceId !== undefined && pick(layout.keys[stack.stripeDay[e.instanceId]], e)}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.6} metalness={0} emissiveIntensity={0} />
      </instancedMesh>
      <Marker dayKey={today} color={C_TODAY} marks={marks} view={view} pulse />
      {selected && selected >= startDate && <Marker dayKey={selected} color={C_SELECTED} marks={marks} view={view} scale={1.18} />}
      {[...deadlines].map((d) => (
        <Ring key={d} dayKey={d} view={view} />
      ))}
    </>
  );
}

function Marker({ dayKey, color, marks, view, pulse, scale = 1.1 }: {
  dayKey: string; color: string; marks: Map<string, DayMark>; view: View; pulse?: boolean; scale?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const geom = useMemo(() => new THREE.EdgesGeometry(geometryBox()), []);
  const pos = useMemo(() => keyPosition(dayKey), [dayKey]);
  const lift = Math.min(marks.get(dayKey)?.colors.length ?? 0, MAX_LIFT_MARKS) * LIFT;
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const f = view.current.flat;
    const k = pulse ? 1 + 0.07 * Math.sin(clock.elapsedTime * 3) : 1;
    ref.current.position.y = swell(clock.elapsedTime, pos.x, pos.z) * (1 - f);
    ref.current.scale.set(scale * k, TILE_H + lift * (1 - f) + 0.12, scale * k);
  });
  return (
    <lineSegments ref={ref} geometry={geom} position={pos}>
      <lineBasicMaterial color={color} fog={false} />
    </lineSegments>
  );
}

/** A thin violet ring laid around a day that holds a deadline. */
function Ring({ dayKey, view }: { dayKey: string; view: View }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => keyPosition(dayKey), [dayKey]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = 0.02 + swell(clock.elapsedTime, pos.x, pos.z) * (1 - view.current.flat);
  });
  return (
    <mesh ref={ref} position={pos} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.66, 0.74, 40]} />
      <meshBasicMaterial color={C_DEADLINE} transparent opacity={0.9} fog={false} />
    </mesh>
  );
}

/**
 * The endless part: an expanse of identical grey tiles that surrounds your days in every direction,
 * so the field reads as one vast square. It's re-laid only when the camera crosses a tile.
 */
function Void({ startDate, view }: { startDate: string; view: View }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const N = 130;
  const geometry = useMemo(geometryBox, []);
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  const last = useRef({ c: NaN, r: NaN, s: '' });

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < N * N; i++) {
      // the faintest variation, like a field of slightly uneven stone
      c.copy(C_VOID).multiplyScalar(0.92 + ((i * 7919) % 17) * 0.01);
      m.setColorAt(i, c);
    }
    m.instanceColor!.needsUpdate = true;
  }, []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const target = controls?.target ?? new THREE.Vector3();
    const c0 = Math.round(target.x / PITCH) - N / 2;
    const r0 = Math.round(target.z / PITCH) - N / 2;
    const l = last.current;
    if (c0 === l.c && r0 === l.r && startDate === l.s) return;
    l.c = c0; l.r = r0; l.s = startDate;
    const arr = m.instanceMatrix.array as Float32Array;
    let i = 0;
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const col = c0 + a;
        const row = r0 + b;
        // Real days (on or after the start) are drawn by Days; everything else is void.
        let real = false;
        if (col >= 0 && col < 31 && col < daysIn(row)) {
          real = toKey(new Date(rowYear(row), rowMonth(row), col + 1)) >= startDate;
        }
        if (real) continue;
        writeMatrix(arr, i++, cellX(col), 0, cellZ(row), TILE_H * 0.7, TILE);
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    void view;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, N * N]} frustumCulled={false} raycast={() => null}>
      <meshStandardMaterial roughness={0.95} metalness={0} />
    </instancedMesh>
  );
}

/** Grey motes hanging in the air, drifting on a slow current. They travel with the camera. */
function Dust({ view }: { view: View }) {
  const N = 1600;
  const SPAN = { x: 110, y: 30, z: 110 };
  const ref = useRef<THREE.Points>(null);
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  const { base, geom } = useMemo(() => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      base[i * 3] = rnd() * SPAN.x;
      base[i * 3 + 1] = rnd() * SPAN.y;
      base[i * 3 + 2] = rnd() * SPAN.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return { base, geom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sprite = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }, []);

  useFrame(({ clock }) => {
    const pts = ref.current;
    if (!pts) return;
    const t = clock.elapsedTime;
    const target = controls?.target ?? new THREE.Vector3();
    const pos = geom.attributes.position.array as Float32Array;
    const wrap = (v: number, span: number) => ((v % span) + span) % span;
    // Far out, lift the dust up toward the camera so it still hangs in view.
    const rise = Math.max(0, view.current.dist - 40) * 0.55;
    for (let i = 0; i < N; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const x = wrap(bx + t * 0.35 + Math.sin(t * 0.3 + i) * 0.6 - target.x, SPAN.x) + target.x - SPAN.x / 2;
      const z = wrap(bz + t * 0.12 + Math.cos(t * 0.25 + i * 1.7) * 0.6 - target.z, SPAN.z) + target.z - SPAN.z / 2;
      const y = wrap(by + t * 0.18 + Math.sin(t * 0.5 + i * 0.37) * 0.4, SPAN.y) - 2 + rise;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    geom.attributes.position.needsUpdate = true;
    const mat = pts.material as THREE.PointsMaterial;
    mat.size = 0.16 * (1 + Math.max(0, view.current.dist - 40) / 60);
  });

  return (
    <points ref={ref} geometry={geom} frustumCulled={false} raycast={() => null}>
      <pointsMaterial map={sprite} color="#c4c4c8" size={0.16} sizeAttenuation transparent depthWrite={false} opacity={0.5} />
    </points>
  );
}

// ---- labels: they surface only as you pull back, so up close it's just the field ----

const SANS = '"Instrument Sans Variable", "Instrument Sans", -apple-system, "Helvetica Neue", sans-serif';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([document.fonts.load(`300 120px "Instrument Sans Variable"`), document.fonts.load(`500 60px "Instrument Sans Variable"`)])
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return ready;
}

interface LabelArt { tex: THREE.CanvasTexture; aspect: number; mat: THREE.MeshBasicMaterial }
const labelCache = new Map<string, LabelArt>();

function labelArt(text: string, kind: 'month' | 'year'): LabelArt {
  const id = `${kind}:${text}`;
  const hit = labelCache.get(id);
  if (hit) return hit;
  const px = kind === 'year' ? 200 : 72;
  const font = `${kind === 'year' ? 300 : 500} ${px}px ${SANS}`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 16;
  const h = Math.ceil(px * 1.3);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = kind === 'year' ? '#d6d6da' : '#9a9aa0';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText(text, w - 8, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const art = { tex, aspect: w / h, mat };
  labelCache.set(id, art);
  return art;
}

function Label({ text, kind, x, z, height }: { text: string; kind: 'month' | 'year'; x: number; z: number; height: number }) {
  const art = labelArt(text, kind);
  const w = height * art.aspect;
  return (
    <mesh position={[x - w / 2, 0.05, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} material={art.mat}>
      <planeGeometry args={[w, height]} />
    </mesh>
  );
}

function Labels({ centerRow, startDate, view }: { centerRow: number; startDate: string; view: View }) {
  const ready = useFontsReady();
  useFrame(() => {
    const d = view.current.dist;
    const month = smooth(30, 48, d);
    const year = smooth(55, 85, d);
    for (const [id, art] of labelCache) art.mat.opacity = id.startsWith('year') ? year : month * 0.9;
  });
  if (!ready) return null;
  const out = [];
  const s = fromKey(startDate);
  const firstRow = monthRow(s.getFullYear(), s.getMonth());
  for (let row = Math.max(firstRow, centerRow - ROW_RADIUS); row <= centerRow + ROW_RADIUS; row++) {
    const m = rowMonth(row);
    out.push(<Label key={`m${row}`} text={MONTHS[m]} kind="month" x={-1.1} z={cellZ(row)} height={1.15} />);
    if (m === 0 || row === firstRow) {
      // the year stands beside its twelve rows
      out.push(<Label key={`y${row}`} text={String(rowYear(row))} kind="year" x={-9} z={cellZ(row + Math.min(5.5, (11 - m) / 2))} height={9} />);
    }
  }
  return <>{out}</>;
}

// ---- camera ----

function Rig({ focus, panelOpen, dimension, zoomIn, ambient, onFlatChange, onCenterRow, view }: Pick<
  Props, 'focus' | 'panelOpen' | 'dimension' | 'zoomIn' | 'ambient' | 'onFlatChange'
> & { onCenterRow: (r: number) => void; view: View }) {
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const goal = useRef<THREE.Vector3 | null>(null);
  const goalDist = useRef<number | null>(ambient ? AMBIENT_DIST : null);
  const lastRow = useRef(rowAt(keyPosition(focus.key).z));
  const wasFlat = useRef(false);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const p = keyPosition(focus.key);
    p.x = Math.max(p.x, 15 * PITCH * 0.6);
    if (panelOpen && controls) {
      const dist = camera.position.distanceTo(controls.target);
      // Phones: panel is a bottom sheet, so aim below the day. Wide screens: panel is on the right.
      if (window.innerWidth < 900) p.z += dist * 0.3;
      else p.x += dist * 0.22;
    }
    goal.current = p;
    // re-aim only when a new focus is requested
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    if (zoomIn) goalDist.current = START_DIST;
  }, [zoomIn]);

  useEffect(() => {
    if (controls) controls.enabled = !ambient;
    if (ambient && controls) {
      goal.current = controls.target.clone().add(AMBIENT_OFFSET);
      goalDist.current = AMBIENT_DIST;
    }
  }, [ambient, controls]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      goal.current = null;
      goalDist.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame(({ clock }, dt) => {
    if (!controls) return;
    const ease = 1 - Math.pow(0.004, dt);
    if (goal.current) {
      const delta = goal.current.clone().sub(controls.target).multiplyScalar(ease);
      controls.target.add(delta);
      camera.position.add(delta);
      if (goal.current.distanceTo(controls.target) < 0.01) goal.current = null;
    }
    if (ambient) {
      // the home backdrop drifts very slowly across the field
      controls.target.x += Math.sin(clock.elapsedTime * 0.05) * dt * 0.8;
      controls.target.z += dt * 0.25;
    }

    let dist = camera.position.distanceTo(controls.target);
    if (goalDist.current !== null) {
      dist = lerp(dist, goalDist.current, 1 - Math.pow(0.05, dt));
      if (Math.abs(dist - goalDist.current) < 0.05) goalDist.current = null;
    }

    // Like a map: zoom far enough out and the field lies down flat. '2d' keeps it flat at any zoom.
    const want = ambient ? 0 : dimension === '2d' ? 1 : smooth(FLAT_FROM, FLAT_AT, dist);
    const v = view.current;
    v.dist = dist;
    v.flat = lerp(v.flat, want, 1 - Math.pow(0.02, dt));
    if (Math.abs(v.flat - want) < 0.001) v.flat = want;

    dir.copy(TILTED).lerp(TOP_DOWN, v.flat).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);

    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = dist * lerp(0.8, 1.4, v.flat);
      scene.fog.far = dist * lerp(2.6, 3.4, v.flat);
    }

    const isFlat = v.flat > 0.5;
    if (isFlat !== wasFlat.current) {
      wasFlat.current = isFlat;
      onFlatChange(isFlat);
    }
    // Re-center the drawn window once you've travelled a few months from its middle.
    const r = rowAt(controls.target.z);
    if (Math.abs(r - lastRow.current) > 12) {
      lastRow.current = r;
      onCenterRow(r);
    }
  });
  return null;
}

export function DayField(props: Props) {
  const startPos = useMemo(() => {
    const p = keyPosition(props.focus.key);
    p.x = Math.max(p.x, 15 * PITCH * 0.6);
    return p;
    // only the initial focus matters for the starting camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [centerRow, setCenterRow] = useState(() => rowAt(startPos.z));
  const view = useRef({ flat: props.dimension === '2d' && !props.ambient ? 1 : 0, dist: props.ambient ? AMBIENT_DIST : START_DIST });
  const startDir = props.dimension === '2d' && !props.ambient ? TOP_DOWN : TILTED;
  const startDist = props.ambient ? AMBIENT_DIST : START_DIST;
  // Only the first render matters; after that the Rig moves the camera.
  const startTarget = useMemo(
    () => (props.ambient ? startPos.clone().add(AMBIENT_OFFSET) : startPos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 50, position: startTarget.clone().addScaledVector(startDir, startDist).toArray(), near: 0.5, far: 1200 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => gl.setClearColor(BG)}
    >
      <fog attach="fog" args={[BG, 15, 45]} />
      <hemisphereLight args={['#e8e8ec', '#202022', 1.2]} />
      <directionalLight position={[-14, 18, 6]} intensity={1.3} color="#f4f4f6" />
      <directionalLight position={[12, 5, -10]} intensity={0.2} color="#8f6bff" />
      <Days
        marks={props.marks}
        today={props.today}
        selected={props.selected}
        deadlines={props.deadlines}
        onSelect={props.onSelect}
        startDate={props.startDate}
        centerRow={centerRow}
        view={view}
      />
      <Void startDate={props.startDate} view={view} />
      <Labels centerRow={centerRow} startDate={props.startDate} view={view} />
      <Dust view={view} />
      <MapControls
        makeDefault
        target={startTarget}
        enableRotate={false}
        screenSpacePanning={false}
        minDistance={6}
        maxDistance={240}
        enableDamping
        dampingFactor={0.12}
      />
      <Rig
        focus={props.focus}
        panelOpen={props.panelOpen}
        dimension={props.dimension}
        zoomIn={props.zoomIn}
        ambient={props.ambient}
        onFlatChange={props.onFlatChange}
        onCenterRow={setCenterRow}
        view={view}
      />
    </Canvas>
  );
}
