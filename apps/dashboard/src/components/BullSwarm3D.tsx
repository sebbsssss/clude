/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * BullSwarm3D — the $ANSEM memory constellation as a 3D swim-through particle swarm.
 *
 * Same engine family as /lotr's MemoryGraph3D (three.js InstancedMesh + UnrealBloom +
 * orbit/zoom/fly camera), but instead of a procedural flow-knot the particles are pinned
 * to a 3D BULL point-cloud: the 2D bull silhouette sampled into a volume with depth, so
 * the swarm reads as the bull head-on yet you can drag to orbit, scroll to fly in, and
 * swim through it. Each particle floats with a small per-particle drift so the whole thing
 * breathes without losing the shape. Node brightness ∝ likes; recalled ids pulse bright.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ansemApi } from '../lib/ansem-api';

export interface BullNode {
  id: number;
  content?: string;
  likes?: number;
  // memory nodes (from /graph)
  type?: string;
  tags?: string[];
  source?: string;
  createdAt?: string;
  // live feed nodes (flown in from the $ANSEM timeline)
  live?: boolean;
  name?: string;
  handle?: string;
  url?: string;
}

interface Props {
  nodes: BullNode[];
  highlightIds: Set<number>;
  onHover?: (node: BullNode | null, x: number, y: number) => void;
  /** Click / tap a node → open its detail popup. */
  onSelect?: (node: BullNode) => void;
  /** New live posts just flew into the constellation (animate batch only). */
  onLiveJoin?: (posts: BullNode[]) => void;
}

// Bull silhouette (identical paths to the 2D constellation) — face/shield, horns, ears.
const PART_PATHS = [
  'M320,436 C352,402 442,392 500,394 C558,392 648,402 680,436 C704,512 686,606 632,700 C590,800 548,852 500,882 C452,852 410,800 368,700 C314,606 296,512 320,436 Z',
  'M360,430 C250,430 132,392 70,300 C40,255 30,205 44,180 C64,170 92,196 120,236 C170,306 250,360 372,404 C440,428 470,470 470,470 C430,452 392,440 360,430 Z',
  'M640,430 C750,430 868,392 930,300 C960,255 970,205 956,180 C936,170 908,196 880,236 C830,306 750,360 628,404 C560,428 530,470 530,470 C570,452 608,440 640,430 Z',
  'M335,480 C275,462 222,492 228,542 C262,570 312,562 340,542 Z',
  'M665,480 C725,462 778,492 772,542 C738,570 688,562 660,542 Z',
];

const PARTICLE_COUNT = 14000;

