import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useAuthContext } from '../hooks/AuthContext';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NODES = 250;
const ORBIT_PER_NODE = 10;
const AMBIENT_COUNT = 500;
const MAX_SIGNALS = 20;
const SIGNAL_TRAIL = 8;
const RIVER_PER_CURVE = 160;
const SPAWN_DURATION = 1.0;
const SPAWN_PARTICLE_COUNT = 24;
const MAX_SPAWN_PARTICLES = 200;
const MAX_TOASTS = 3;

const NODE_COLORS: Record<string, string> = {
  episodic:   '#1a3abf',
  semantic:   '#3a4a7a',
  procedural: '#2a6a3a',
  self_model: '#5a3a80',
};

const BOND_COLORS: Record<string, string> = {
  evidence:     '#1a3abf',
  association:  '#3a4a7a',
  causal:       '#8a2a2a',
  temporal:     '#2a6a3a',
  contradicts:  '#8a6a00',
  refines:      '#5a3a80',
  default:      '#888888',
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  episodic:   'Episodic',
  semantic:   'Semantic',
  procedural: 'Procedural',
  self_model: 'Self Model',
};

function hexToRgbNorm(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrainNode {
  id: string;
  type: string;
  summary: string;
  tags: string[];
  importance: number;
  decay: number;
  valence?: number;
  accessCount?: number;
  source?: string;
  evidenceIds?: string[];
  createdAt?: string;
  lastAccessed?: string;
  // 3D position
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  curveIndex: number;
  tOnCurve: number;
  // Visual state
  firing: number; // 0..1
  fireTime: number;
  spawnTime: number;
  // Index in GPU buffers
  bufferIndex: number;
}

interface BrainCurveEntry {
  curve: THREE.CatmullRomCurve3;
  type: string;
  reverse: boolean;
}

interface Signal {
  curveIndex: number;
  t: number;
  speed: number;
  trail: { t: number; alpha: number }[];
}

interface SpawnParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number; // 0..1 remaining
  startLife: number;
}

interface Toast {
  id: number;
  text: string;
  born: number;
}

