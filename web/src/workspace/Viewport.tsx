import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { SceneObject } from './api';
import { download } from './api';

function geometry(kind: SceneObject['kind']) {
  if (kind === 'sphere') return new THREE.SphereGeometry(0.5, 32, 24);
  if (kind === 'cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  return new THREE.BoxGeometry(1, 1, 1);
}
function objectMesh(o: SceneObject) {
  const mesh = new THREE.Mesh(geometry(o.kind), new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.45, metalness: 0.15 }));
  mesh.name = o.name; mesh.userData.objectId = o.id;
  mesh.position.fromArray(o.position);
  mesh.rotation.set(...o.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
  mesh.scale.fromArray(o.scale);
  return mesh;
}
function disposeObjects(root: THREE.Object3D) {
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(m => m.dispose());
    }
  });
}
export async function exportGlb(objects: SceneObject[]) {
  const root = new THREE.Group(); objects.forEach(o => root.add(objectMesh(o)));
  try {
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
    if (!(buffer instanceof ArrayBuffer)) throw new Error('GLB export failed');
    download('sebby-scene.glb', buffer, 'model/gltf-binary');
  } finally { disposeObjects(root); }
}
export function Viewport({ objects, selectedId, select }: { objects: SceneObject[]; selectedId: string | null; select: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ scene: THREE.Scene; content: THREE.Group; renderer: THREE.WebGLRenderer } | null>(null);
  const selectRef = useRef(select); selectRef.current = select;
  const [error, setError] = useState('');
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError('3D rendering is unavailable. Enable WebGL to use the viewport. Your scene can still be saved.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x181c23); container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D scene viewport');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000); camera.position.set(6, 5, 7);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.5, 0); controls.enableDamping = true;
    const content = new THREE.Group(); scene.add(content);
    scene.add(new THREE.HemisphereLight(0xd9ecff, 0x30343c, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(4, 8, 5); scene.add(light);
    scene.add(new THREE.GridHelper(20, 20, 0x536374, 0x303944));
    world.current = { scene, content, renderer };
    const resize = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }); resize.observe(container);
    const raycaster = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1, -(event.clientY-r.top)/r.height*2+1), camera);
      const hit = raycaster.intersectObjects(content.children, false)[0];
      selectRef.current(hit?.object.userData.objectId ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    const contextLost = (event: Event) => { event.preventDefault(); setError('The 3D graphics context was lost. Save your project and reload to restore the viewport.'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    return () => {
      resize.disconnect(); controls.dispose(); renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeObjects(scene); renderer.dispose(); renderer.domElement.remove(); world.current = null;
    };
  }, []);
  useEffect(() => {
    const state = world.current; if (!state) return;
    disposeObjects(state.content); state.content.clear();
    for (const o of objects) {
      const mesh = objectMesh(o); state.content.add(mesh);
      if (o.id === selectedId) {
        const outline = new THREE.BoxHelper(mesh, 0x83ceff); state.content.add(outline);
      }
    }
  }, [objects, selectedId]);
  return <div className="studio-viewport" ref={host}>{error && <p role="alert" className="viewport-error">{error}</p>}<span className="viewport-help">Drag to orbit · Scroll to zoom · Click to select</span></div>;
}
