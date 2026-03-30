/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface GraphNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay: number;
  valence: number;
  accessCount: number;
  source: string;
  createdAt: string;
}

// Type → hue mapping for particle colors
const TYPE_HUE: Record<string, number> = {
  episodic: 0.6,
  semantic: 0.42,
  procedural: 0.12,
  self_model: 0.75,
};

const TYPE_HUE_ACTIVE: Record<string, number> = {
  episodic: 0.62,
  semantic: 0.4,
  procedural: 0.1,
  self_model: 0.78,
};

interface Props {
  nodes: GraphNode[];
  highlightedIds: Set<number>;
  selectedId: number | null;
  focusNodeId: number | null;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

export function MemoryGraph3D({ nodes, highlightedIds, selectedId, focusNodeId, onNodeClick, onBackgroundClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const swarmRef = useRef<any>(null);
  const nodesRef = useRef<GraphNode[]>(nodes);
  const highlightRef = useRef<Set<number>>(highlightedIds);
  const selectedRef = useRef<number | null>(selectedId);
  const prevSelectedRef = useRef<number | null>(null);

  nodesRef.current = nodes;
  highlightRef.current = highlightedIds;
  selectedRef.current = selectedId;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || swarmRef.current) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    // ── Scene — exact same as reference ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.01);
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // ── Post processing — exact same as reference ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
    bloomPass.strength = 1.8;
    bloomPass.radius = 0.4;
    bloomPass.threshold = 0;
    composer.addPass(bloomPass);

    // ── Instanced mesh — 20k particles like reference ──
    const PARTICLE_COUNT = 20000;
    const count = PARTICLE_COUNT;
    const geometry = new THREE.TetrahedronGeometry(0.25);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    const positions: THREE.Vector3[] = [];
    const dummy = new THREE.Object3D();
    const targetVec = new THREE.Vector3();
    const pColor = new THREE.Color();
    const clock = new THREE.Clock();

    for (let i = 0; i < count; i++) {
      positions.push(new THREE.Vector3(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
      ));
      mesh.setColorAt(i, pColor.setHex(0x00ff88));
    }

    // ── Raycaster for hover + click ──
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(mesh);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const idx = hits[0].instanceId;
        const currentNodes = nodesRef.current;
        if (idx < currentNodes.length) {
          onNodeClick(currentNodes[idx]);
          return;
        }
      }
      onBackgroundClick();
    };
    container.addEventListener('click', handleClick);


    // ── Mouse drag rotates the whole scene ──
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let userRotX = 0; // horizontal drag rotation
    let userRotY = 0; // vertical drag rotation

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };
    const onMouseUp = () => { isDragging = false; };
    const onMouseDrag = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      userRotX += dx * 0.005;
      userRotY += dy * 0.003;
      userRotY = Math.max(-1.2, Math.min(1.2, userRotY)); // clamp vertical
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };
    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseDrag);

    // Scroll to zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const newZ = camera.position.z + e.deltaY * 0.05;
      camera.position.z = Math.max(30, Math.min(300, newZ));
    }, { passive: false });

    // ── Camera follow state ──
    let followIndex = -1;
    let followLookAt = new THREE.Vector3(0, 0, 0);
    let followTargetDist = 100;
    let followCurrentDist = 100;

    // ── Animation — matches reference exactly ──
    const PARAMS = { scale: 70, flow: 0.6, complexity: 3, tension: 25 };
    let animId = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      const nodeCount = nodesRef.current.length;
      const hl = highlightRef.current;
      const sel = selectedRef.current;

      mesh.count = PARTICLE_COUNT;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const node = i < nodeCount ? nodesRef.current[i] : null;

        // ── Particle position — identical to reference ──
        const t = time * PARAMS.flow;
        const normalized = i / PARTICLE_COUNT;
        const p = 3;
        const q = Math.floor(PARAMS.complexity) + 0.01;
        const phi = normalized * Math.PI * 2 * 60;
        const r = PARAMS.scale + PARAMS.tension * Math.cos(q * phi + t * 0.5);

        const x = r * Math.cos(p * phi) * (1 + 0.05 * Math.sin(t + normalized * 50));
        const y = r * Math.sin(p * phi) * (1 + 0.05 * Math.cos(t + normalized * 50));
        const z = PARAMS.tension * Math.sin(q * phi + t * 0.5) + Math.sin(phi * 8) * 8;

        const rotY = t * 0.15;
        const finalX = x * Math.cos(rotY) - z * Math.sin(rotY);
        const finalZ = x * Math.sin(rotY) + z * Math.cos(rotY);

        const tilt = 0.3;
        const tiltY = y * Math.cos(tilt) - finalZ * Math.sin(tilt);
        const tiltZ = y * Math.sin(tilt) + finalZ * Math.cos(tilt);

        targetVec.set(finalX, tiltY, tiltZ);

        // ── Color — reference default + memory type overlay ──
        const dataPacket = Math.pow(Math.abs(Math.sin(phi * 4 - t * 2)), 20);

        if (node) {
          const isSelected = node.id === sel;
          const isHighlighted = hl.size > 0 && hl.has(node.id);
          const hasFocus = sel !== null || hl.size > 0;
          const isDimmed = hasFocus && !isHighlighted && !isSelected;

          if (isSelected) {
            // Focused node — full bright glow
            const hue = TYPE_HUE_ACTIVE[node.type] ?? 0.42;
            pColor.setHSL(hue, 1.0, 0.55 + dataPacket * 0.4);
          } else if (isHighlighted && sel !== null) {
            // Sibling mentions — visible but dimmer than focused
            const hue = TYPE_HUE[node.type] ?? 0.42;
            pColor.setHSL(hue, 0.7, 0.2 + dataPacket * 0.25);
          } else if (isHighlighted) {
            // Highlighted without a specific selection
            const hue = TYPE_HUE_ACTIVE[node.type] ?? 0.42;
            pColor.setHSL(hue, 0.95, 0.4 + dataPacket * 0.5);
          } else if (isDimmed) {
            pColor.setHSL(0, 0, 0.08 + dataPacket * 0.05);
          } else {
            const hue = 0.58 + Math.sin(normalized * Math.PI * 4) * 0.05;
            const lightness = 0.25 + dataPacket * 0.65;
            pColor.setHSL(hue, 0.9, lightness);
          }
        } else {
          // Filler particles — also dim when focused
          const hasFocus = sel !== null || hl.size > 0;
          if (hasFocus) {
            pColor.setHSL(0, 0, 0.05 + Math.pow(Math.abs(Math.sin(phi * 4 - time * PARAMS.flow * 2)), 20) * 0.03);
          } else {
            const hue = 0.58 + Math.sin(normalized * Math.PI * 4) * 0.05;
            pColor.setHSL(hue, 0.9, 0.25 + dataPacket * 0.65);
          }
        }

        // ── Update — identical to reference ──
        positions[i].lerp(targetVec, 0.1);
        dummy.position.copy(positions[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, pColor);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // ── Camera: follow selected node or stay at origin ──
      if (followIndex >= 0 && followIndex < PARTICLE_COUNT && positions[followIndex]) {
        followLookAt.lerp(positions[followIndex], 0.08);
      } else {
        followLookAt.lerp(new THREE.Vector3(0, 0, 0), 0.05);
      }
      followCurrentDist += (followTargetDist - followCurrentDist) * 0.05;

      // Apply user drag rotation on top of the fixed camera distance
      camera.position.x = followLookAt.x + Math.sin(userRotX) * Math.cos(userRotY) * followCurrentDist;
      camera.position.y = followLookAt.y + Math.sin(userRotY) * followCurrentDist;
      camera.position.z = followLookAt.z + Math.cos(userRotX) * Math.cos(userRotY) * followCurrentDist;
      camera.lookAt(followLookAt);

      composer.render();
    };
    animate();

    // ── Resize ──
    const handleResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
      composer.setSize(cw, ch);
    };
    window.addEventListener('resize', handleResize);

    swarmRef.current = {
      animId,
      setFollowIndex: (idx: number) => { followIndex = idx; },
      setFollowDist: (d: number) => { followTargetDist = d; },
      cleanup: () => {
        window.removeEventListener('resize', handleResize);
        container.removeEventListener('click', handleClick);
        container.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('mousemove', onMouseDrag);
        cancelAnimationFrame(animId);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      },
    };

    return () => {
      if (swarmRef.current) {
        swarmRef.current.cleanup();
        swarmRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update mesh count when nodes change
  useEffect(() => {
    if (!swarmRef.current) return;
    // mesh count is set each frame from nodesRef.current.length
  }, [nodes]);

  // Zoom to selected node / zoom out on deselect
  useEffect(() => {
    if (!swarmRef.current) return;
    const s = swarmRef.current;

    if (selectedId !== null) {
      const idx = nodes.findIndex(n => n.id === selectedId);
      if (idx >= 0) {
        s.setFollowIndex(idx);
        s.setFollowDist(40);
      }
    } else if (prevSelectedRef.current !== null) {
      s.setFollowIndex(-1);
      s.setFollowDist(100);
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId, nodes]);

  // Zoom to focused node (chat mention click)
  useEffect(() => {
    if (!swarmRef.current || !focusNodeId) return;
    const s = swarmRef.current;
    const idx = nodes.findIndex(n => n.id === focusNodeId);
    if (idx >= 0) {
      s.setFollowIndex(idx);
      s.setFollowDist(35);
    }
  }, [focusNodeId, nodes]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    />
  );
}
