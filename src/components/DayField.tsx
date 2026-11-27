import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { MONTHS, fromKey, toKey, weekRow, weekday, yearCells } from '../lib/dates';

export interface DayMark {
  colors: string[];
  note: boolean;
}

export type Dimension = '3d' | '2d';

interface Props {
  marks: Map<string, DayMark>;
  today: string;
  selected: string | null;
  /** Change the nonce to fly the camera to `key`. */
  focus: { key: string; nonce: number };
  /** The day panel covers part of the screen; frame the focused day in what's left. */
  panelOpen: boolean;
  /** '3d' still flattens on its own when you zoom far out, like a map. '2d' stays flat. */
  dimension: Dimension;
  /** Change the nonce to zoom the camera in until the field is 3D again. */
  zoomIn: number;
  /** Fires when the field visibly crosses between flat and tilted. */
  onFlatChange: (flat: boolean) => void;
  onSelect: (key: string) => void;
  /** First day of the field. Days before it aren't drawn and the camera can't wander far past it. */
  startDate: string;
}

/** Shared per-frame state: 0 = full 3D, 1 = flat top-down map. */
type View = MutableRefObject<{ flat: number }>;

// ---- layout ----
const PITCH = 1.18;
const YEAR_GAP = 3.4;
const YEAR_PITCH = 7 * PITCH + YEAR_GAP;
const RADIUS = 6; // years rendered either side of the one you're looking at
const SLOTS = (RADIUS * 2 + 1) * 366;
const BASE_YEAR = new Date().getFullYear();
const START_DIST = 28;
const TILTED = new THREE.Vector3(0, 24, 15).normalize();
const TOP_DOWN = new THREE.Vector3(0, 1, 0.02).normalize();
/** Zooming out past FLAT_FROM starts laying the field down; by FLAT_AT it's a flat map. */
const FLAT_FROM = 36;
const FLAT_AT = 62;