export function BullSwarm3D({ nodes, highlightIds, onHover, onSelect, onLiveJoin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);
  const nodesRef = useRef<BullNode[]>(nodes);
  const highlightRef = useRef<Set<number>>(highlightIds);
  // callbacks via refs — the engine effect runs once; inline-arrow props must not go stale
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const onLiveJoinRef = useRef(onLiveJoin);
  nodesRef.current = nodes;
  highlightRef.current = highlightIds;
  onHoverRef.current = onHover;
  onSelectRef.current = onSelect;
  onLiveJoinRef.current = onLiveJoin;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || engineRef.current) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 2 || h < 2) return;

    // Mobile: fewer particles + lower DPR cap — phone GPUs choke on 14k instances
    // + full-res bloom. The bull silhouette still reads clearly at 7k.
    const isSmall = Math.min(w, h) < 700;
    const count = isSmall ? 7000 : PARTICLE_COUNT;

    // ── Scene / camera / renderer ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.0008); // light — portrait fit needs a farther camera
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 3000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
    renderer.setPixelRatio(Math.min(isSmall ? 1.5 : 2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // Aspect-aware fit: pick the camera distance where the WHOLE bull fits the frustum,
    // fitting BOTH the horn span (half-width ~82) and the jaw-to-horn-tip run
    // (half-height ~64) and taking whichever needs more room.
    // On desktop (wide aspect) the vertical extent is the binding constraint — the old
    // width-only fit clipped the jaw + horn tips off-frame, which read as "too zoomed";
    // height-fitting pulls the camera back to ~117 so the full bull is in frame. Portrait
    // phones stay width-bound (~300+). The 1.08 margin keeps the bull off the frame edge.
    const VFOV_RAD = (60 * Math.PI) / 180;
    const fitDist = (aspect: number) => {
      const tanV = Math.tan(VFOV_RAD / 2);
      const tanH = tanV * Math.max(0.2, aspect);
      const widthFit = 82 / tanH;
      const heightFit = 64 / tanV;
      return Math.max(widthFit, heightFit) * 1.08;
    };

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.6, 0.5, 0.2);
    bloom.strength = 1.55; bloom.radius = 0.55; bloom.threshold = 0.06;
    composer.addPass(bloom);

    // Extra instance slots for LIVE nodes — new $ANSEM posts that fly in from
    // outside the frame and join the swarm (drawn after the bull particles).
    const LIVE_CAP = 24;
    const mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count + LIVE_CAP,
    );
    mesh.count = count;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    // ── Build the 3D bull point-cloud (silhouette → volume with depth) ──
    // isPointInPath in a 1000×1000 identity space, exactly like the 2D engine.
    const parts = PART_PATHS.map((d) => new Path2D(d));
    const tcv = document.createElement('canvas'); tcv.width = tcv.height = 1000;
    const tctx = tcv.getContext('2d')!;
    const inside = (x: number, y: number) => { for (const p of parts) if (tctx.isPointInPath(p, x, y)) return true; return false; };
    const nearEdge = (x: number, y: number) =>
      !inside(x - 12, y) || !inside(x + 12, y) || !inside(x, y - 12) || !inside(x, y + 12);

    const SCALE = 0.17;                       // 1000-space → world units
    const toWorld = (x: number, y: number, z: number) =>
      new THREE.Vector3((x - 500) * SCALE, -(y - 548) * SCALE, z);

    const EYES: Array<[number, number]> = [[420, 534], [580, 534]];
    const home: THREE.Vector3[] = [];         // pinned bull position per particle
    const driftAmp = new Float32Array(count);
    const driftPhase = new Float32Array(count);
    const driftSpeed = new Float32Array(count);
    const baseBright = new Float32Array(count);

    let rndS = 20240707;
    const rnd = () => ((rndS = (rndS * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let i = 0; i < count; i++) {
      let wx: number, wy: number;
      if (i < 2) {                            // eyes — the two brightest anchors
        [wx, wy] = EYES[i];
      } else {
        let g = 0;
        do { wx = rnd() * 1000; wy = rnd() * 1000; g++; } while (!inside(wx, wy) && g < 60);
      }
      const edge = i >= 2 && nearEdge(wx, wy);
      // Depth: a rounded slab — deeper toward the interior, thin at the rim, so the front
      // view stays a clean bull but there's real volume to fly through.
      const depthRange = edge ? 6 : 22;
      const z = (rnd() - 0.5) * 2 * depthRange;
      home.push(toWorld(wx, wy, z));
      driftAmp[i] = 0.7 + rnd() * 2.2;
      driftPhase[i] = rnd() * Math.PI * 2;
      driftSpeed[i] = 0.25 + rnd() * 0.7;
      baseBright[i] = i < 2 ? 1 : (edge ? 0.55 + rnd() * 0.4 : 0.28 + rnd() * 0.4);
    }

    const positions = home.map((v) => v.clone());
    const dummy = new THREE.Object3D();
    const target = new THREE.Vector3();
    const col = new THREE.Color();
    const clock = new THREE.Clock();

    // ── LIVE nodes: new $ANSEM posts fly in from outside the frame ──────────
    interface LiveNode { node: BullNode; home: THREE.Vector3; spawn: THREE.Vector3; pos: THREE.Vector3; born: number; ph: number }
    const live: LiveNode[] = [];
    const seenLive = new Set<string>();
    let liveSeq = -1;                       // negative ids — never collide with memory ids
    let firstFeed = true;
    const FLIGHT_MS = 2600;
    const spawnLive = (posts: Array<{ id: string; text: string; likes: number; name: string; handle: string; url: string }>, animate: boolean) => {
      for (const p of posts) {
        let qx = 500, qy = 560, g = 0;
        do { qx = Math.random() * 1000; qy = Math.random() * 1000; g++; } while (!inside(qx, qy) && g < 60);
        const hm = toWorld(qx, qy, (Math.random() - 0.5) * 30);
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize();
        const spawn = hm.clone().add(dir.multiplyScalar(360 + Math.random() * 180));
        live.push({
          node: { id: liveSeq--, content: p.text, likes: p.likes, name: p.name, handle: p.handle, url: p.url, live: true },
          home: hm, spawn,
          pos: animate ? spawn.clone() : hm.clone(),
          born: animate ? performance.now() : performance.now() - FLIGHT_MS * 10,
          ph: Math.random() * Math.PI * 2,
        });
        while (live.length > LIVE_CAP) live.shift();
      }
      if (animate && posts.length) {
        onLiveJoinRef.current?.(live.slice(-posts.length).map((L) => L.node));
      }
    };
    const pollFeed = async () => {
      try {
        const data = await ansemApi.getFeed();
        if (!data.enabled || !Array.isArray(data.posts)) return;
        const fresh = data.posts.filter((p) => !seenLive.has(p.id));
        fresh.forEach((p) => seenLive.add(p.id));
        // first batch seeds silently (the page just loaded — nothing is "new" to the
        // viewer yet); later polls fly the genuinely-new posts in, a few at a time.
        if (fresh.length) spawnLive(fresh.slice(0, 6), !firstFeed);
        firstFeed = false;
      } catch { /* transient — next poll catches up */ }
    };
    pollFeed();
    const feedIv = window.setInterval(pollFeed, 90_000);

    // ── Hover + click via raycaster (only the first nodes.length map to real memories) ──
    const raycaster = new THREE.Raycaster();
    raycaster.params.Mesh = { threshold: 0 } as any;
    const mouse = new THREE.Vector2();
    let hoverId: number | null = null;
    let hoverIdx = -1;                        // instance index of the hovered node (for sticky re-projection)
    const projV = new THREE.Vector3();
    // Pickable instances: bull data nodes [0, nlen) + live nodes [count, count+live.length).
    const posOf = (i: number): THREE.Vector3 | null =>
      i < count ? positions[i] : (live[i - count]?.pos ?? null);
    const nodeAt = (i: number): BullNode | null =>
      i < count
        ? (i < nodesRef.current.length ? nodesRef.current[i] : null)
        : (live[i - count]?.node ?? null);
    // Screen position of a pickable instance (null if behind the camera).
    const screenPos = (i: number): { x: number; y: number } | null => {
      const wp = posOf(i);
      if (!wp) return null;
      projV.copy(wp).project(camera);
      if (projV.z > 1) return null;
      const rect = container.getBoundingClientRect();
      return { x: rect.left + ((projV.x + 1) / 2) * rect.width, y: rect.top + ((1 - projV.y) / 2) * rect.height };
    };
    // MAGNET pick: exact raycast first, else the nearest DATA/LIVE node within maxPx
    // on screen. The tetrahedra are ~2px — nobody should need pixel-perfect aim, and
    // filler particles (no tweet) are never eligible, so aiming at the swarm always
    // lands on something readable when a real node is nearby.
    const pickNearIdx = (cx: number, cy: number, maxPx: number): number => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(mesh);
      if (hits.length && hits[0].instanceId !== undefined && nodeAt(hits[0].instanceId)) {
        return hits[0].instanceId;
      }
      const nlen = Math.min(nodesRef.current.length, count);
      let best = -1, bd = maxPx * maxPx;
      const consider = (i: number) => {
        const p = screenPos(i);
        if (!p) return;
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (d < bd) { bd = d; best = i; }
      };
      for (let i = 0; i < nlen; i++) consider(i);
      for (let li = 0; li < live.length; li++) consider(count + li);
      return best;
    };
    let lastTouchT = 0;   // browsers fire synthetic mouse events after touch — don't let them clear a tapped tooltip
    const onMove = (e: MouseEvent) => {
      if (performance.now() - lastTouchT < 700) return;
      // STICKY hover: nodes drift — once caught, keep the node while the pointer
      // stays within ~48px of it, instead of re-picking (and flickering) every move.
      if (hoverIdx >= 0 && nodeAt(hoverIdx)) {
        const p = screenPos(hoverIdx);
        if (p && (p.x - e.clientX) ** 2 + (p.y - e.clientY) ** 2 < 48 * 48) {
          onHoverRef.current?.(nodeAt(hoverIdx), e.clientX, e.clientY);
          return;
        }
      }
      const idx = pickNearIdx(e.clientX, e.clientY, 28);
      hoverIdx = idx;
      hoverId = idx >= 0 ? nodeAt(idx)!.id : null;
      container.style.cursor = idx >= 0 ? 'pointer' : 'grab';
      onHoverRef.current?.(idx >= 0 ? nodeAt(idx) : null, e.clientX, e.clientY);
    };
    container.addEventListener('mousemove', onMove);
    // CLICK (not drag) → open the node's detail popup
    let downX = 0, downY = 0;
    const onClickPick = (e: MouseEvent) => {
      if (performance.now() - lastTouchT < 700) return;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) return;  // that was an orbit-drag
      const idx = pickNearIdx(e.clientX, e.clientY, 28);
      if (idx >= 0) onSelectRef.current?.(nodeAt(idx)!);
    };
    container.addEventListener('click', onClickPick);

    // ── Orbit (drag) + fly (wheel) — the swim-through ──
    let baseDist = fitDist(w / h);
    const maxDist = () => Math.max(360, baseDist * 1.35);
    let dragging = false, px = 0, py = 0, rotX = 0, rotY = 0.06, dist = baseDist;
    // Cinematic intro: start deep in space, sweep + fly in to the resting framing.
    // Any user interaction (drag / wheel / touch) cancels it and hands over control.
    const INTRO_MS = 3400;
    let introStart: number | null = performance.now();
    const introFromDist = Math.min(900, baseDist * 4.6);
    const introFromRotX = -1.05;
    dist = introFromDist; rotX = introFromRotX;
    const down = (e: MouseEvent) => { dragging = true; px = e.clientX; py = e.clientY; downX = e.clientX; downY = e.clientY; introStart = null; container.style.cursor = 'grabbing'; };
    const up = () => { dragging = false; };
    const drag = (e: MouseEvent) => {
      if (!dragging) return;
      rotX += (e.clientX - px) * 0.005; rotY += (e.clientY - py) * 0.005;
      rotY = Math.max(-1.3, Math.min(1.3, rotY));
      px = e.clientX; py = e.clientY;
    };
    container.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', drag);
    const wheel = (e: WheelEvent) => { e.preventDefault(); introStart = null; dist = Math.max(22, Math.min(maxDist(), dist + e.deltaY * 0.06)); };
    container.addEventListener('wheel', wheel, { passive: false });
    const onDbl = () => { rotX = 0; rotY = 0.06; dist = baseDist; };   // reset to head-on
    container.addEventListener('dblclick', onDbl);

    // ── Touch: 1-finger orbit · pinch to fly · tap a star to read ──
    let touchMode = 0;                                  // 0 none · 1 orbit · 2 pinch
    let tX = 0, tY = 0, pinchD = 0;
    let tapX = 0, tapY = 0, tapT = 0, tapMoved = false;
    const onTS = (e: TouchEvent) => {
      introStart = null;
      if (e.touches.length === 1) {
        touchMode = 1; tX = e.touches[0].clientX; tY = e.touches[0].clientY;
        tapX = tX; tapY = tY; tapT = performance.now(); tapMoved = false;
      } else if (e.touches.length >= 2) {
        touchMode = 2; tapMoved = true;
        pinchD = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    };
    const onTM = (e: TouchEvent) => {
      e.preventDefault();                               // the canvas owns the gesture — no page scroll/zoom
      if (touchMode === 1 && e.touches.length === 1) {
        const nx = e.touches[0].clientX, ny = e.touches[0].clientY;
        rotX += (nx - tX) * 0.006; rotY += (ny - tY) * 0.006;
        rotY = Math.max(-1.3, Math.min(1.3, rotY));
        if (Math.abs(nx - tapX) + Math.abs(ny - tapY) > 12) tapMoved = true;
        tX = nx; tY = ny;
      } else if (touchMode === 2 && e.touches.length >= 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinchD > 0 && d > 0) dist = Math.max(22, Math.min(maxDist(), dist * (pinchD / d)));
        pinchD = d;
      }
    };
    const onTE = (e: TouchEvent) => {
      lastTouchT = performance.now();
      // a quick, still touch = a TAP → read the node (or clear the tooltip on empty space)
      if (touchMode === 1 && !tapMoved && performance.now() - tapT < 650) {
        const idx = pickNearIdx(tapX, tapY, 44);        // finger-sized magnet radius
        hoverIdx = idx;
        hoverId = idx >= 0 ? nodeAt(idx)!.id : null;    // pauses the auto-rotate while reading
        if (idx >= 0) onSelectRef.current?.(nodeAt(idx)!);          // tap → detail popup
        else onHoverRef.current?.(null, tapX, tapY);                // tap empty space → dismiss
      }
      if (e.touches.length === 0) touchMode = 0;
      else if (e.touches.length === 1) { touchMode = 1; tX = e.touches[0].clientX; tY = e.touches[0].clientY; tapMoved = true; }
    };
    container.addEventListener('touchstart', onTS, { passive: true });
    container.addEventListener('touchmove', onTM, { passive: false });
    container.addEventListener('touchend', onTE);

    const lookAt = new THREE.Vector3(0, 6, 0);    // centre on the bull's real centroid
    let raf = 0;
    let autoRot = 0, lastFrameT = 0;              // accumulated idle rotation (see animate)
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const now = performance.now();          // wall-clock for intro + live-node flights
      const nlen = nodesRef.current.length;
      const hl = highlightRef.current;
      const hasHl = hl.size > 0;
      // Auto-rotate is ACCUMULATED per-frame (not derived from absolute elapsed time) —
      // deriving it from `t` made the whole frame SNAP whenever hovering paused/resumed
      // the drift, because the pending `t × rate` term appeared/vanished all at once.
      const dt = Math.min(0.1, Math.max(0, t - lastFrameT)); lastFrameT = t;
      if (!dragging && hoverId === null) autoRot += dt * 0.012;

      for (let i = 0; i < count; i++) {
        const hm = home[i];
        const a = driftAmp[i], ph = driftPhase[i], sp = driftSpeed[i];
        // float around the pinned bull position — small, so the shape holds
        target.set(
          hm.x + Math.sin(t * sp + ph) * a,
          hm.y + Math.cos(t * sp * 0.9 + ph) * a,
          hm.z + Math.sin(t * sp * 1.1 + ph * 1.7) * a,
        );
        positions[i].lerp(target, 0.08);
        dummy.position.copy(positions[i]);
        const node = i < nlen ? nodesRef.current[i] : null;
        const isHl = node ? (hasHl && hl.has(node.id)) : false;
        const isHover = node ? node.id === hoverId : false;
        // data nodes render bigger than filler so what you aim at IS a readable tweet
        const s = (i < 2 ? 2.4 : node ? 1.35 : 0.85) * (isHl ? 2.6 : isHover ? 2.2 : 1);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // colour — green field; brighter with likes; recalled pulse cyan-white
        const tw = 0.6 + 0.4 * Math.sin(t * 1.6 + ph * 3);
        let bright = baseBright[i] * (0.6 + 0.4 * tw);
        if (isHl) { col.setHSL(0.44, 1, Math.min(1, 0.6 + 0.4 * tw)); }
        else if (isHover) { col.setHSL(0.4, 0.8, 0.85); }
        else {
          if (hasHl) bright *= 0.25;          // dim the field when something's recalled
          col.setHSL(0.4 - baseBright[i] * 0.06, 0.95, Math.min(0.9, 0.12 + bright * 0.7));
        }
        mesh.setColorAt(i, col);
      }

      // ── LIVE nodes: shiny fly-in from outside the frame → settle into the swarm ──
      for (let li = 0; li < live.length; li++) {
        const L = live[li];
        const k = Math.min(1, (now - L.born) / FLIGHT_MS);
        const ease = 1 - Math.pow(1 - k, 3);            // fast entry, gentle landing
        const flight = 1 - ease;                        // 1 → 0 as it settles
        target.set(                                     // settled = gentle drift around home
          L.home.x + Math.sin(t * 0.5 + L.ph) * 1.6,
          L.home.y + Math.cos(t * 0.45 + L.ph) * 1.6,
          L.home.z + Math.sin(t * 0.55 + L.ph * 1.7) * 1.6,
        );
        L.pos.lerpVectors(L.spawn, target, ease);
        const idx = count + li;
        const isHover = L.node.id === hoverId;
        dummy.position.copy(L.pos);
        dummy.scale.setScalar((1.5 + flight * 1.8) * (isHover ? 1.8 : 1));
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        const tw = 0.6 + 0.4 * Math.sin(t * 2.4 + L.ph * 3);
        // shiny: near-white streak during flight, settles into a bright green star
        col.setHSL(0.42 - flight * 0.07, 1, Math.min(1, 0.42 + flight * 0.5 + tw * 0.16));
        mesh.setColorAt(idx, col);
      }
      mesh.count = count + live.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // ── Cinematic intro: fly in from deep space, sweeping around to head-on ──
      if (introStart !== null) {
        const k = Math.min(1, (now - introStart) / INTRO_MS);
        const e = 1 - Math.pow(1 - k, 3);               // easeOutCubic
        dist = introFromDist + (baseDist - introFromDist) * e;
        rotX = introFromRotX * (1 - e);
        if (k >= 1) introStart = null;
      }

      const rx = rotX + autoRot;
      camera.position.set(
        lookAt.x + Math.sin(rx) * Math.cos(rotY) * dist,
        lookAt.y + Math.sin(rotY) * dist,
        lookAt.z + Math.cos(rx) * Math.cos(rotY) * dist,
      );
      camera.lookAt(lookAt);
      composer.render();
    };
    // start facing the bull, mid distance
    camera.position.set(0, -4, dist);
    animate();

    const onResize = () => {
      const cw = container.clientWidth, ch = container.clientHeight;
      if (cw < 2 || ch < 2) return;
      camera.aspect = cw / ch; camera.updateProjectionMatrix();
      renderer.setSize(cw, ch); composer.setSize(cw, ch);
      // re-fit: keep the user's relative zoom but anchor it to the new aspect's base
      const nb = fitDist(cw / ch);
      if (nb !== baseDist) { dist = Math.max(22, Math.min(maxDist(), dist * (nb / baseDist))); baseDist = nb; }
    };
    window.addEventListener('resize', onResize);
    // ResizeObserver + deferred re-fits catch the post-mount layout settle — the canvas
    // can mount before the container reaches full size, else the swarm renders small.
    const ro = new ResizeObserver(() => onResize());
    ro.observe(container);
    const rf1 = window.setTimeout(onResize, 120);
    const rf2 = window.setTimeout(onResize, 500);

    engineRef.current = {
      cleanup: () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(rf1); window.clearTimeout(rf2); ro.disconnect();
        window.removeEventListener('resize', onResize);
        container.removeEventListener('mousemove', onMove);
        container.removeEventListener('mousedown', down);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('mousemove', drag);
        container.removeEventListener('wheel', wheel as any);
        container.removeEventListener('dblclick', onDbl);
        container.removeEventListener('touchstart', onTS);
        container.removeEventListener('touchmove', onTM as any);
        container.removeEventListener('touchend', onTE);
        container.removeEventListener('click', onClickPick);
        window.clearInterval(feedIv);
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      },
    };
    return () => { engineRef.current?.cleanup(); engineRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none' }} />;
}
