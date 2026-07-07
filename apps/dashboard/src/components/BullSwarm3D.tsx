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

export interface BullNode {
  id: number;
  content?: string;
  likes?: number;
}

interface Props {
  nodes: BullNode[];
  highlightIds: Set<number>;
  onHover?: (node: BullNode | null, x: number, y: number) => void;
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

export function BullSwarm3D({ nodes, highlightIds, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);
  const nodesRef = useRef<BullNode[]>(nodes);
  const highlightRef = useRef<Set<number>>(highlightIds);
  nodesRef.current = nodes;
  highlightRef.current = highlightIds;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || engineRef.current) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 2 || h < 2) return;

    // ── Scene / camera / renderer ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.0022);
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 3000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.6, 0.5, 0.2);
    bloom.strength = 1.55; bloom.radius = 0.55; bloom.threshold = 0.06;
    composer.addPass(bloom);

    const mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      PARTICLE_COUNT,
    );
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
    const driftAmp = new Float32Array(PARTICLE_COUNT);
    const driftPhase = new Float32Array(PARTICLE_COUNT);
    const driftSpeed = new Float32Array(PARTICLE_COUNT);
    const baseBright = new Float32Array(PARTICLE_COUNT);

    let rndS = 20240707;
    const rnd = () => ((rndS = (rndS * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
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

    // ── Hover + click via raycaster (only the first nodes.length map to real memories) ──
    const raycaster = new THREE.Raycaster();
    raycaster.params.Mesh = { threshold: 0 } as any;
    const mouse = new THREE.Vector2();
    let hoverId: number | null = null;
    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(mesh);
      const nlen = nodesRef.current.length;
      let node: BullNode | null = null;
      if (hits.length && hits[0].instanceId !== undefined && hits[0].instanceId < nlen) {
        node = nodesRef.current[hits[0].instanceId];
      }
      hoverId = node ? node.id : null;
      container.style.cursor = node ? 'pointer' : 'grab';
      onHover?.(node, e.clientX, e.clientY);
    };
    container.addEventListener('mousemove', onMove);

    // ── Orbit (drag) + fly (wheel) — the swim-through ──
    let dragging = false, px = 0, py = 0, rotX = 0, rotY = 0.06, dist = 96;
    const down = (e: MouseEvent) => { dragging = true; px = e.clientX; py = e.clientY; container.style.cursor = 'grabbing'; };
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
    const wheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.max(22, Math.min(360, dist + e.deltaY * 0.06)); };
    container.addEventListener('wheel', wheel, { passive: false });
    const onDbl = () => { rotX = 0; rotY = 0.06; dist = 96; };   // reset to head-on
    container.addEventListener('dblclick', onDbl);

    const lookAt = new THREE.Vector3(0, 6, 0);    // centre on the bull's real centroid
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const nlen = nodesRef.current.length;
      const hl = highlightRef.current;
      const hasHl = hl.size > 0;
      const auto = (dragging || hoverId !== null) ? 0 : 0.012;   // pause the drift while dragging or reading a node

      for (let i = 0; i < PARTICLE_COUNT; i++) {
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
        const s = (i < 2 ? 2.4 : 1) * (isHl ? 2.6 : isHover ? 2.2 : 1);
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
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      const rx = rotX + t * auto;
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
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      },
    };
    return () => { engineRef.current?.cleanup(); engineRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, cursor: 'grab' }} />;
}