function cellX(year: number, col: number) {
  return (year - BASE_YEAR) * YEAR_PITCH + col * PITCH;
}
function cellZ(row: number) {
  return row * PITCH;
}
function keyPosition(key: string): THREE.Vector3 {
  const d = fromKey(key);
  return new THREE.Vector3(cellX(d.getFullYear(), weekday(d)), 0, cellZ(weekRow(d)));
}
function yearAt(x: number) {
  return BASE_YEAR + Math.round((x - 3 * PITCH) / YEAR_PITCH);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- colors ----
const C_FUTURE = new THREE.Color('#2a2a29');
const C_EMPTY = new THREE.Color('#6a6964');
const C_NOTE = new THREE.Color('#a9a59c');
const C_CONCRETE = new THREE.Color('#77756f');
/** How far tracker colors are pulled toward the concrete, so they read as inlay rather than paint. */
const INLAY_MUTE = 0.22;
const C_TODAY = '#f2f0ea';
const C_SELECTED = '#8f6bff';
const BG = '#151515';

/**
 * The ground isn't level: it rolls gently, and the bare slabs rise and fall in long waves,
 * the way the stelae do in a field of concrete. Both lie down when the view goes flat.
 */
const terrain = (x: number, z: number) => 0.45 * Math.sin(x * 0.075 + 0.6) * Math.cos(z * 0.06 - 0.3);
const stele = (x: number, z: number) =>
  0.5 + 0.5 * Math.sin(x * 0.11 + z * 0.045) * Math.cos(z * 0.09 - x * 0.035);

/** Grainy, pitted concrete, painted once to a canvas and shared by every block. */
function concreteTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 0.88 + (rnd() - 0.5) * 0.1;
    const g = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g * 0.985;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // soft stains, the way poured concrete weathers unevenly
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, rad = 20 + rnd() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = rnd() < 0.6;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // air holes
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.25})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function writeMatrix(arr: Float32Array, i: number, x: number, y: number, z: number, sy: number, sx = 1, sz = sx) {
  const o = i * 16;
  arr[o] = sx; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

const SLAB = 0.22; // every day's base
const FLAT_SLAB = 0.04;
/** Each mark raises the day's pillar by one course of concrete and sets a colored band into it. */
const COURSE = 0.42;
const BAND = 0.11;
const FLAT_LAYER = 0.05;
const MAX_LAYERS = 8;
const LAYER_SLOTS = SLOTS * 3; // plenty: most days carry a few marks at most

/** A slow swell runs through the field so it never sits perfectly still. */
const swell = (t: number, x: number, z: number) => 0.09 * Math.sin(t * 0.7 + x * 0.21 + z * 0.13);

function Days({ marks, today, selected, onSelect, startDate, centerYear, view }: Pick<
  Props, 'marks' | 'today' | 'selected' | 'onSelect' | 'startDate'
> & {
  centerYear: number;
  view: View;
}) {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const layers = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const concrete = useMemo(concreteTexture, []);

  // Which day sits in which instance slot.
  const layout = useMemo(() => {
    const keys: (string | null)[] = new Array(SLOTS).fill(null);
    const xs = new Float32Array(SLOTS);
    const zs = new Float32Array(SLOTS);
    let i = 0;
    const firstYear = Math.max(centerYear - RADIUS, fromKey(startDate).getFullYear());
    for (let y = firstYear; y <= centerYear + RADIUS; y++) {
      for (const c of yearCells(y)) {
        if (c.key < startDate) continue;
        keys[i] = c.key;
        xs[i] = cellX(y, c.col);
        zs[i] = cellZ(c.row);
        i++;
      }
    }
    return { keys, xs, zs, count: i };
  }, [centerYear, startDate]);

  // Slab colors per day, and one layer per tracker mark, colored by tracker.
  // In 3D the layers stack upward; flat, they sit side by side as stripes across the tile.
  const stack = useMemo(() => {
    const slabRgb = new Float32Array(SLOTS * 3);
    const slabH = new Float32Array(SLOTS);
    const steleH = new Float32Array(SLOTS); // height before any courses of marks
    const layerDay = new Int32Array(LAYER_SLOTS); // which slab a layer sits on
    const layerLevel = new Int32Array(LAYER_SLOTS);
    const layerOf = new Int32Array(LAYER_SLOTS); // how many layers that day has
    const layerRgb = new Float32Array(LAYER_SLOTS * 3);
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < layout.count; i++) {
      const key = layout.keys[i]!;
      const mark = marks.get(key);
      c.copy(key > today ? C_FUTURE : mark?.note ? C_NOTE : mark?.colors.length ? C_CONCRETE : C_EMPTY).toArray(slabRgb, i * 3);
      // Lived days stand up out of the ground; days to come are just a plinth.
      const courses = Math.min(mark?.colors.length ?? 0, MAX_LAYERS);
      slabH[i] = key > today ? SLAB * 0.5 : SLAB + 0.7 * stele(layout.xs[i], layout.zs[i]) + courses * COURSE;
      steleH[i] = slabH[i] - courses * COURSE;
      if (!mark) continue;
      const cols = mark.colors.slice(0, MAX_LAYERS);
      for (let l = 0; l < cols.length && n < LAYER_SLOTS; l++, n++) {
        layerDay[n] = i;
        layerLevel[n] = l;
        layerOf[n] = cols.length;
        c.set(cols[l]).lerp(C_CONCRETE, INLAY_MUTE).toArray(layerRgb, n * 3);
      }
    }
    return { slabRgb, slabH, steleH, layerDay, layerLevel, layerOf, layerRgb, layerCount: n };
  }, [layout, marks, today]);

  useLayoutEffect(() => {
    const s = slabs.current;
    const l = layers.current;
    if (!s || !l) return;
    const c = new THREE.Color();
    for (let i = 0; i < SLOTS; i++) s.setColorAt(i, c.fromArray(stack.slabRgb, i * 3));
    for (let i = 0; i < stack.layerCount; i++) l.setColorAt(i, c.fromArray(stack.layerRgb, i * 3));
    s.instanceColor!.needsUpdate = true;
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
    l.count = stack.layerCount;
  }, [stack]);

  useFrame(({ clock }) => {
    const s = slabs.current;
    const l = layers.current;
    if (!s || !l) return;
    const t = clock.elapsedTime;
    const f = view.current.flat;
    const live = 1 - f; // motion and relief die away as the field lies flat

    const sa = s.instanceMatrix.array as Float32Array;
    for (let i = 0; i < SLOTS; i++) {
      if (i >= layout.count) {
        writeMatrix(sa, i, 0, -9999, 0, 0.0001, 0.0001);
        continue;
      }
      const x = layout.xs[i];
      const z = layout.zs[i];
      const h = lerp(stack.slabH[i], FLAT_SLAB, f);
      writeMatrix(sa, i, x, (swell(t, x, z) + terrain(x, z)) * live, z, h);
    }
    s.instanceMatrix.needsUpdate = true;

    const la = l.instanceMatrix.array as Float32Array;
    for (let n = 0; n < stack.layerCount; n++) {
      const i = stack.layerDay[n];
      const x = layout.xs[i];
      const z = layout.zs[i];
      const level = stack.layerLevel[n];
      const base = (swell(t, x, z) + terrain(x, z)) * live;
      const slab = lerp(stack.slabH[i], FLAT_SLAB, f);
      // 3D: a band set into each course of the pillar, standing just proud of the face.
      const y3 = base + stack.steleH[i] + level * COURSE + (COURSE - BAND) / 2;
      // Flat: equal stripes across the tile's top.
      const w = 0.94 / stack.layerOf[n];
      const xFlat = -0.47 + w * (level + 0.5);
      writeMatrix(
        la, n,
        x + xFlat * f,
        lerp(y3, base + slab, f),
        z,
        lerp(BAND, FLAT_LAYER, f),
        lerp(1.035, w, f),
        lerp(1.035, 0.94, f),
      );
    }
    l.instanceMatrix.needsUpdate = true;
  });

  const pick = (key: string | null | undefined, e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8 || !key) return;
    e.stopPropagation();
    onSelect(key);
  };

  return (
    <>
      <instancedMesh
        ref={slabs}
        args={[geometry, undefined, SLOTS]}
        onClick={(e) => e.instanceId !== undefined && pick(layout.keys[e.instanceId], e)}
        frustumCulled={false}
      >
        <meshStandardMaterial map={concrete} roughness={0.95} metalness={0} />
      </instancedMesh>
      <instancedMesh
        ref={layers}
        args={[geometry, undefined, LAYER_SLOTS]}
        onClick={(e) => e.instanceId !== undefined && pick(layout.keys[stack.layerDay[e.instanceId]], e)}
        frustumCulled={false}
      >
        <meshStandardMaterial map={concrete} roughness={0.95} metalness={0} />
      </instancedMesh>
      <Marker dayKey={today} color={C_TODAY} height={columnHeight(today, marks.get(today))} view={view} pulse />
      {selected && selected >= startDate && (
        <Marker
          dayKey={selected}
          color={C_SELECTED}
          height={columnHeight(selected, marks.get(selected))}
          view={view}
          scale={selected === today ? 1.24 : 1.12}
        />
      )}
    </>
  );
}

