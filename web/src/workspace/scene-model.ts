import * as THREE from "three";
import type { SceneObject } from "@shared/workspace/schema";
export function objectGeometry(object: SceneObject): THREE.BufferGeometry {
  if (object.kind === "mesh") {
    const geometry = new THREE.BufferGeometry(),
      positions: number[] = [],
      faceMap: number[] = [];
    object.mesh.faces.forEach((face, index) => {
      for (let i = 1; i < face.length - 1; i++) {
        for (const vertex of [face[0], face[i], face[i + 1]])
          positions.push(...object.mesh.vertices[vertex]);
        faceMap.push(index);
      }
    });
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.faceMap = faceMap;
    return geometry;
  }
  if (object.kind === "sphere") return new THREE.SphereGeometry(0.5, 32, 24);
  if (object.kind === "cylinder")
    return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  return new THREE.BoxGeometry(1, 1, 1);
}
export function objectMesh(object: SceneObject) {
  const mesh = new THREE.Mesh(
    objectGeometry(object),
    new THREE.MeshStandardMaterial({
      color: object.color,
      roughness: 0.45,
      metalness: 0.15,
    }),
  );
  mesh.name = object.name;
  mesh.userData.objectId = object.id;
  mesh.position.fromArray(object.position);
  mesh.rotation.set(
    ...(object.rotation.map(THREE.MathUtils.degToRad) as [
      number,
      number,
      number,
    ]),
  );
  mesh.scale.fromArray(object.scale);
  return mesh;
}