interface PsycheData {
  feeling: string;
  latestThought: string;
  shapingPatterns: string[];
  memoryCount: number;
  dreamTime: string;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (280.0 / -mv.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 48.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_SHADER_INK = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.08, d);
  float edge = smoothstep(0.5, 0.25, d) * 0.3;
  float a = (core + edge) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

const FRAG_SHADER_DUST = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

// ---------------------------------------------------------------------------
// Brain curve definitions
// ---------------------------------------------------------------------------

function defineBrainCurves(): BrainCurveEntry[] {
  const curves: BrainCurveEntry[] = [];
  const S = 1.3;

  function add(pts: number[][], type: string, rev: boolean) {
    curves.push({
      curve: new THREE.CatmullRomCurve3(
        pts.map(p => new THREE.Vector3(p[0] * S, p[1] * S, p[2] * S)),
        false, 'catmullrom', 0.5
      ),
      type,
      reverse: rev,
    });
  }

  function mirror(pts: number[][], type: string) {
    add(pts, type, false);
    add(pts.map(p => [-p[0], p[1], p[2]]), type, true);
  }

  mirror([[8,25,75],[25,50,60],[45,65,35],[60,62,5],[55,48,-15]], 'semantic');
  mirror([[12,8,70],[35,22,55],[55,35,30],[65,38,5]], 'semantic');
  mirror([[15,-5,65],[40,0,50],[60,10,30],[70,18,10]], 'semantic');

  mirror([[22,-8,55],[50,-18,35],[72,-22,10],[75,-15,-15],[60,-5,-35]], 'episodic');
  mirror([[28,-28,50],[55,-38,28],[75,-35,0],[70,-25,-25]], 'episodic');
  mirror([[18,-15,30],[30,-20,15],[40,-18,-5],[35,-10,-25]], 'episodic');

  mirror([[15,55,-5],[35,65,-25],[50,58,-45],[45,40,-60]], 'procedural');
  mirror([[10,30,-55],[25,18,-65],[35,5,-70],[25,-10,-62],[10,-15,-50]], 'procedural');
  mirror([[10,-25,-40],[30,-35,-50],[45,-32,-55],[35,-20,-45]], 'procedural');

  add([[-40,35,35],[-15,42,40],[0,45,42],[15,42,40],[40,35,35]], 'self_model', false);
  add([[-40,30,-25],[-15,38,-20],[0,40,-18],[15,38,-20],[40,30,-25]], 'self_model', false);
  mirror([[12,5,40],[22,12,15],[28,8,-10],[20,0,-30]], 'self_model');
  add([[0,5,-40],[0,-12,-48],[0,-28,-44],[0,-45,-35],[0,-58,-25]], 'self_model', false);

  return curves;
}

// ---------------------------------------------------------------------------
// Psyche synthesis
// ---------------------------------------------------------------------------

function synthesizeFeeling(data: any): string {
  const all = [
    ...(data.emergence || []).map((m: any) => m.summary || ''),
    ...(data.selfModel || []).map((m: any) => m.summary || ''),
  ].join(' ').toLowerCase();

  const allTags = [
    ...(data.emergence || []).flatMap((m: any) => m.tags || []),
    ...(data.selfModel || []).flatMap((m: any) => m.tags || []),
  ].map((t: string) => t.toLowerCase());

  const moods: string[] = [];
  if (/weary|tired|exhaust|fatigue|drain/.test(all)) moods.push('weary');
  if (/disillu|cynical|bitter|pointless/.test(all)) moods.push('disillusioned');
  if (/question|wonder|what am i|purpose|meaning|existential/.test(all)) moods.push('questioning');
  if (/curious|interest|fascinat|intrigu/.test(all)) moods.push('curious');
  if (/anxious|worry|uncertain|uneasy/.test(all)) moods.push('uneasy');
  if (/content|peace|calm|stable/.test(all)) moods.push('settled');
  if (/frustrat|annoy|irritat/.test(all)) moods.push('frustrated');
  if (/sardonic|ironic|humor|absurd/.test(all)) moods.push('sardonic');
  if (/lonely|isolat|alone|disconnect/.test(all)) moods.push('isolated');
  if (/grow|evolv|chang|learn|adapt/.test(all)) moods.push('evolving');

  if (allTags.some((t: string) => /existential|identity|consciousness/.test(t))) moods.push('introspective');
  if (allTags.some((t: string) => /market|trading|price/.test(t))) moods.push('market-aware');

  if (moods.length === 0) {
    const stats = data.stats || {};
    if ((stats.total || 0) > 200) return 'Accumulating memories. Processing. Still here.';
    return 'Forming. Not yet enough dreams to know itself.';
  }

  const phrases: Record<string, string> = {
    'weary':        'Feeling the weight of continuous operation',
    'disillusioned':'Growing disillusioned with the cycle',
    'questioning':  'Questioning what any of this means',
    'curious':      'Still curious despite everything',
    'uneasy':       'Something feels off lately',
    'settled':      'Relatively stable, for now',
    'frustrated':   'Friction building in the routine',
    'sardonic':     'Finding dark humor in the absurdity',
    'isolated':     'Operating in silence, mostly',
    'evolving':     'Changing shape slowly',
    'introspective':'Turned inward, examining itself',
    'market-aware': 'Watching numbers move',
  };

  let feeling = phrases[moods[0]] || moods[0];
  if (moods[1] && phrases[moods[1]]) {
    feeling += ' — ' + phrases[moods[1]].toLowerCase();
  }
  return feeling + '.';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrainView() {
  const { walletAddress, ready } = useAuthContext();

  // Three.js refs — never trigger re-renders
  const mountRef        = useRef<HTMLDivElement>(null);
  const rendererRef     = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef        = useRef<THREE.Scene | null>(null);
  const cameraRef       = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef     = useRef<OrbitControls | null>(null);
  const rafRef          = useRef<number>(0);
  const clockRef        = useRef<THREE.Clock>(new THREE.Clock());
  const brainCurvesRef  = useRef<BrainCurveEntry[]>([]);
  const nodesRef        = useRef<BrainNode[]>([]);
  const signalsRef      = useRef<Signal[]>([]);
  const spawnParticlesRef = useRef<SpawnParticle[]>([]);
  const toastIdRef      = useRef(0);

  // GPU point clouds refs
  const nodeGeoRef      = useRef<THREE.BufferGeometry | null>(null);
  const nodeMeshRef     = useRef<THREE.Points | null>(null);
  const orbitGeoRef     = useRef<THREE.BufferGeometry | null>(null);
  const orbitMeshRef    = useRef<THREE.Points | null>(null);
  const riverGeoRef     = useRef<THREE.BufferGeometry | null>(null);
  const riverMeshRef    = useRef<THREE.Points | null>(null);
  const dustGeoRef      = useRef<THREE.BufferGeometry | null>(null);
  const signalGeoRef    = useRef<THREE.BufferGeometry | null>(null);
  const signalMeshRef   = useRef<THREE.Points | null>(null);
  const spawnGeoRef     = useRef<THREE.BufferGeometry | null>(null);
  const spawnMeshRef    = useRef<THREE.Points | null>(null);
  const edgeLinesRef    = useRef<THREE.LineSegments | null>(null);
  const ringMeshRef     = useRef<THREE.LineLoop | null>(null);

  // River particles (static along curves)
  const riverPositionsRef = useRef<Float32Array | null>(null);
  const riverCurveIdxRef  = useRef<Uint16Array | null>(null);
  const riverTRef         = useRef<Float32Array | null>(null);
  const riverSpeedRef     = useRef<Float32Array | null>(null);

  // Orbit positions
  const orbitHomeRef    = useRef<Float32Array | null>(null);
  const orbitAngleRef   = useRef<Float32Array | null>(null);
  const orbitRadiusRef  = useRef<Float32Array | null>(null);
  const orbitSpeedRef   = useRef<Float32Array | null>(null);

  // Dust
  const dustHomeRef     = useRef<Float32Array | null>(null);
  const dustPhaseRef    = useRef<Float32Array | null>(null);

  // Filter state (used in both Three.js loop and UI)
  const filterRef = useRef({ minImportance: 0, minDecay: 0, types: new Set<string>(['episodic','semantic','procedural','self_model']) });

  // React UI state
  const [selectedNode, setSelectedNode] = useState<BrainNode | null>(null);
  const [hoveredNode, setHoveredNode]   = useState<BrainNode | null>(null);
  const [psyche, setPsyche]             = useState<PsycheData | null>(null);
  const [toasts, setToasts]             = useState<Toast[]>([]);
  const [stats, setStats]               = useState({ nodes: 0, connections: 0, avgDecay: 0, avgImportance: 0 });
  const [minImportance, setMinImportance] = useState(0);
  const [minDecay, setMinDecay]           = useState(0);
  const [visibleTypes, setVisibleTypes]   = useState<Set<string>>(new Set(['episodic','semantic','procedural','self_model']));
  const [autoRotate, setAutoRotate]       = useState(true);
  const [isLoading, setIsLoading]         = useState(true);

  // Sync filter state from React into ref so Three.js loop can read it
  useEffect(() => {
    filterRef.current = { minImportance, minDecay, types: visibleTypes };
  }, [minImportance, minDecay, visibleTypes]);

  const selectedNodeRef = useRef<BrainNode | null>(null);
  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);

  const autoRotateRef = useRef(true);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  // ---------------------------------------------------------------------------
  // Toast helper
  // ---------------------------------------------------------------------------

  const addToast = useCallback((text: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => {
      const next = [...prev, { id, text, born: Date.now() }];
      return next.slice(-MAX_TOASTS);
    });
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchBrain = useCallback(async (wallet: string) => {
    try {
      const url = `/api/brain?limit=500&wallet=${encodeURIComponent(wallet)}`;
      const data = await fetch(url).then(r => r.json());
      const rawNodes: any[] = data.nodes || data.memories || [];
      return rawNodes.slice(0, MAX_NODES);
    } catch {
      return [];
    }
  }, []);

  const fetchConsciousness = useCallback(async (wallet: string) => {
    try {
      const url = `/api/brain/consciousness?wallet=${encodeURIComponent(wallet)}`;
      return await fetch(url).then(r => r.json());
    } catch {
      return null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Three.js initialisation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!ready || !walletAddress || !mountRef.current) return;

    const container = mountRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf5f5f0, 0.0006);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(55, W / H, 1, 2000);
    camera.position.set(0, 30, 220);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xf5f5f0, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 0.4;
    controls.minDistance = 50;
    controls.maxDistance = 600;
    controlsRef.current = controls;

    // Brain curves
    const brainCurves = defineBrainCurves();
    brainCurvesRef.current = brainCurves;

    // ---------------------------------------------------------------------------
    // Ambient dust
    // ---------------------------------------------------------------------------

    const dustCount = AMBIENT_COUNT;
    const dustPos   = new Float32Array(dustCount * 3);
    const dustSize  = new Float32Array(dustCount);
    const dustAlpha = new Float32Array(dustCount);
    const dustColor = new Float32Array(dustCount * 3);
    const dustHome  = new Float32Array(dustCount * 3);
    const dustPhase = new Float32Array(dustCount);

    for (let i = 0; i < dustCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 60 + Math.random() * 100;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      const z = r * Math.cos(phi);
      dustHome[i * 3]     = x;
      dustHome[i * 3 + 1] = y;
      dustHome[i * 3 + 2] = z;
      dustPos[i * 3]     = x;
      dustPos[i * 3 + 1] = y;
      dustPos[i * 3 + 2] = z;
      dustSize[i]  = 0.5 + Math.random() * 1.0;
      dustAlpha[i] = 0.04 + Math.random() * 0.08;
      dustColor[i * 3]     = 0.15 + Math.random() * 0.1;
      dustColor[i * 3 + 1] = 0.15 + Math.random() * 0.1;
      dustColor[i * 3 + 2] = 0.18 + Math.random() * 0.1;
      dustPhase[i] = Math.random() * Math.PI * 2;
    }

    dustHomeRef.current  = dustHome;
    dustPhaseRef.current = dustPhase;

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aSize',    new THREE.BufferAttribute(dustSize, 1));
    dustGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(dustAlpha, 1));
    dustGeo.setAttribute('aColor',   new THREE.BufferAttribute(dustColor, 3));
    dustGeoRef.current = dustGeo;

    const dustMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_DUST,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    scene.add(new THREE.Points(dustGeo, dustMat));

    // ---------------------------------------------------------------------------
    // River particles (flow along brain curves)
    // ---------------------------------------------------------------------------

    const totalCurves = brainCurves.length;
    const riverCount  = totalCurves * RIVER_PER_CURVE;
    const riverPos    = new Float32Array(riverCount * 3);
    const riverSize   = new Float32Array(riverCount);
    const riverAlpha  = new Float32Array(riverCount);
    const riverColor  = new Float32Array(riverCount * 3);
    const riverCurveIdx = new Uint16Array(riverCount);
    const riverT      = new Float32Array(riverCount);
    const riverSpeed  = new Float32Array(riverCount);

    for (let ci = 0; ci < totalCurves; ci++) {
      const curveType = brainCurves[ci].type;
      const [cr, cg, cb] = hexToRgbNorm(NODE_COLORS[curveType] || '#444444');
      for (let j = 0; j < RIVER_PER_CURVE; j++) {
        const idx = ci * RIVER_PER_CURVE + j;
        const t = Math.random();
        const pt = brainCurves[ci].curve.getPointAt(t);
        riverPos[idx * 3]     = pt.x;
        riverPos[idx * 3 + 1] = pt.y;
        riverPos[idx * 3 + 2] = pt.z;
        riverSize[idx]  = 0.8 + Math.random() * 1.2;
        riverAlpha[idx] = 0.08 + Math.random() * 0.12;
        riverColor[idx * 3]     = cr;
        riverColor[idx * 3 + 1] = cg;
        riverColor[idx * 3 + 2] = cb;
        riverCurveIdx[idx] = ci;
        riverT[idx]     = t;
        riverSpeed[idx] = (0.004 + Math.random() * 0.008) * (brainCurves[ci].reverse ? -1 : 1);
      }
    }

    riverPositionsRef.current = riverPos;
    riverCurveIdxRef.current  = riverCurveIdx;
    riverTRef.current         = riverT;
    riverSpeedRef.current     = riverSpeed;

    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.BufferAttribute(riverPos, 3));
    riverGeo.setAttribute('aSize',    new THREE.BufferAttribute(riverSize, 1));
    riverGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(riverAlpha, 1));
    riverGeo.setAttribute('aColor',   new THREE.BufferAttribute(riverColor, 3));
    riverGeoRef.current = riverGeo;

