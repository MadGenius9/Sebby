import * as THREE from "three";
import { type SceneDocument, validateScene } from "./model";
export function buildGroup(doc: SceneDocument, explode = 0): THREE.Group {
  const group = new THREE.Group();
  group.name = doc.name;
  const scene = validateScene(doc);
  const center = new THREE.Vector3();
  scene.parts.forEach((p) => center.add(new THREE.Vector3(...p.position)));
  if (scene.parts.length) center.divideScalar(scene.parts.length);
  for (const p of scene.parts) {
    const geometry =
      p.shape === "sphere"
        ? new THREE.SphereGeometry(0.5, 24, 16)
        : p.shape === "cylinder"
          ? new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
          : p.shape === "cone"
            ? new THREE.ConeGeometry(0.5, 1, 24)
            : p.shape === "torus"
              ? new THREE.TorusGeometry(0.35, 0.15, 12, 32)
              : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: p.color,
        metalness: p.metalness,
        roughness: p.roughness,
      }),
    );
    mesh.name = p.name;
    mesh.userData.partId = p.id;
    mesh.position.set(...p.position);
    if (explode) {
      const direction = mesh.position.clone().sub(center);
      if (direction.lengthSq() < 0.001) direction.set(0, 1, 0);
      mesh.position.addScaledVector(direction.normalize(), explode);
    }
    mesh.rotation.set(
      ...(p.rotation.map((x) => THREE.MathUtils.degToRad(x)) as [
        number,
        number,
        number,
      ]),
    );
    mesh.scale.set(...p.size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
export function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
}