function columnHeight(key: string, mark?: DayMark) {
  const p = keyPosition(key);
  const n = Math.min(mark?.colors.length ?? 0, MAX_LAYERS);
  return SLAB + 0.7 * stele(p.x, p.z) + n * COURSE + 0.25;
}

function Marker({ dayKey, color, height, view, pulse, scale = 1.12 }: {
  dayKey: string; color: string; height: number; view: View; pulse?: boolean; scale?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const geom = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), []);
  const pos = useMemo(() => keyPosition(dayKey), [dayKey]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const f = view.current.flat;
    const k = pulse ? 1 + 0.08 * Math.sin(clock.elapsedTime * 3) : 1;
    ref.current.position.y = (terrain(pos.x, pos.z) + swell(clock.elapsedTime, pos.x, pos.z)) * (1 - f);
    ref.current.scale.set(scale * k, lerp(height, 0.15, f), scale * k);
  });
  return (
    <lineSegments ref={ref} geometry={geom} position={pos}>
      <lineBasicMaterial color={color} fog={false} />
    </lineSegments>
  );
}

/** A darker lattice far below the days. It drifts at a different depth, so panning has parallax. */
function Lattice({ view }: { view: View }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const N = 48;
  const P = 2.6;
  const geometry = useMemo(() => new THREE.BoxGeometry(1.9, 1, 1.9).translate(0, 0.5, 0), []);
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < N * N; i++) {
      c.setHSL(0, 0, 0.05 + ((i * 7919) % 13) * 0.005);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const f = view.current.flat;
    m.visible = f < 0.98;
    if (!m.visible) return;
    const t = clock.elapsedTime;
    const target = controls?.target ?? new THREE.Vector3();
    const ox = Math.round(target.x / P) * P - (N / 2) * P;
    const oz = Math.round(target.z / P) * P - (N / 2) * P;
    const arr = m.instanceMatrix.array as Float32Array;
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const x = ox + a * P;
        const z = oz + b * P;
        const h = 1.2 + 1.1 * Math.sin(x * 0.11 + t * 0.35) * Math.cos(z * 0.09 - t * 0.25);
        // As the field flattens, the lattice sinks away.
        writeMatrix(arr, a * N + b, x, -12 - 30 * f, z, Math.max(0.1, h * (1 - f)));
      }
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, N * N]} frustumCulled={false} raycast={() => null}>
      <meshLambertMaterial color="#6a6a6a" />
    </instancedMesh>
  );
}

