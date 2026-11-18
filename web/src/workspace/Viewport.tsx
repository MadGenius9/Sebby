import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { SceneObject } from "./api";
import { download } from "./api";
import { objectMesh } from "./scene-model";
export type TransformMode = "translate" | "rotate" | "scale";
function disposeObjects(root: THREE.Object3D) {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
      node.geometry.dispose();
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(
        (m) => m.dispose(),
      );
    }
  });
}
export async function exportGlb(objects: SceneObject[]) {
  const root = new THREE.Group();
  objects.forEach((o) => root.add(objectMesh(o)));
  try {
    const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
    if (!(buffer instanceof ArrayBuffer)) throw new Error("GLB export failed");
    download("sebby-scene.glb", buffer, "model/gltf-binary");
  } finally {
    disposeObjects(root);
  }
}
type Props = {
  objects: SceneObject[];
  selectedId: string | null;
  select: (id: string | null) => void;
  mode: TransformMode;
  snap: boolean;
  commit: (
    id: string,
    patch: Pick<SceneObject, "position" | "rotation" | "scale">,
  ) => void;
  selectFace: (index: number) => void;
  selectedFace: number;
};
export function Viewport(props: Props) {
  const { objects, selectedId, mode, snap, selectedFace } = props;
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const world = useRef<{
    content: THREE.Group;
    scene: THREE.Scene;
    transform: TransformControls;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "3D rendering is unavailable. Enable WebGL to use the viewport. Your scene can still be saved.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x181c23);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "3D scene viewport");
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(6, 5, 7);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.5, 0);
    orbit.enableDamping = true;
    const content = new THREE.Group();
    scene.add(content);
    scene.add(new THREE.HemisphereLight(0xd9ecff, 0x30343c, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 8, 5);
    scene.add(light);
    scene.add(new THREE.GridHelper(20, 20, 0x536374, 0x303944));
    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    world.current = { content, scene, transform };
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
    });
    transform.addEventListener("mouseUp", () => {
      const mesh = transform.object;
      if (!mesh) return;
      const bound = (n: number, min: number, max: number) =>
        Math.max(min, Math.min(max, n));
      const position = mesh.position
        .toArray()
        .map((n) => bound(n, -10000, 10000)) as [number, number, number];
      const rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(
        (n) => bound(THREE.MathUtils.radToDeg(n), -10000, 10000),
      ) as [number, number, number];
      const scale = mesh.scale.toArray().map((n) => bound(n, 0.01, 1000)) as [
        number,
        number,
        number,
      ];
      const current = latest.current.objects.find(
        (o) => o.id === mesh.userData.objectId,
      );
      if (
        current &&
        JSON.stringify([current.position, current.rotation, current.scale]) !==
          JSON.stringify([position, rotation, scale])
      )
        latest.current.commit(current.id, { position, rotation, scale });
    });
    const resize = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      if (w && h) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    });
    resize.observe(container);
    const raycaster = new THREE.Raycaster();
    let down = { x: 0, y: 0, gizmo: false };
    const pointerDown = (event: PointerEvent) => {
      down = {
        x: event.clientX,
        y: event.clientY,
        gizmo: !!transform.axis || transform.dragging,
      };
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        down.gizmo ||
        event.button !== 0 ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
      )
        return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - r.left) / r.width) * 2 - 1,
          (-(event.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(
        content.children.filter((n) => n instanceof THREE.Mesh),
        false,
      )[0];
      latest.current.select(hit?.object.userData.objectId ?? null);
      if (
        hit &&
        hit.faceIndex !== undefined &&
        hit.faceIndex !== null &&
        hit.object instanceof THREE.Mesh
      ) {
        const index = hit.object.geometry.userData.faceMap?.[hit.faceIndex];
        if (index !== undefined) latest.current.selectFace(index);
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.setAnimationLoop(() => {
      orbit.update();
      for (const item of content.children)
        if (item instanceof THREE.BoxHelper) item.update();
      renderer.render(scene, camera);
    });
    const lost = (event: Event) => {
      event.preventDefault();
      setError(
        "The 3D graphics context was lost. Save and reload to restore the viewport.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      resize.disconnect();
      orbit.dispose();
      transform.detach();
      scene.remove(transform.getHelper());
      transform.dispose();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      disposeObjects(scene);
      renderer.dispose();
      renderer.domElement.remove();
      world.current = null;
    };
  }, []);
  useEffect(() => {
    const state = world.current;
    if (!state) return;
    state.transform.detach();
    disposeObjects(state.content);
    state.content.clear();
    for (const object of objects) {
      const mesh = objectMesh(object);
      state.content.add(mesh);
      if (object.id === selectedId) {
        if (object.kind === "mesh") {
          const face = object.mesh.faces[selectedFace];
          if (face) {
            const positions: number[] = [];
            for (let i = 1; i < face.length - 1; i++)
              for (const index of [face[0], face[i], face[i + 1]])
                positions.push(...object.mesh.vertices[index]);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(positions, 3),
            );
            const overlay = new THREE.Mesh(
              geometry,
              new THREE.MeshBasicMaterial({
                color: 0xffbb66,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.4,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
              }),
            );
            mesh.add(overlay);
          }
        }
        state.content.add(new THREE.BoxHelper(mesh, 0x83ceff));
        state.transform.attach(mesh);
      }
    }
  }, [objects, selectedId, selectedFace]);
  useEffect(() => {
    const t = world.current?.transform;
    if (!t) return;
    t.setMode(mode);
    t.setTranslationSnap(snap ? 0.25 : null);
    t.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    t.setScaleSnap(snap ? 0.1 : null);
  }, [mode, snap]);
  return (
    <div className="studio-viewport" ref={host}>
      {error && (
        <p role="alert" className="viewport-error">
          {error}
        </p>
      )}
      <span className="viewport-help">
        Drag to orbit · Drag gizmo to transform · Click mesh face to select
      </span>
    </div>
  );
}
