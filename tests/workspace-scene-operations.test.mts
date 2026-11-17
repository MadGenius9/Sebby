import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applySceneOperations,
  sceneOperationsSchema,
} from "../server/src/workspace/scene-operations.js";
import { validateMesh } from "../server/src/workspace/mesh.js";

test("ordered modeling operations produce a valid candidate without changing the saved scene", () => {
  const scene = { objects: [] },
    id = randomUUID(),
    copy = randomUUID();
  const candidate = applySceneOperations(scene, [
    { op: "add", id, name: "Prop", kind: "editable-cube" },
    { op: "extrude", id, face: 3, distance: 0.25 },
    { op: "inset", id, face: 3, ratio: 0.2 },
    { op: "update", id, position: [2, 1, 0], color: "#ffaa33" },
    { op: "duplicate", id, newId: copy, name: "Copy" },
    { op: "remove", id },
  ]);
  assert.deepEqual(scene, { objects: [] });
  assert.equal(candidate.objects.length, 1);
  const prop = candidate.objects[0];
  assert.equal(prop.id, copy);
  assert.equal(prop.kind, "mesh");
  if (prop.kind !== "mesh") throw new Error("Expected mesh");
  assert.deepEqual(prop.position, [2, 1, 0]);
  assert.equal(prop.mesh.vertices.length, 16);
  assert.equal(prop.mesh.faces.length, 14);
  assert.equal(validateMesh(prop.mesh), null);
  const edited = applySceneOperations(candidate, [
    { op: "triangulate", id: copy },
    { op: "vertex", id: copy, vertex: 0, position: [-0.6, -0.5, -0.5] },
  ]);
  assert.equal(edited.objects[0].kind, "mesh");
  assert.deepEqual(candidate.objects[0], prop);
});

test("failed modeling batches, invalid topology and object collisions leave the input untouched", () => {
  const id = randomUUID(),
    scene = applySceneOperations({ objects: [] }, [
      { op: "add", id, name: "Cube", kind: "editable-cube" },
    ]),
    before = JSON.stringify(scene);
  const rejected = [
    [
      { op: "update", id, position: [1, 2, 3] },
      { op: "extrude", id, face: 99, distance: 1 },
    ],
    [{ op: "vertex", id, vertex: 0, position: [-0.6, -0.5, -0.5] }],
    [{ op: "add", id, name: "Collision", kind: "box" }],
    [{ op: "duplicate", id, newId: id, name: "Collision" }],
    [{ op: "remove", id: randomUUID() }],
    [{ op: "update", id }],
    [{ op: "update", id, scale: [0, 1, 1] }],
    [{ op: "update", id, color: "red", execute: "arbitrary code" }],
    [{ op: "extrude", id, face: 0, distance: 0 }],
    [{ op: "inset", id, face: 0, ratio: 1 }],
  ];
  for (const ops of rejected) {
    assert.throws(() => applySceneOperations(scene, ops));
    assert.equal(JSON.stringify(scene), before);
  }
  const primitive = applySceneOperations({ objects: [] }, [
    { op: "add", id, name: "Sphere", kind: "sphere" },
  ]);
  assert.throws(
    () => applySceneOperations(primitive, [{ op: "triangulate", id }]),
    /editable mesh/,
  );
});

test("modeling operations bound batch size, object count and serialized tool schemas", () => {
  assert.equal(sceneOperationsSchema.safeParse([]).success, false);
  assert.equal(
    sceneOperationsSchema.safeParse(
      Array.from({ length: 25 }, () => ({ op: "remove", id: randomUUID() })),
    ).success,
    false,
  );
  const ids = Array.from({ length: 100 }, randomUUID);
  let scene = { objects: [] } as ReturnType<typeof applySceneOperations>;
  for (const id of ids)
    scene = applySceneOperations(scene, [
      { op: "add", id, name: "Bounded", kind: "box" },
    ]);
  assert.throws(() =>
    applySceneOperations(scene, [
      { op: "add", id: randomUUID(), name: "Too many", kind: "box" },
    ]),
  );
  assert.equal(scene.objects.length, 100);
});