/** Grey motes hanging in the air, drifting on a slow current. They travel with the camera. */
function Dust({ view }: { view: View }) {
  const N = 1400;
  const SPAN = { x: 90, y: 26, z: 90 };
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
    for (let i = 0; i < N; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      // a steady drift plus a little wander, wrapped into a box that follows the camera's target
      const x = wrap(bx + t * 0.35 + Math.sin(t * 0.3 + i) * 0.6 - target.x, SPAN.x) + target.x - SPAN.x / 2;
      const z = wrap(bz + t * 0.12 + Math.cos(t * 0.25 + i * 1.7) * 0.6 - target.z, SPAN.z) + target.z - SPAN.z / 2;
      const y = wrap(by + t * 0.18 + Math.sin(t * 0.5 + i * 0.37) * 0.4, SPAN.y) - 2;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    geom.attributes.position.needsUpdate = true;
    (pts.material as THREE.PointsMaterial).opacity = 0.55 * (1 - 0.6 * view.current.flat);
  });

  return (
    <points ref={ref} geometry={geom} frustumCulled={false} raycast={() => null}>
      <pointsMaterial map={sprite} color="#bdbcb6" size={0.16} sizeAttenuation transparent depthWrite={false} opacity={0.55} />
    </points>
  );
}

// ---- labels, painted on the ground ----

const SANS = '"Instrument Sans Variable", "Instrument Sans", -apple-system, "Helvetica Neue", sans-serif';

function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([document.fonts.load(`600 120px "Instrument Sans Variable"`), document.fonts.load(`500 60px "Instrument Sans Variable"`)])
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return ready;
}

