import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGroup, disposeGroup } from "./scene";
import type { SceneDocument } from "./model";
import { saveStudioFile } from "./export";
export function Viewport({
  scene,
  selected,
  explode,
  onSelect,
  report,
}: {
  scene: SceneDocument;
  selected: string;
  explode: number;
  onSelect: (id: string) => void;
  report: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      group: THREE.Group;
      selection: THREE.BoxHelper | null;
    } | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [error, setError] = useState("");
  function fit() {
    const s = state.current;
    if (!s) return;
    const box = new THREE.Box3().setFromObject(s.group),
      center = new THREE.Vector3(0, 1, 0),
      size = new THREE.Vector3(4, 4, 4);
    if (!box.isEmpty()) {
      box.getCenter(center);
      box.getSize(size);
    }
    const distance = Math.max(4, size.length() * 1.25);
    s.controls.target.copy(center);
    s.camera.position
      .copy(center)
      .add(
        new THREE.Vector3(0.8, 0.65, 1).normalize().multiplyScalar(distance),
      );
    s.camera.far = Math.max(1000, distance * 10);
    s.camera.updateProjectionMatrix();
    s.controls.update();
  }
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError(
        "3D rendering needs WebGL. The object editor and JSON export still work.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    const world = new THREE.Scene();
    world.background = new THREE.Color("#0b1522");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 1000),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    world.add(new THREE.HemisphereLight(0xd3edff, 0x263449, 2));
    const key = new THREE.DirectionalLight(0xffeed9, 3);
    key.position.set(7, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
    });
    world.add(key);
    const fill = new THREE.DirectionalLight(0x77bbff, 2);
    fill.position.set(-8, 6, -5);
    world.add(fill);
    const grid = new THREE.GridHelper(40, 40, 0x35546a, 0x1a2e40);
    grid.position.y = -0.22;
    world.add(grid);
    const group = new THREE.Group();
    world.add(group);
    state.current = {
      renderer,
      scene: world,
      camera,
      controls,
      group,
      selection: null,
    };
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D scene. Drag to orbit, scroll to zoom. Select objects in the list for keyboard editing.",
    );
    el.appendChild(renderer.domElement);
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let down: [number, number] = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pointerUp = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
      )
        return;
      const r = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(state.current?.group.children || [])[0];
      if (hit) select.current(String(hit.object.userData.partId));
    };
    const lost = (e: Event) => {
      e.preventDefault();
      renderer.setAnimationLoop(null);
      setError(
        "The graphics context was lost. Reopen Studio to restore the viewport; your scene data is retained.",
      );
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(world, camera);
    });
    fit();
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      disposeGroup(world);
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);
  const first = useRef(true);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.scene.remove(s.group);
    disposeGroup(s.group);
    s.group = buildGroup(scene, explode);
    s.scene.add(s.group);
    if (first.current) {
      fit();
      first.current = false;
    }
  }, [scene, explode]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (s.selection) {
      s.scene.remove(s.selection);
      disposeGroup(s.selection);
      s.selection = null;
    }
    const obj = s.group.children.find((o) => o.userData.partId === selected);
    if (obj) {
      s.selection = new THREE.BoxHelper(obj, 0xa2eeff);
      s.scene.add(s.selection);
    }
  }, [scene, selected, explode]);
  return (
    <div className="studio-stage-wrap">
      <div className="studio-stage" ref={host} />
      {error && (
        <p role="alert" className="banner">
          {error}
        </p>
      )}
      <div className="studio-view-tools">
        <span>REALTIME VIEW · meters</span>
        <button onClick={fit}>Frame scene</button>
        <button
          disabled={!!error}
          onClick={async () => {
            try {
              const s = state.current;
              if (!s) throw Error("Viewport unavailable.");
              s.renderer.render(s.scene, s.camera);
              const blob = await new Promise<Blob>((resolve, reject) =>
                s.renderer.domElement.toBlob(
                  (b) => (b ? resolve(b) : reject(Error("Snapshot failed."))),
                  "image/png",
                ),
              );
              const result = await saveStudioFile(
                "png",
                new Uint8Array(await blob.arrayBuffer()),
              );
              report(
                result.saved ? "PNG export requested." : "Export cancelled.",
              );
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          Export PNG
        </button>
      </div>
    </div>
  );
}
