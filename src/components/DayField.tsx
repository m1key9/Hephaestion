import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { MONTHS, fromKey, weekRow, weekday, yearCells } from '../lib/dates';

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
const C_FUTURE = new THREE.Color('#131312');
const C_EMPTY = new THREE.Color('#2e2c28');
const C_NOTE = new THREE.Color('#7d776b');
const C_TODAY = '#d6cfbf';
const C_SELECTED = '#a8321e';

function writeMatrix(arr: Float32Array, i: number, x: number, y: number, z: number, sy: number, sx = 1, sz = sx) {
  const o = i * 16;
  arr[o] = sx; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

const SLAB = 0.22; // every day's base
const FLAT_SLAB = 0.04;
const LAYER = 0.42; // one per tracker marked that day
const FLAT_LAYER = 0.05;
const LAYER_GAP = 0.06;
const MAX_LAYERS = 8;
const LAYER_SLOTS = SLOTS * 3; // plenty: most days carry a few marks at most

/** A slow swell runs through the field so it never sits perfectly still. */
const swell = (t: number, x: number, z: number) => 0.09 * Math.sin(t * 0.7 + x * 0.21 + z * 0.13);

function Days({ marks, today, selected, onSelect, centerYear, view }: Pick<Props, 'marks' | 'today' | 'selected' | 'onSelect'> & {
  centerYear: number;
  view: View;
}) {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const layers = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);

  // Which day sits in which instance slot.
  const layout = useMemo(() => {
    const keys: (string | null)[] = new Array(SLOTS).fill(null);
    const xs = new Float32Array(SLOTS);
    const zs = new Float32Array(SLOTS);
    let i = 0;
    for (let y = centerYear - RADIUS; y <= centerYear + RADIUS; y++) {
      for (const c of yearCells(y)) {
        keys[i] = c.key;
        xs[i] = cellX(y, c.col);
        zs[i] = cellZ(c.row);
        i++;
      }
    }
    return { keys, xs, zs, count: i };
  }, [centerYear]);

  // Slab colors per day, and one layer per tracker mark, colored by tracker.
  // In 3D the layers stack upward; flat, they sit side by side as stripes across the tile.
  const stack = useMemo(() => {
    const slabRgb = new Float32Array(SLOTS * 3);
    const layerDay = new Int32Array(LAYER_SLOTS); // which slab a layer sits on
    const layerLevel = new Int32Array(LAYER_SLOTS);
    const layerOf = new Int32Array(LAYER_SLOTS); // how many layers that day has
    const layerRgb = new Float32Array(LAYER_SLOTS * 3);
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < layout.count; i++) {
      const key = layout.keys[i]!;
      const mark = marks.get(key);
      c.copy(key > today ? C_FUTURE : mark?.note ? C_NOTE : C_EMPTY).toArray(slabRgb, i * 3);
      if (!mark) continue;
      const cols = mark.colors.slice(0, MAX_LAYERS);
      for (let l = 0; l < cols.length && n < LAYER_SLOTS; l++, n++) {
        layerDay[n] = i;
        layerLevel[n] = l;
        layerOf[n] = cols.length;
        c.set(cols[l]).toArray(layerRgb, n * 3);
      }
    }
    return { slabRgb, layerDay, layerLevel, layerOf, layerRgb, layerCount: n };
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
    const live = 1 - f; // motion dies away as the field lies flat
    const slab = lerp(SLAB, FLAT_SLAB, f);

    const sa = s.instanceMatrix.array as Float32Array;
    for (let i = 0; i < SLOTS; i++) {
      if (i >= layout.count) {
        writeMatrix(sa, i, 0, -9999, 0, 0.0001, 0.0001);
        continue;
      }
      const x = layout.xs[i];
      const z = layout.zs[i];
      writeMatrix(sa, i, x, swell(t, x, z) * live, z, layout.keys[i]! > today ? slab * 0.5 : slab);
    }
    s.instanceMatrix.needsUpdate = true;

    const la = l.instanceMatrix.array as Float32Array;
    for (let n = 0; n < stack.layerCount; n++) {
      const i = stack.layerDay[n];
      const x = layout.xs[i];
      const z = layout.zs[i];
      const level = stack.layerLevel[n];
      const base = swell(t, x, z) * live;
      // 3D: strata that breathe apart slightly.
      const gap = LAYER_GAP * (1 + 0.6 * Math.sin(t * 1.1 + x * 0.3 + z * 0.2));
      const y3 = base + SLAB + gap + level * (LAYER + gap);
      // Flat: equal stripes across the tile's top.
      const w = 0.94 / stack.layerOf[n];
      const xFlat = -0.47 + w * (level + 0.5);
      writeMatrix(
        la, n,
        x + xFlat * f,
        lerp(y3, slab, f),
        z,
        lerp(LAYER, FLAT_LAYER, f),
        lerp(0.94, w, f),
        0.94,
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
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={layers}
        args={[geometry, undefined, LAYER_SLOTS]}
        onClick={(e) => e.instanceId !== undefined && pick(layout.keys[stack.layerDay[e.instanceId]], e)}
        frustumCulled={false}
      >
        <meshLambertMaterial />
      </instancedMesh>
      <Marker dayKey={today} color={C_TODAY} height={columnHeight(marks.get(today))} view={view} pulse />
      {selected && (
        <Marker
          dayKey={selected}
          color={C_SELECTED}
          height={columnHeight(marks.get(selected))}
          view={view}
          scale={selected === today ? 1.24 : 1.12}
        />
      )}
    </>
  );
}

function columnHeight(mark?: DayMark) {
  const n = Math.min(mark?.colors.length ?? 0, MAX_LAYERS);
  return SLAB + n * (LAYER + LAYER_GAP) + 0.25;
}

function Marker({ dayKey, color, height, view, pulse, scale = 1.12 }: {
  dayKey: string; color: string; height: number; view: View; pulse?: boolean; scale?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const geom = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), []);
  const pos = useMemo(() => keyPosition(dayKey), [dayKey]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = pulse ? 1 + 0.08 * Math.sin(clock.elapsedTime * 3) : 1;
    ref.current.scale.set(scale * k, lerp(height, 0.15, view.current.flat), scale * k);
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
      c.setHSL(0.1, 0.05, 0.03 + ((i * 7919) % 13) * 0.004);
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
      <meshLambertMaterial color="#5a5a5a" />
    </instancedMesh>
  );
}

// ---- labels, painted on the ground ----

const SERIF = '"EB Garamond", "Iowan Old Style", Georgia, serif';

function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([document.fonts.load(`500 120px "EB Garamond"`), document.fonts.load(`italic 400 60px "EB Garamond"`)])
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return ready;
}