function makeLabel(text: string, px: number, color: string, align: CanvasTextAlign, style: string, spacing: number) {
  const font = `${style} ${px}px ${SANS}`;
  const setup = (ctx: CanvasRenderingContext2D) => {
    ctx.font = font;
    // letterSpacing is newer canvas API; older browsers just ignore it.
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
  };
  const probe = document.createElement('canvas').getContext('2d')!;
  setup(probe);
  const w = Math.ceil(probe.measureText(text).width) + 12;
  const h = Math.ceil(px * 1.3);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  setup(ctx);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, align === 'right' ? w - 6 : 6, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

function Label({ text, x, z, height, color, anchor = 'left', px = 96, style = '500', spacing = 0 }: {
  text: string; x: number; z: number; height: number; color: string; anchor?: 'left' | 'right';
  px?: number; style?: string; spacing?: number;
}) {
  const { tex, aspect } = useMemo(
    () => makeLabel(text, px, color, anchor, style, spacing),
    [text, px, color, anchor, style, spacing],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  const w = height * aspect;
  const cx = anchor === 'left' ? x + w / 2 : x - w / 2;
  return (
    <mesh position={[cx, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[w, height]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

const MONTH_NAMES = MONTHS.map((m) => m[0] + m.slice(1).toLowerCase());

function YearLabels({ centerYear, startDate }: { centerYear: number; startDate: string }) {
  const ready = useFontsReady();
  if (!ready) return null;
  const labels = [];
  const firstYear = Math.max(centerYear - RADIUS, fromKey(startDate).getFullYear());
  for (let y = firstYear; y <= centerYear + RADIUS; y++) {
    labels.push(
      <Label key={`y${y}`} text={String(y)} x={cellX(y, 0) - 0.5} z={-2.3} height={3} color="#b9b7b1" px={180} style="300" spacing={-4} />,
    );
    for (let m = 0; m < 12; m++) {
      if (toKey(new Date(y, m + 1, 0)) < startDate) continue; // month ended before the field begins
      const row = weekRow(new Date(y, m, 1));
      labels.push(
        <Label
          key={`m${y}-${m}`}
          text={MONTH_NAMES[m]}
          x={cellX(y, 0) - 0.7}
          z={cellZ(row)}
          height={0.7}
          color="#5f5e5a"
          anchor="right"
          style="500"
        />,
      );
    }
  }
  return <>{labels}</>;
}

// ---- camera ----

function Rig({ focus, panelOpen, dimension, zoomIn, onFlatChange, onCenterYear, view, startDate, today }: Pick<
  Props, 'focus' | 'panelOpen' | 'dimension' | 'zoomIn' | 'onFlatChange' | 'startDate' | 'today'
> & { onCenterYear: (y: number) => void; view: View }) {
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const goal = useRef<THREE.Vector3 | null>(null);
  const goalDist = useRef<number | null>(null);
  const lastYear = useRef(BASE_YEAR);
  const wasFlat = useRef(false);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const p = keyPosition(focus.key);
    if (panelOpen && controls) {
      const dist = camera.position.distanceTo(controls.target);
      // Phones: panel is a bottom sheet, so aim below the day. Wide screens: panel is on the right.
      if (window.innerWidth < 900) p.z += dist * 0.3;
      else p.x += dist * 0.22;
    } else {
      p.x += 3 * PITCH;
    }
    goal.current = p;
    // re-aim only when a new focus is requested
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    if (zoomIn) goalDist.current = START_DIST;
  }, [zoomIn]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      goal.current = null;
      goalDist.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, dt) => {
    if (!controls) return;
    const ease = 1 - Math.pow(0.002, dt);
    if (goal.current) {
      const delta = goal.current.clone().sub(controls.target).multiplyScalar(ease);
      controls.target.add(delta);
      camera.position.add(delta);
      if (goal.current.distanceTo(controls.target) < 0.01) goal.current = null;
    }
    // Keep the view on the field: from a little before its first day to a few years ahead.
    const minX = cellX(fromKey(startDate).getFullYear(), 0) - 8;
    const maxX = cellX(fromKey(today).getFullYear() + 3, 7) + 8;
    const cx = Math.min(maxX, Math.max(minX, controls.target.x));
    const cz = Math.min(72, Math.max(-12, controls.target.z));
    if (cx !== controls.target.x || cz !== controls.target.z) {
      const shift = new THREE.Vector3(cx - controls.target.x, 0, cz - controls.target.z);
      controls.target.add(shift);
      camera.position.add(shift);
    }

    let dist = camera.position.distanceTo(controls.target);
    if (goalDist.current !== null) {
      dist = lerp(dist, goalDist.current, ease);
      if (Math.abs(dist - goalDist.current) < 0.05) goalDist.current = null;
    }

    // Like a map: zoom far enough out and the field lies down flat. '2d' keeps it flat at any zoom.
    const want = dimension === '2d' ? 1 : smooth(FLAT_FROM, FLAT_AT, dist);
    const v = view.current;
    v.flat = lerp(v.flat, want, 1 - Math.pow(0.02, dt));
    if (Math.abs(v.flat - want) < 0.001) v.flat = want;

    dir.copy(TILTED).lerp(TOP_DOWN, v.flat).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);

    // Fog follows zoom: close up it's a corridor, far out the field sprawls into black.
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = dist * lerp(0.75, 1.5, v.flat);
      scene.fog.far = dist * lerp(2.4, 3.2, v.flat);
    }

    const isFlat = v.flat > 0.5;
    if (isFlat !== wasFlat.current) {
      wasFlat.current = isFlat;
      onFlatChange(isFlat);
    }
    const y = yearAt(controls.target.x);
    if (y !== lastYear.current) {
      lastYear.current = y;
      onCenterYear(y);
    }
  });
  return null;
}

export function DayField(props: Props) {
  const [centerYear, setCenterYear] = useState(BASE_YEAR);
  const view = useRef({ flat: props.dimension === '2d' ? 1 : 0 });
  const start = useMemo(() => {
    const p = keyPosition(props.focus.key);
    p.x += 3 * PITCH;
    return p;
    // only the initial focus matters for the starting camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const startDir = props.dimension === '2d' ? TOP_DOWN : TILTED;

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 50, position: start.clone().addScaledVector(startDir, START_DIST).toArray(), near: 0.5, far: 900 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => gl.setClearColor(BG)}
    >
      <fog attach="fog" args={[BG, 15, 45]} />
      {/* Overcast: soft sky from above, a low hard sun raking across the faces. */}
      <hemisphereLight args={['#d8d8d4', '#1a1a1a', 1.1]} />
      <directionalLight position={[-14, 18, 6]} intensity={1.7} color="#f1eee8" />
      <directionalLight position={[12, 5, -10]} intensity={0.25} color="#8f6bff" />
      <Days
        marks={props.marks}
        today={props.today}
        selected={props.selected}
        onSelect={props.onSelect}
        startDate={props.startDate}
        centerYear={centerYear}
        view={view}
      />
      <YearLabels centerYear={centerYear} startDate={props.startDate} />
      <Lattice view={view} />
      <Dust view={view} />
      <MapControls
        makeDefault
        target={start}
        enableRotate={false}
        screenSpacePanning={false}
        minDistance={5}
        maxDistance={260}
        enableDamping
        dampingFactor={0.12}
      />
      <Rig
        focus={props.focus}
        panelOpen={props.panelOpen}
        dimension={props.dimension}
        zoomIn={props.zoomIn}
        onFlatChange={props.onFlatChange}
        onCenterYear={setCenterYear}
        view={view}
        startDate={props.startDate}
        today={props.today}
      />
    </Canvas>
  );
}
