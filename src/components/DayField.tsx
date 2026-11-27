import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { MONTHS, fromKey, weekRow, weekday, yearCells } from '../lib/dates';

export interface DayMark {
  colors: string[];
  note: boolean;
}

interface Props {
  marks: Map<string, DayMark>;
  today: string;
  selected: string | null;
  /** Change the nonce to fly the camera to `key`. */
  focus: { key: string; nonce: number };
  /** The day panel covers part of the screen; frame the focused day in what's left. */
  panelOpen: boolean;
  onSelect: (key: string) => void;
}

// ---- layout ----
const PITCH = 1.18;
const YEAR_GAP = 3.4;
const YEAR_PITCH = 7 * PITCH + YEAR_GAP;
const RADIUS = 4; // years rendered either side of the one you're looking at
const SLOTS = (RADIUS * 2 + 1) * 366;
const BASE_YEAR = new Date().getFullYear();
const CAM_OFFSET = new THREE.Vector3(0, 24, 15);

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

// ---- colors ----
const C_FUTURE = new THREE.Color('#151514');
const C_EMPTY = new THREE.Color('#33322e');
const C_NOTE = new THREE.Color('#8a8578');

function writeMatrix(arr: Float32Array, i: number, x: number, y: number, z: number, sy: number, s = 1) {
  const o = i * 16;
  arr[o] = s; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

const SLAB = 0.22; // every day's base
const LAYER = 0.42; // one per tracker marked that day
const LAYER_GAP = 0.06;
const MAX_LAYERS = 8;
const LAYER_SLOTS = SLOTS * 3; // plenty: most days carry a few marks at most

/** A slow swell runs through the field so it never sits perfectly still. */
const swell = (t: number, x: number, z: number) => 0.09 * Math.sin(t * 0.7 + x * 0.21 + z * 0.13);

function Days({ marks, today, selected, onSelect, centerYear }: Omit<Props, 'focus' | 'panelOpen'> & { centerYear: number }) {
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

  // Slab colors per day, and one stacked layer per tracker mark, colored by tracker.
  const stack = useMemo(() => {
    const slabRgb = new Float32Array(SLOTS * 3);
    const layerDay = new Int32Array(LAYER_SLOTS); // which slab a layer sits on
    const layerLevel = new Int32Array(LAYER_SLOTS);
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
        c.set(cols[l]).toArray(layerRgb, n * 3);
      }
    }
    return { slabRgb, layerDay, layerLevel, layerRgb, layerCount: n };
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
    const sa = s.instanceMatrix.array as Float32Array;
    for (let i = 0; i < SLOTS; i++) {
      if (i >= layout.count) {
        writeMatrix(sa, i, 0, -9999, 0, 0.0001, 0.0001);
        continue;
      }
      const x = layout.xs[i];
      const z = layout.zs[i];
      writeMatrix(sa, i, x, swell(t, x, z), z, layout.keys[i]! > today ? SLAB * 0.5 : SLAB);
    }
    s.instanceMatrix.needsUpdate = true;

    const la = l.instanceMatrix.array as Float32Array;
    for (let n = 0; n < stack.layerCount; n++) {
      const i = stack.layerDay[n];
      const x = layout.xs[i];
      const z = layout.zs[i];
      // Layers breathe apart slightly, so stacks read as strata rather than solid towers.
      const gap = LAYER_GAP * (1 + 0.6 * Math.sin(t * 1.1 + x * 0.3 + z * 0.2));
      const y = swell(t, x, z) + SLAB + gap + stack.layerLevel[n] * (LAYER + gap);
      writeMatrix(la, n, x, y, z, LAYER, 0.94);
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
      <Marker dayKey={today} color="#e8e1cf" height={columnHeight(marks.get(today))} pulse />
      {selected && (
        <Marker
          dayKey={selected}
          color="#ff3b1f"
          height={columnHeight(marks.get(selected))}
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

function Marker({ dayKey, color, height, pulse, scale = 1.12 }: {
  dayKey: string; color: string; height: number; pulse?: boolean; scale?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);
  const geom = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), []);
  const pos = useMemo(() => keyPosition(dayKey), [dayKey]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = pulse ? 1 + 0.08 * Math.sin(clock.elapsedTime * 3) : 1;
    ref.current.scale.set(scale * k, height, scale * k);
  });
  return (
    <lineSegments ref={ref} geometry={geom} position={pos}>
      <lineBasicMaterial color={color} fog={false} />
    </lineSegments>
  );
}

/** A darker lattice far below the days. It drifts at a different depth, so panning has parallax. */
function Lattice() {
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
      c.setHSL(0, 0, 0.035 + ((i * 7919) % 13) * 0.004);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
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
        writeMatrix(arr, a * N + b, x, -12, z, Math.max(0.1, h));
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

function makeLabel(text: string, px: number, color: string, align: CanvasTextAlign = 'left') {
  const font = `700 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 8;
  const h = Math.ceil(px * 1.2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, align === 'right' ? w - 4 : 4, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

function Label({ text, x, z, height, color, anchor = 'left', px = 96 }: {
  text: string; x: number; z: number; height: number; color: string; anchor?: 'left' | 'right'; px?: number;
}) {
  const { tex, aspect } = useMemo(() => makeLabel(text, px, color, anchor), [text, px, color, anchor]);
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

function YearLabels({ centerYear }: { centerYear: number }) {
  const labels = [];
  for (let y = centerYear - RADIUS; y <= centerYear + RADIUS; y++) {
    labels.push(<Label key={`y${y}`} text={String(y)} x={cellX(y, 0) - 0.5} z={-2.2} height={2.6} color="#e8e1cf" px={160} />);
    for (let m = 0; m < 12; m++) {
      const row = weekRow(new Date(y, m, 1));
      labels.push(
        <Label key={`m${y}-${m}`} text={MONTHS[m]} x={cellX(y, 0) - 0.75} z={cellZ(row) } height={0.55} color="#6d6a62" anchor="right" />,
      );
    }
  }
  return <>{labels}</>;
}

function Rig({ focus, panelOpen, onCenterYear }: { focus: Props['focus']; panelOpen: boolean; onCenterYear: (y: number) => void }) {
  const controls = useThree((s) => s.controls) as MapControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const goal = useRef<THREE.Vector3 | null>(null);
  const lastYear = useRef(BASE_YEAR);

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
    if (!controls) return;
    const cancel = () => (goal.current = null);
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, dt) => {
    if (!controls) return;
    if (goal.current) {
      const k = 1 - Math.pow(0.002, dt);
      const delta = goal.current.clone().sub(controls.target).multiplyScalar(k);
      controls.target.add(delta);
      camera.position.add(delta);
      controls.update();
      if (goal.current.distanceTo(controls.target) < 0.01) goal.current = null;
    }
    // Fog follows zoom: close up it's a corridor, far out the field sprawls into black.
    const dist = camera.position.distanceTo(controls.target);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = dist * 0.75;
      scene.fog.far = dist * 2.4;
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
  const start = useMemo(() => {
    const p = keyPosition(props.focus.key);
    p.x += 3 * PITCH;
    return p;
    // only the initial focus matters for the starting camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 50, position: start.clone().add(CAM_OFFSET).toArray(), near: 0.5, far: 400 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => gl.setClearColor('#050505')}
    >
      <fog attach="fog" args={['#050505', 15, 45]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[-10, 22, 8]} intensity={2.2} />
      <directionalLight position={[12, 6, -10]} intensity={0.4} color="#ff3b1f" />
      <Days marks={props.marks} today={props.today} selected={props.selected} onSelect={props.onSelect} centerYear={centerYear} />
      <YearLabels centerYear={centerYear} />
      <Lattice />
      <MapControls
        makeDefault
        target={start}
        enableRotate={false}
        screenSpacePanning={false}
        minDistance={5}
        maxDistance={120}
        enableDamping
        dampingFactor={0.12}
      />
      <Rig focus={props.focus} panelOpen={props.panelOpen} onCenterYear={setCenterYear} />
    </Canvas>
  );
}