function makeLabel(text: string, px: number, color: string, align: CanvasTextAlign, style: string, spacing: number) {
  const font = `${style} ${px}px ${SERIF}`;
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

function YearLabels({ centerYear }: { centerYear: number }) {
  const ready = useFontsReady();
  if (!ready) return null;
  const labels = [];
  for (let y = centerYear - RADIUS; y <= centerYear + RADIUS; y++) {
    labels.push(
      <Label key={`y${y}`} text={String(y)} x={cellX(y, 0) - 0.5} z={-2.3} height={3} color="#bdb6a6" px={180} spacing={18} />,
    );
    for (let m = 0; m < 12; m++) {
      const row = weekRow(new Date(y, m, 1));
      labels.push(
        <Label
          key={`m${y}-${m}`}
          text={MONTH_NAMES[m]}
          x={cellX(y, 0) - 0.7}
          z={cellZ(row)}
          height={0.7}
          color="#6b665d"
          anchor="right"
          style="italic 400"
        />,
      );
    }
  }
  return <>{labels}</>;
}

// ---- camera ----

function Rig({ focus, panelOpen, dimension, zoomIn, onFlatChange, onCenterYear, view }: Pick<
  Props, 'focus' | 'panelOpen' | 'dimension' | 'zoomIn' | 'onFlatChange'
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
      onCreated={({ gl }) => gl.setClearColor('#070706')}
    >
      <fog attach="fog" args={['#070706', 15, 45]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-10, 22, 8]} intensity={2} />
      <directionalLight position={[12, 6, -10]} intensity={0.3} color="#a8321e" />
      <Days
        marks={props.marks}
        today={props.today}
        selected={props.selected}
        onSelect={props.onSelect}
        centerYear={centerYear}
        view={view}
      />
      <YearLabels centerYear={centerYear} />
      <Lattice view={view} />
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
      />
    </Canvas>
  );
}
