// Small polygon operations shared by server validation and browser tools.
export type Vec3 = [number, number, number];
export type PolygonMesh = { vertices: Vec3[]; faces: number[][] };
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n - b[i]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a.reduce((n, x, i) => n + x * b[i], 0);
export function faceNormal(mesh: PolygonMesh, index: number): Vec3 {
  const face = mesh.faces[index];
  if (!face || face.length < 3) throw new Error("Select a valid polygon face");
  const normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const a = mesh.vertices[face[i]],
      b = mesh.vertices[face[(i + 1) % face.length]];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(...normal);
  if (length < 1e-8) throw new Error("Face has no measurable area");
  return normal.map((n) => n / length) as Vec3;
}
export function validateMesh(mesh: PolygonMesh): string | null {
  if (
    !mesh.vertices.length ||
    mesh.vertices.length > 2048 ||
    !mesh.faces.length ||
    mesh.faces.length > 2048
  )
    return "Meshes require 1–2048 vertices and faces";
  if (
    mesh.vertices.some(
      (v) =>
        v.length !== 3 ||
        v.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000),
    )
  )
    return "Mesh vertices exceed coordinate limits";
  for (let i = 0; i < mesh.faces.length; i++) {
    const f = mesh.faces[i];
    if (
      f.length < 3 ||
      f.length > 16 ||
      new Set(f).size !== f.length ||
      f.some((n) => !Number.isInteger(n) || n < 0 || n >= mesh.vertices.length)
    )
      return "Face indices are invalid";
    try {
      const normal = faceNormal(mesh, i),
        origin = mesh.vertices[f[0]];
      if (
        f.some(
          (n) => Math.abs(dot(sub(mesh.vertices[n], origin), normal)) > 1e-5,
        )
      )
        return "Faces must be planar";
      // Convex polygon faces are triangulated as a fan. Refuse concave/reversed turns.
      for (let j = 0; j < f.length; j++) {
        const a = mesh.vertices[f[j]],
          b = mesh.vertices[f[(j + 1) % f.length]],
          c = mesh.vertices[f[(j + 2) % f.length]];
        if (dot(cross(sub(b, a), sub(c, b)), normal) <= 1e-9)
          return "Faces must be convex without collinear edges";
      }
    } catch {
      return "Face has no measurable area";
    }
  }
  return null;
}
function checked(mesh: PolygonMesh) {
  const error = validateMesh(mesh);
  if (error) throw new Error(error);
  return mesh;
}
export function boxMesh(): PolygonMesh {
  return {
    vertices: [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ],
    faces: [
      [3, 2, 1, 0],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [7, 6, 2, 3],
      [0, 4, 7, 3],
      [5, 1, 2, 6],
    ],
  };
}
export function extrudeFace(
  mesh: PolygonMesh,
  index: number,
  distance: number,
): PolygonMesh {
  if (
    !Number.isFinite(distance) ||
    Math.abs(distance) < 0.001 ||
    Math.abs(distance) > 1000
  )
    throw new Error("Extrusion distance must be between 0.001 and 1000 meters");
  checked(mesh);
  const normal = faceNormal(mesh, index),
    face = mesh.faces[index],
    vertices = mesh.vertices.map((v) => [...v] as Vec3),
    offset = vertices.length;
  face.forEach((i) =>
    vertices.push(
      mesh.vertices[i].map((n, j) => n + normal[j] * distance) as Vec3,
    ),
  );
  const cap = face.map((_, i) => offset + i),
    faces = mesh.faces.map((f) => [...f]);
  faces[index] = cap;
  for (let i = 0; i < face.length; i++) {
    const next = (i + 1) % face.length;
    faces.push([face[i], face[next], cap[next], cap[i]]);
  }
  return checked({ vertices, faces });
}
export function insetFace(
  mesh: PolygonMesh,
  index: number,
  ratio: number,
): PolygonMesh {
  if (!Number.isFinite(ratio) || ratio < 0.01 || ratio > 0.9)
    throw new Error("Inset ratio must be between 0.01 and 0.9");
  checked(mesh);
  faceNormal(mesh, index);
  const face = mesh.faces[index],
    center: Vec3 = [0, 0, 0];
  face.forEach((i) =>
    mesh.vertices[i].forEach((n, j) => (center[j] += n / face.length)),
  );
  const vertices = mesh.vertices.map((v) => [...v] as Vec3),
    offset = vertices.length;
  face.forEach((i) =>
    vertices.push(
      mesh.vertices[i].map(
        (n, j) => center[j] + (n - center[j]) * (1 - ratio),
      ) as Vec3,
    ),
  );
  const cap = face.map((_, i) => offset + i),
    faces = mesh.faces.map((f) => [...f]);
  faces[index] = cap;
  for (let i = 0; i < face.length; i++) {
    const next = (i + 1) % face.length;
    faces.push([face[i], face[next], cap[next], cap[i]]);
  }
  return checked({ vertices, faces });
}
export function moveVertex(
  mesh: PolygonMesh,
  index: number,
  position: Vec3,
): PolygonMesh {
  if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)
    throw new Error("Select a valid vertex");
  return checked({
    ...mesh,
    vertices: mesh.vertices.map((v, i) =>
      i === index ? ([...position] as Vec3) : ([...v] as Vec3),
    ),
  });
}

export function triangulateMesh(mesh: PolygonMesh): PolygonMesh {
  checked(mesh);
  return checked({
    vertices: mesh.vertices.map((v) => [...v] as Vec3),
    faces: mesh.faces.flatMap((f) =>
      f.slice(1, -1).map((_, i) => [f[0], f[i + 1], f[i + 2]]),
    ),
  });
}