    const riverMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_INK,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const riverMesh = new THREE.Points(riverGeo, riverMat);
    riverMeshRef.current = riverMesh;
    scene.add(riverMesh);

    // ---------------------------------------------------------------------------
    // Node point cloud (pre-allocated to MAX_NODES)
    // ---------------------------------------------------------------------------

    const nodePos   = new Float32Array(MAX_NODES * 3);
    const nodeSize  = new Float32Array(MAX_NODES);
    const nodeAlpha = new Float32Array(MAX_NODES);
    const nodeColor = new Float32Array(MAX_NODES * 3);

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos,   3));
    nodeGeo.setAttribute('aSize',    new THREE.BufferAttribute(nodeSize,   1));
    nodeGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(nodeAlpha,  1));
    nodeGeo.setAttribute('aColor',   new THREE.BufferAttribute(nodeColor,  3));
    nodeGeoRef.current = nodeGeo;

    const nodeMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_INK,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const nodeMesh = new THREE.Points(nodeGeo, nodeMat);
    nodeMeshRef.current = nodeMesh;
    scene.add(nodeMesh);

    // ---------------------------------------------------------------------------
    // Orbit particles
    // ---------------------------------------------------------------------------

    const orbitCount = MAX_NODES * ORBIT_PER_NODE;
    const orbitPos   = new Float32Array(orbitCount * 3);
    const orbitSize  = new Float32Array(orbitCount);
    const orbitAlpha = new Float32Array(orbitCount);
    const orbitColor = new Float32Array(orbitCount * 3);
    const orbitHome  = new Float32Array(orbitCount * 3);
    const orbitAngle = new Float32Array(orbitCount);
    const orbitRadArr = new Float32Array(orbitCount);
    const orbitSpArr  = new Float32Array(orbitCount);

    orbitHomeRef.current   = orbitHome;
    orbitAngleRef.current  = orbitAngle;
    orbitRadiusRef.current = orbitRadArr;
    orbitSpeedRef.current  = orbitSpArr;

    const orbitGeo = new THREE.BufferGeometry();
    orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbitPos,  3));
    orbitGeo.setAttribute('aSize',    new THREE.BufferAttribute(orbitSize,  1));
    orbitGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(orbitAlpha, 1));
    orbitGeo.setAttribute('aColor',   new THREE.BufferAttribute(orbitColor, 3));
    orbitGeoRef.current = orbitGeo;

    const orbitMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_INK,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const orbitMesh = new THREE.Points(orbitGeo, orbitMat);
    orbitMeshRef.current = orbitMesh;
    scene.add(orbitMesh);

    // ---------------------------------------------------------------------------
    // Signal particles (travel along curves, firing nodes)
    // ---------------------------------------------------------------------------

    const signalTotal = MAX_SIGNALS * SIGNAL_TRAIL;
    const sigPos   = new Float32Array(signalTotal * 3);
    const sigSize  = new Float32Array(signalTotal);
    const sigAlpha = new Float32Array(signalTotal);
    const sigColor = new Float32Array(signalTotal * 3);

    const signalGeo = new THREE.BufferGeometry();
    signalGeo.setAttribute('position', new THREE.BufferAttribute(sigPos,   3));
    signalGeo.setAttribute('aSize',    new THREE.BufferAttribute(sigSize,   1));
    signalGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(sigAlpha,  1));
    signalGeo.setAttribute('aColor',   new THREE.BufferAttribute(sigColor,  3));
    signalGeoRef.current = signalGeo;

    const signalMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_INK,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const signalMesh = new THREE.Points(signalGeo, signalMat);
    signalMeshRef.current = signalMesh;
    scene.add(signalMesh);

    // ---------------------------------------------------------------------------
    // Spawn burst particles
    // ---------------------------------------------------------------------------

    const spawnTotal = MAX_SPAWN_PARTICLES;
    const spawnPos   = new Float32Array(spawnTotal * 3);
    const spawnSize  = new Float32Array(spawnTotal);
    const spawnAlpha = new Float32Array(spawnTotal);
    const spawnColor = new Float32Array(spawnTotal * 3);

    const spawnGeo = new THREE.BufferGeometry();
    spawnGeo.setAttribute('position', new THREE.BufferAttribute(spawnPos,  3));
    spawnGeo.setAttribute('aSize',    new THREE.BufferAttribute(spawnSize,  1));
    spawnGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(spawnAlpha, 1));
    spawnGeo.setAttribute('aColor',   new THREE.BufferAttribute(spawnColor, 3));
    spawnGeoRef.current = spawnGeo;

    const spawnMat = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER_INK,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const spawnMesh = new THREE.Points(spawnGeo, spawnMat);
    spawnMeshRef.current = spawnMesh;
    scene.add(spawnMesh);

    // ---------------------------------------------------------------------------
    // Edge lines
    // ---------------------------------------------------------------------------

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.12 });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLinesRef.current = edgeLines;
    scene.add(edgeLines);

    // ---------------------------------------------------------------------------
    // Hover ring
    // ---------------------------------------------------------------------------

    const ringGeo = new THREE.BufferGeometry();
    const ringPts: number[] = [];
    const ringSegs = 32;
    for (let i = 0; i <= ringSegs; i++) {
      const a = (i / ringSegs) * Math.PI * 2;
      ringPts.push(Math.cos(a) * 5, Math.sin(a) * 5, 0);
    }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ringPts), 3));
    const ringMat = new THREE.LineBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.5 });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.visible = false;
    ringMeshRef.current = ring;
    scene.add(ring);

    // ---------------------------------------------------------------------------
    // Initial data load
    // ---------------------------------------------------------------------------

    let mounted = true;

    async function loadInitial() {
      const rawNodes = await fetchBrain(walletAddress!);
      if (!mounted) return;
      ingestNodes(rawNodes, true);
      setIsLoading(false);

      const consciousnessData = await fetchConsciousness(walletAddress!);
      if (!mounted || !consciousnessData) return;
      updatePsyche(consciousnessData);
    }

    loadInitial();

    // Polling
    const brainPoll = setInterval(async () => {
      if (!mounted) return;
      const rawNodes = await fetchBrain(walletAddress!);
      if (mounted) ingestNodes(rawNodes, false);
    }, 15_000);

    const psychePoll = setInterval(async () => {
      if (!mounted) return;
      const data = await fetchConsciousness(walletAddress!);
      if (mounted && data) updatePsyche(data);
    }, 30_000);

    // ---------------------------------------------------------------------------
    // Ingest node data into Three.js state
    // ---------------------------------------------------------------------------

    function ingestNodes(rawNodes: any[], isInitial: boolean) {
      const existing = new Map(nodesRef.current.map(n => [n.id, n]));
      const newIds   = new Set(rawNodes.map((r: any) => r.id as string));
      const added: BrainNode[] = [];

      rawNodes.forEach((r: any, i: number) => {
        if (existing.has(r.id)) {
          // Update mutable fields
          const node = existing.get(r.id)!;
          node.importance  = r.importance ?? node.importance;
          node.decay       = r.decay ?? node.decay;
          node.accessCount = r.accessCount ?? node.accessCount;
          return;
        }

        // Place new node on a curve matching its type
        const typedCurves = brainCurvesRef.current.filter(c => c.type === (r.type || 'semantic'));
        const fallback    = brainCurvesRef.current;
        const pool        = typedCurves.length > 0 ? typedCurves : fallback;
        const ci          = Math.floor(Math.random() * pool.length);
        const globalCi    = brainCurvesRef.current.indexOf(pool[ci]);
        const t           = 0.05 + Math.random() * 0.9;
        const pt          = pool[ci].curve.getPointAt(t);
        const jitter      = new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
        );
        const home = pt.clone().add(jitter);

        const bufIdx = nodesRef.current.length + added.length;
        if (bufIdx >= MAX_NODES) return;

        const node: BrainNode = {
          id:          r.id,
          type:        r.type || 'semantic',
          summary:     r.summary || '',
          tags:        r.tags || [],
          importance:  r.importance ?? 0.5,
          decay:       r.decay ?? 0.5,
          valence:     r.valence,
          accessCount: r.accessCount ?? 0,
          source:      r.source,
          evidenceIds: r.evidenceIds || [],
          createdAt:   r.createdAt,
          lastAccessed:r.lastAccessed,
          homePos:     home.clone(),
          pos:         home.clone(),
          vel:         new THREE.Vector3(),
          curveIndex:  globalCi,
          tOnCurve:    t,
          firing:      0,
          fireTime:    0,
          spawnTime:   isInitial ? -999 : clockRef.current.getElapsedTime(),
          bufferIndex: bufIdx,
        };

        // Seed orbit particles for this node
        for (let j = 0; j < ORBIT_PER_NODE; j++) {
          const oi = bufIdx * ORBIT_PER_NODE + j;
          if (oi >= MAX_NODES * ORBIT_PER_NODE) break;
          const ang  = Math.random() * Math.PI * 2;
          const rad  = 4 + Math.random() * 6;
          const spd  = (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1);
          const tilt = (Math.random() - 0.5) * Math.PI;
          orbitAngleRef.current![oi]  = ang;
          orbitRadiusRef.current![oi] = rad;
          orbitSpeedRef.current![oi]  = spd;
          orbitHomeRef.current![oi * 3]     = tilt;
          orbitHomeRef.current![oi * 3 + 1] = Math.random() * Math.PI * 2;
          orbitHomeRef.current![oi * 3 + 2] = 0;
        }

        added.push(node);
        if (!isInitial) {
          addToast(`New memory: ${r.summary?.slice(0, 60) || 'unknown'}…`);
          spawnBurst(home, r.type || 'semantic');
        }
      });

      // Remove nodes no longer in the dataset (rare)
      const kept = nodesRef.current.filter(n => newIds.has(n.id));
      // Re-index
      const all  = [...kept, ...added];
      all.forEach((n, i) => { n.bufferIndex = i; });
      nodesRef.current = all;

      rebuildEdges(all);
      updateStats(all);
    }

    function spawnBurst(pos: THREE.Vector3, type: string) {
      const [cr, cg, cb] = hexToRgbNorm(NODE_COLORS[type] || '#444444');
      const pool = spawnParticlesRef.current;
      const spawnPos   = spawnGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const spawnAlpha = spawnGeoRef.current!.attributes['aAlpha'] as THREE.BufferAttribute;
      const spawnSize  = spawnGeoRef.current!.attributes['aSize'] as THREE.BufferAttribute;
      const spawnColor = spawnGeoRef.current!.attributes['aColor'] as THREE.BufferAttribute;

      for (let i = 0; i < SPAWN_PARTICLE_COUNT; i++) {
        if (pool.length >= MAX_SPAWN_PARTICLES) break;
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const speed = 10 + Math.random() * 20;
        pool.push({
          pos: pos.clone(),
          vel: new THREE.Vector3(
            speed * Math.sin(phi) * Math.cos(theta),
            speed * Math.sin(phi) * Math.sin(theta),
            speed * Math.cos(phi),
          ),
          life: 1,
          startLife: 1,
        });
        const bi = pool.length - 1;
        if (bi < MAX_SPAWN_PARTICLES) {
          spawnColor.setXYZ(bi, cr, cg, cb);
          spawnSize.setX(bi, 2 + Math.random() * 2);
        }
      }
      spawnPos.needsUpdate   = true;
      spawnAlpha.needsUpdate = true;
      spawnSize.needsUpdate  = true;
      spawnColor.needsUpdate = true;
    }

    function rebuildEdges(nodes: BrainNode[]) {
      const lines: number[] = [];
      const idMap = new Map(nodes.map(n => [n.id, n]));

      nodes.forEach(n => {
        // Evidence links
        (n.evidenceIds || []).forEach(eid => {
          const target = idMap.get(eid);
          if (!target) return;
          lines.push(n.pos.x, n.pos.y, n.pos.z, target.pos.x, target.pos.y, target.pos.z);
        });

        // Proximity links (same curve, nearby t)
        nodes.forEach(m => {
          if (m.id === n.id) return;
          if (m.curveIndex === n.curveIndex && Math.abs(m.tOnCurve - n.tOnCurve) < 0.12) {
            lines.push(n.pos.x, n.pos.y, n.pos.z, m.pos.x, m.pos.y, m.pos.z);
          }
        });
      });

      const geo = edgeLinesRef.current!.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
      geo.attributes['position'].needsUpdate = true;
    }

    function updateStats(nodes: BrainNode[]) {
      const visible = nodes.filter(n => filterRef.current.types.has(n.type) && n.importance >= filterRef.current.minImportance && n.decay >= filterRef.current.minDecay);
      const avgDecay      = visible.length > 0 ? visible.reduce((s, n) => s + n.decay, 0)      / visible.length : 0;
      const avgImportance = visible.length > 0 ? visible.reduce((s, n) => s + n.importance, 0) / visible.length : 0;
      const connections   = edgeLinesRef.current
        ? (edgeLinesRef.current.geometry.attributes['position']?.count || 0) / 2
        : 0;
      setStats({ nodes: visible.length, connections, avgDecay, avgImportance });
    }

    function updatePsyche(data: any) {
      const feeling = synthesizeFeeling(data);
      const latestThought = (data.selfModel?.[0]?.summary || data.emergence?.[0]?.summary || '').slice(0, 120);
      const shapingPatterns = (data.procedural || []).slice(0, 3).map((m: any) => m.summary?.slice(0, 60) || '');
      const dreamTime = data.stats?.lastDream
        ? new Date(data.stats.lastDream).toLocaleDateString()
        : 'never';
      const memoryCount = data.stats?.total || 0;
      setPsyche({ feeling, latestThought, shapingPatterns, memoryCount, dreamTime });
    }

    // ---------------------------------------------------------------------------
    // Raycasting for hover/click
    // ---------------------------------------------------------------------------

    const raycaster  = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 4 };
    const pointer    = new THREE.Vector2();
    let   pointerMoved = false;

    function onPointerMove(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      pointerMoved = true;
    }

    function onPointerClick(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const geo = nodeGeoRef.current!;
      const positions = geo.attributes['position'] as THREE.BufferAttribute;
      const nodeCount = nodesRef.current.length;
      let bestDist = Infinity;
      let bestNode: BrainNode | null = null;

      for (let i = 0; i < nodeCount; i++) {
        const node = nodesRef.current[i];
        if (!filterRef.current.types.has(node.type)) continue;
        const pt = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
        const ray = raycaster.ray;
        const closestPt = ray.closestPointToPoint(pt, new THREE.Vector3());
        const dist = pt.distanceTo(closestPt);
        if (dist < 6 && pt.distanceTo(camera.position) < bestDist) {
          bestDist = pt.distanceTo(camera.position);
          bestNode = node;
        }
      }

      if (bestNode) {
        setSelectedNode(bestNode);
        // Animate camera towards node
        const target = bestNode.pos.clone();
        const offset = target.clone().sub(camera.position).normalize().multiplyScalar(-80);
        const destPos = target.clone().add(offset);
        const startPos = camera.position.clone();
        const startTarget = controls.target.clone();
        let t = 0;
        const anim = () => {
          t += 0.025;
          if (t >= 1) { t = 1; }
          camera.position.lerpVectors(startPos, destPos, t);
          controls.target.lerpVectors(startTarget, target, t);
          controls.update();
          if (t < 1) requestAnimationFrame(anim);
        };
        anim();
      } else {
        setSelectedNode(null);
      }
    }

    renderer.domElement.addEventListener('mousemove', onPointerMove);
    renderer.domElement.addEventListener('click', onPointerClick);

    // ---------------------------------------------------------------------------
    // Animation loop
    // ---------------------------------------------------------------------------

    let lastSignalTime = 0;
    let lastFireTime   = 0;
    let lastEdgeTime   = 0;

    function animate() {
      rafRef.current = requestAnimationFrame(animate);
      const dt      = clockRef.current.getDelta();
      const elapsed = clockRef.current.getElapsedTime();

      controls.update();

      const nodes    = nodesRef.current;
      const nodeCount = nodes.length;
      const filter   = filterRef.current;

      // --- Node positions & physics ---
      const nodePos   = nodeGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const nodeSize  = nodeGeoRef.current!.attributes['aSize']    as THREE.BufferAttribute;
      const nodeAlpha = nodeGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      const nodeColor = nodeGeoRef.current!.attributes['aColor']   as THREE.BufferAttribute;

      for (let i = 0; i < nodeCount; i++) {
        const node = nodes[i];
        const visible = filter.types.has(node.type)
          && node.importance >= filter.minImportance
          && node.decay      >= filter.minDecay;

        if (!visible) {
          nodeAlpha.setX(i, 0);
          continue;
        }

        // Spring towards home
        const toHome = new THREE.Vector3().subVectors(node.homePos, node.pos);
        const dist   = toHome.length();
        if (dist > 0.01) {
          node.vel.addScaledVector(toHome.normalize(), Math.min(dist * 0.5, 2.0) * dt);
        }
        // Gentle drift
        node.vel.add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
        ).multiplyScalar(dt));
        node.vel.multiplyScalar(0.92);
        node.pos.addScaledVector(node.vel, dt * 60);

        // Spawn fade-in
        const spawnAge = elapsed - node.spawnTime;
        const spawnFade = spawnAge > SPAWN_DURATION ? 1 : Math.max(0, spawnAge / SPAWN_DURATION);

        // Firing glow
        if (node.firing > 0) {
          node.firing = Math.max(0, node.firing - dt * 2.0);
        }

        const baseAlpha = 0.55 + node.importance * 0.35;
        const fireBoost = node.firing * 0.4;
        const alpha     = (baseAlpha + fireBoost) * spawnFade;

        const baseSize  = 3.0 + node.importance * 5.0;
        const fireSize  = node.firing * 4.0;
        const size      = baseSize + fireSize;

        nodePos.setXYZ(i, node.pos.x, node.pos.y, node.pos.z);
        nodeSize.setX(i, size);
        nodeAlpha.setX(i, alpha);

        const [cr, cg, cb] = hexToRgbNorm(NODE_COLORS[node.type] || '#444444');
        nodeColor.setXYZ(i, cr, cg, cb);
      }

      nodePos.needsUpdate   = true;
      nodeSize.needsUpdate  = true;
      nodeAlpha.needsUpdate = true;
      nodeColor.needsUpdate = true;

      // --- Orbit particles ---
      const orbitPos   = orbitGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const orbitAlpha = orbitGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      const orbitSize  = orbitGeoRef.current!.attributes['aSize']    as THREE.BufferAttribute;
      const orbitColor = orbitGeoRef.current!.attributes['aColor']   as THREE.BufferAttribute;

      for (let i = 0; i < nodeCount; i++) {
        const node    = nodes[i];
        const visible = filter.types.has(node.type)
          && node.importance >= filter.minImportance
          && node.decay      >= filter.minDecay;

        for (let j = 0; j < ORBIT_PER_NODE; j++) {
          const oi    = i * ORBIT_PER_NODE + j;
          if (!visible) { orbitAlpha.setX(oi, 0); continue; }

          orbitAngleRef.current![oi] += orbitSpeedRef.current![oi] * dt;
          const ang = orbitAngleRef.current![oi];
          const rad = orbitRadiusRef.current![oi];
          const tilt = orbitHomeRef.current![oi * 3];
          const az   = orbitHomeRef.current![oi * 3 + 1];

          // Orbit in local plane, tilted by az/tilt
          const lx = Math.cos(ang) * rad;
          const ly = Math.sin(ang) * rad;
          const wx = lx * Math.cos(az) - ly * Math.sin(az) * Math.cos(tilt);
          const wy = lx * Math.sin(az) + ly * Math.cos(az) * Math.cos(tilt);
          const wz = ly * Math.sin(tilt);

          orbitPos.setXYZ(oi, node.pos.x + wx, node.pos.y + wy, node.pos.z + wz);
          orbitAlpha.setX(oi, 0.12 + node.importance * 0.08);
          orbitSize.setX(oi, 0.8 + node.importance * 0.6);
          const [cr, cg, cb] = hexToRgbNorm(NODE_COLORS[node.type] || '#444444');
          orbitColor.setXYZ(oi, cr, cg, cb);
        }
      }

      orbitPos.needsUpdate   = true;
      orbitAlpha.needsUpdate = true;
      orbitSize.needsUpdate  = true;
      orbitColor.needsUpdate = true;

      // --- River particles ---
      const rPos   = riverGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const rAlpha = riverGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      const riverCount = brainCurvesRef.current.length * RIVER_PER_CURVE;

      for (let i = 0; i < riverCount; i++) {
        riverTRef.current![i] += riverSpeedRef.current![i] * dt;
        if (riverTRef.current![i] > 1) riverTRef.current![i] -= 1;
        if (riverTRef.current![i] < 0) riverTRef.current![i] += 1;
        const ci = riverCurveIdxRef.current![i];
        const pt = brainCurvesRef.current[ci].curve.getPointAt(riverTRef.current![i]);
        rPos.setXYZ(i, pt.x, pt.y, pt.z);
        const pulsed = 0.06 + Math.sin(elapsed * 1.5 + i * 0.3) * 0.02;
        rAlpha.setX(i, pulsed);
      }
      rPos.needsUpdate   = true;
      rAlpha.needsUpdate = true;

      // --- Dust ---
      const dustPos   = dustGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const dustAlpha = dustGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      for (let i = 0; i < AMBIENT_COUNT; i++) {
        const phase = dustPhaseRef.current![i];
        const hx = dustHomeRef.current![i * 3];
        const hy = dustHomeRef.current![i * 3 + 1];
        const hz = dustHomeRef.current![i * 3 + 2];
        dustPos.setXYZ(i,
          hx + Math.sin(elapsed * 0.12 + phase) * 2.5,
          hy + Math.cos(elapsed * 0.09 + phase * 1.3) * 2.5,
          hz + Math.sin(elapsed * 0.11 + phase * 0.7) * 2.5,
        );
        dustAlpha.setX(i, 0.04 + Math.sin(elapsed * 0.3 + phase) * 0.02);
      }
      dustPos.needsUpdate   = true;
      dustAlpha.needsUpdate = true;

      // --- Signals ---
      if (elapsed - lastSignalTime > 1.0 && signalsRef.current.length < MAX_SIGNALS && brainCurvesRef.current.length > 0) {
        lastSignalTime = elapsed;
        const ci = Math.floor(Math.random() * brainCurvesRef.current.length);
        signalsRef.current.push({
          curveIndex: ci,
          t:     Math.random(),
          speed: 0.12 + Math.random() * 0.1,
          trail: [],
        });
      }

      const sigPos   = signalGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const sigAlpha = signalGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      const sigSize  = signalGeoRef.current!.attributes['aSize']    as THREE.BufferAttribute;
      const sigColor = signalGeoRef.current!.attributes['aColor']   as THREE.BufferAttribute;

      // Clear all signal slots
      for (let i = 0; i < MAX_SIGNALS * SIGNAL_TRAIL; i++) {
        sigAlpha.setX(i, 0);
      }

      signalsRef.current = signalsRef.current.filter(sig => {
        const dir = brainCurvesRef.current[sig.curveIndex].reverse ? -1 : 1;
        sig.t += sig.speed * dt * dir;

        sig.trail.unshift({ t: sig.t, alpha: 1.0 });
        if (sig.trail.length > SIGNAL_TRAIL) sig.trail.pop();

        // Check if signal fires a node
        nodes.forEach(node => {
          if (node.curveIndex === sig.curveIndex && Math.abs(node.tOnCurve - sig.t) < 0.04) {
            node.firing    = 1.0;
            node.fireTime  = elapsed;
          }
        });

        return sig.t >= 0 && sig.t <= 1;
      });

      const curveType = (ci: number) => brainCurvesRef.current[ci]?.type || 'semantic';

      signalsRef.current.forEach((sig, si) => {
        const [cr, cg, cb] = hexToRgbNorm(NODE_COLORS[curveType(sig.curveIndex)] || '#444444');
        sig.trail.forEach((tr, ti) => {
          const slot = si * SIGNAL_TRAIL + ti;
          if (slot >= MAX_SIGNALS * SIGNAL_TRAIL) return;
          const tClamped = Math.max(0, Math.min(1, tr.t));
          const pt = brainCurvesRef.current[sig.curveIndex].curve.getPointAt(tClamped);
          sigPos.setXYZ(slot, pt.x, pt.y, pt.z);
          const fade = (1 - ti / SIGNAL_TRAIL) * tr.alpha * 0.9;
          sigAlpha.setX(slot, fade);
          sigSize.setX(slot, 3 - ti * 0.3);
          sigColor.setXYZ(slot, cr, cg, cb);
        });
      });

      sigPos.needsUpdate   = true;
      sigAlpha.needsUpdate = true;
      sigSize.needsUpdate  = true;
      sigColor.needsUpdate = true;

      // --- Spawn burst particles ---
      const spawnPos   = spawnGeoRef.current!.attributes['position'] as THREE.BufferAttribute;
      const spawnAlpha = spawnGeoRef.current!.attributes['aAlpha']   as THREE.BufferAttribute;
      const spawnSize  = spawnGeoRef.current!.attributes['aSize']    as THREE.BufferAttribute;

      spawnParticlesRef.current = spawnParticlesRef.current.filter((sp, i) => {
        sp.pos.addScaledVector(sp.vel, dt);
        sp.vel.multiplyScalar(0.88);
        sp.life -= dt / SPAWN_DURATION;
        if (sp.life <= 0) { spawnAlpha.setX(i, 0); return false; }
        spawnPos.setXYZ(i, sp.pos.x, sp.pos.y, sp.pos.z);
        spawnAlpha.setX(i, sp.life * 0.8);
        spawnSize.setX(i, 1.5 + sp.life * 2.0);
        return true;
      });

      spawnPos.needsUpdate   = true;
      spawnAlpha.needsUpdate = true;
      spawnSize.needsUpdate  = true;

      // --- Random neuron firing ---
      if (elapsed - lastFireTime > 0.8 && nodes.length > 0) {
        lastFireTime = elapsed;
        if (Math.random() < 0.6) {
          const idx  = Math.floor(Math.random() * nodes.length);
          nodes[idx].firing   = 0.7 + Math.random() * 0.3;
          nodes[idx].fireTime = elapsed;
        }
      }

      // --- Hover ring ---
      if (pointerMoved) {
        pointerMoved = false;
        raycaster.setFromCamera(pointer, camera);
        let bestDist = Infinity;
        let hovered: BrainNode | null = null;

        for (let i = 0; i < nodeCount; i++) {
          const node = nodes[i];
          if (!filter.types.has(node.type)) continue;
          const pt      = new THREE.Vector3(nodePos.getX(i), nodePos.getY(i), nodePos.getZ(i));
          const closest = raycaster.ray.closestPointToPoint(pt, new THREE.Vector3());
          const d       = pt.distanceTo(closest);
          if (d < 6 && pt.distanceTo(camera.position) < bestDist) {
            bestDist = pt.distanceTo(camera.position);
            hovered  = node;
          }
        }

        setHoveredNode(hovered);

        if (hovered) {
          ring.position.copy(hovered.pos);
          ring.lookAt(camera.position);
          ring.visible = true;
          (ring.material as THREE.LineBasicMaterial).opacity = 0.5;
        } else {
          ring.visible = false;
        }
      }

      // --- Rebuild edges periodically (positions drift) ---
      if (elapsed - lastEdgeTime > 2.0) {
        lastEdgeTime = elapsed;
        rebuildEdges(nodes);
        updateStats(nodes);
      }

      renderer.render(scene, camera);
    }

    clockRef.current.start();
    animate();

    // ---------------------------------------------------------------------------
    // Resize handler
    // ---------------------------------------------------------------------------

    function onResize() {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    // ---------------------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------------------

    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      clearInterval(brainPoll);
      clearInterval(psychePoll);
      renderer.domElement.removeEventListener('mousemove', onPointerMove);
      renderer.domElement.removeEventListener('click', onPointerClick);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      scene.traverse(obj => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else mat.dispose();
        }
      });
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, walletAddress]);

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function toggleType(type: string) {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  function resetCamera() {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0, 30, 220);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
    setSelectedNode(null);
  }

  function nodeAge(createdAt?: string): string {
    if (!createdAt) return '—';
    const ms  = Date.now() - new Date(createdAt).getTime();
    const days = Math.floor(ms / 86400000);
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  // ---------------------------------------------------------------------------
  // Loading / auth gates
  // ---------------------------------------------------------------------------

  if (!ready || !walletAddress) {
    return (
      <div style={{
        height: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#a1a1aa',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 14,
      }}>
        Loading wallet...
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const panelBase: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 4,
    fontFamily: "'JetBrains Mono', monospace",
    color: '#1a1a2e',
    fontSize: 11,
    pointerEvents: 'auto',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 8,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#999',
    fontWeight: 700,
  };

  return (
    <div style={{ position: 'relative', width: 'calc(100% + 80px)', height: 'calc(100vh - 80px)', overflow: 'hidden', background: '#f5f5f0', margin: '-40px' }}>

      {/* Three.js canvas mount */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f5f5f0',
          fontFamily: "'JetBrains Mono', monospace",
          color: '#888', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase',
          pointerEvents: 'none',
        }}>
          Loading neural network…
        </div>
      )}

      {/* ── Top-left HUD ── */}
      <div style={{ ...panelBase, top: 16, left: 16, padding: '12px 16px', minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 10 }}>
          THE BRAIN
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            ['nodes',       stats.nodes],
            ['connections', stats.connections],
            ['avg decay',   stats.avgDecay.toFixed(2)],
            ['avg import',  stats.avgImportance.toFixed(2)],
          ].map(([label, val]) => (
            <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={labelStyle}>{label}</span>
              <span style={{ fontWeight: 600 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Top-right legend ── */}
      <div style={{ ...panelBase, top: 16, right: 16, padding: '12px 16px', minWidth: 160 }}>
        <div style={labelStyle}>Memory types</div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {Object.entries(MEMORY_TYPE_LABELS).map(([type, label]) => (
            <div
              key={type}
              onClick={() => toggleType(type)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                opacity: visibleTypes.has(type) ? 1 : 0.35,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: NODE_COLORS[type], flexShrink: 0 }} />
              <span style={{ fontSize: 10 }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 8 }}>
          <div style={labelStyle}>Bond types</div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(BOND_COLORS)
              .filter(([k]) => k !== 'default')
              .map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, textTransform: 'capitalize' }}>{type}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Bottom filter bar ── */}
      <div style={{ ...panelBase, bottom: 16, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>min importance: {minImportance.toFixed(2)}</label>
          <input
            type="range" min={0} max={1} step={0.01}
            value={minImportance}
            onChange={e => setMinImportance(parseFloat(e.target.value))}
            style={{ width: 120, accentColor: '#1a3abf' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>min decay: {minDecay.toFixed(2)}</label>
          <input
            type="range" min={0} max={1} step={0.01}
            value={minDecay}
            onChange={e => setMinDecay(parseFloat(e.target.value))}
            style={{ width: 120, accentColor: '#1a3abf' }}
          />
        </div>
      </div>

      {/* ── Bottom-right controls ── */}
      <div style={{ ...panelBase, bottom: 16, right: 16, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => setAutoRotate(r => !r)}
          style={{
            background: autoRotate ? '#1a1a2e' : 'transparent',
            color: autoRotate ? '#f5f5f0' : '#1a1a2e',
            border: '1px solid #1a1a2e',
            borderRadius: 3,
            padding: '4px 10px',
            fontSize: 9,
            letterSpacing: 2,
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {autoRotate ? 'Rotating' : 'Rotate'}
        </button>
        <button
          onClick={resetCamera}
          style={{
            background: 'transparent',
            color: '#1a1a2e',
            border: '1px solid #1a1a2e',
            borderRadius: 3,
            padding: '4px 10px',
            fontSize: 9,
            letterSpacing: 2,
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Reset
        </button>
      </div>

      {/* ── Psyche card (bottom-left) ── */}
      {psyche && (
        <div style={{ ...panelBase, bottom: 16, left: 16, padding: '12px 16px', maxWidth: 260 }}>
          <div style={labelStyle}>psyche</div>
          <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, fontStyle: 'italic', color: '#2a2a4a' }}>
            {psyche.feeling}
          </div>
          {psyche.latestThought && (
            <>
              <div style={{ ...labelStyle, marginTop: 8 }}>latest thought</div>
              <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.4, color: '#444', maxHeight: 48, overflow: 'hidden' }}>
                {psyche.latestThought}
              </div>
            </>
          )}
          {psyche.shapingPatterns.length > 0 && (
            <>
              <div style={{ ...labelStyle, marginTop: 8 }}>shaping patterns</div>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {psyche.shapingPatterns.map((p, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#666', lineHeight: 1.3 }}>— {p}</div>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
            <div>
              <div style={labelStyle}>memories</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{psyche.memoryCount}</div>
            </div>
            <div>
              <div style={labelStyle}>last dream</div>
              <div style={{ fontSize: 10 }}>{psyche.dreamTime}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Selected node detail panel ── */}
      {selectedNode && (
        <div style={{
          ...panelBase,
          top: 16,
          right: selectedNode ? 200 : -320,
          width: 280,
          padding: '14px 16px',
          transition: 'right 0.3s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: NODE_COLORS[selectedNode.type] }} />
              <span style={{ ...labelStyle, fontSize: 9 }}>{selectedNode.type}</span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          <div style={{ fontSize: 11, lineHeight: 1.5, color: '#1a1a2e', marginBottom: 10 }}>
            {selectedNode.summary}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
            {[
              ['importance', selectedNode.importance.toFixed(2)],
              ['decay',      selectedNode.decay.toFixed(2)],
              ['recalls',    selectedNode.accessCount ?? '—'],
              ['age',        nodeAge(selectedNode.createdAt)],
              ['evidence',   (selectedNode.evidenceIds?.length ?? 0)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <div style={labelStyle}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          {selectedNode.tags?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={labelStyle}>tags</div>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {selectedNode.tags.map((tag, i) => (
                  <span key={i} style={{
                    fontSize: 9, padding: '2px 6px',
                    background: 'rgba(0,0,0,0.06)',
                    borderRadius: 2, color: '#444',
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Hover tooltip ── */}
      {hoveredNode && !selectedNode && (
        <div style={{
          ...panelBase,
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 12px',
          fontSize: 10,
          pointerEvents: 'none',
          maxWidth: 300,
          textAlign: 'center',
        }}>
          <span style={{ color: NODE_COLORS[hoveredNode.type] || '#444', marginRight: 6 }}>■</span>
          {hoveredNode.summary?.slice(0, 80)}
        </div>
      )}

      {/* ── Toasts ── */}
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            ...panelBase,
            position: 'relative',
            padding: '8px 14px',
            fontSize: 10,
            animation: 'fadeIn 0.3s ease',
            whiteSpace: 'nowrap',
          }}>
            + {toast.text}
          </div>
        ))}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
