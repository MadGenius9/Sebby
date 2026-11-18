import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  boxMesh,
  extrudeFace,
  insetFace,
  moveVertex,
  triangulateMesh,
  validateMesh,
  faceNormal,
} from "../server/src/workspace/mesh.js";
import {
  documentSchema,
  objectSchema,
} from "../server/src/workspace/schema.js";
import { searchProject } from "../server/src/workspace/knowledge.js";
import { objectMesh } from "../web/src/workspace/scene-model.ts";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import * as THREE from "three";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-knowledge-mesh-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { db } = await import("../server/src/db.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { WORKSPACE_TOOLS } =
  await import("../server/src/workspace/agent-tools.js");
const { bindAgent, unbindAgent, reviewProposal, applyProposal } =
  await import("../server/src/workspace/collaboration.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
  db.prepare(
    "INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
  ).run(`bot-${id}`, id, id, Date.now(), Date.now());
}
after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
const request = (method: string, url: string, body?: unknown, user = "alice") =>
  projectsApi.request(`http://localhost${url}`, {
    method,
    headers: {
      cookie: `grokbot_session=${user}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const invoke = async (
  name: string,
  args: unknown,
  ctx: any = { userId: "alice", botId: "bot-alice" },
) =>
  JSON.parse(
    (await WORKSPACE_TOOLS.find((t) => t.name === name)!.impl(args, ctx))
      .output,
  );
const modeled = () =>
  extrudeFace(insetFace(extrudeFace(boxMesh(), 3, 0.4), 3, 0.2), 3, 0.25);
const sceneObject = () => ({
  id: randomUUID(),
  name: "Editable prop",
  kind: "mesh" as const,
  position: [0, 1, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [2, 1, 1] as [number, number, number],
  color: "#83ceff",
  mesh: modeled(),
});

test("mesh operations preserve the original and create closed, consistently oriented topology", () => {
  const box = boxMesh(),
    original = JSON.stringify(box);
  assert.equal(validateMesh(box), null);
  assert.deepEqual(faceNormal(box, 3), [0, 1, 0]);
  const mesh = modeled();
  assert.equal(JSON.stringify(box), original);
  assert.equal(validateMesh(mesh), null);
  assert.equal(mesh.vertices.length, 20);
  assert.equal(mesh.faces.length, 18);
  const edges = new Map<string, number[]>();
  mesh.faces.forEach((face) =>
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length],
        key = [a, b].sort((x, y) => x - y).join(":");
      edges.set(key, [...(edges.get(key) || []), a < b ? 1 : -1]);
    }),
  );
  for (const directions of edges.values())
    assert.deepEqual(directions.sort(), [-1, 1]);
  const triangles = triangulateMesh(mesh);
  assert.ok(triangles.faces.every((f) => f.length === 3));
  assert.equal(
    validateMesh(moveVertex(triangles, 0, [-0.6, -0.5, -0.5])),
    null,
  );
});

test("mesh schema and tools refuse invalid topology, nonplanar edits and geometry overruns", () => {
  for (const operation of [
    () => extrudeFace(boxMesh(), 99, 0.2),
    () => extrudeFace(boxMesh(), 0, 0),
    () => insetFace(boxMesh(), 0, 1),
    () => moveVertex(boxMesh(), 0, [-0.6, -0.5, -0.5]),
  ])
    assert.throws(operation);
  const object = sceneObject();
  assert.ok(objectSchema.safeParse(object).success);
  for (const mesh of [
    { ...object.mesh, faces: [[0, 1, 999]] },
    { ...object.mesh, faces: [[0, 1, 1]] },
    { ...object.mesh, vertices: [[Infinity, 0, 0]] },
    { ...object.mesh, faces: [[0, 1, 2, 3, 4]] },
  ])
    assert.equal(objectSchema.safeParse({ ...object, mesh }).success, false);
  assert.equal(
    objectSchema.safeParse({ ...object, kind: "box" }).success,
    false,
  );
  const triangle = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ] as [number, number, number][],
    faces: [[0, 1, 2]],
  };
  assert.equal(validateMesh(triangle), null);
  assert.ok(
    validateMesh({
      ...triangle,
      vertices: Array.from({ length: 2049 }, () => [0, 0, 0]),
    }),
  );
});

test("knowledge search returns bounded literal snippets with revision, lines and exact file hashes", () => {
  const file = {
    path: "SEBBY.md",
    content:
      "# Brief\nKeep the product industry neutral.\nUse Blender exports.\n",
  };
  const project = {
    id: randomUUID(),
    revision: 4,
    updatedAt: Date.now(),
    name: "Memory fixture",
    files: [
      file,
      {
        path: "long.txt",
        content: "a".repeat(5000) + " needle " + "b".repeat(1000),
      },
      { path: "many.txt", content: "needle\n".repeat(14000) },
    ],
    scene: { objects: [] },
  };
  const found = searchProject(project, "industry neutral");
  assert.equal(found.revision, 4);
  assert.equal(found.hits[0].path, "SEBBY.md");
  assert.equal(found.hits[0].startLine, 1);
  assert.equal(
    found.hits[0].sha256,
    createHash("sha256").update(file.content).digest("hex"),
  );
  assert.match(found.hits[0].snippet, /industry neutral/);
  const many = searchProject(project, "needle");
  assert.equal(many.hits.length, 20);
  assert.ok(
    many.hits.every(
      (h) => h.snippet.length < 1600 && h.snippet.includes("needle"),
    ),
  );
  assert.deepEqual(searchProject(project, "[").hits, []);
  assert.equal(searchProject(project, "NEEDLE").hits.length, 20);
});

test("saved knowledge and meshes persist through import, reviewed agent edits and owner-scoped search", async () => {
  const document = {
    name: "Knowledge and modeling",
    files: [
      {
        path: "SEBBY.md",
        content: "# Goal\nBuild an editable prop in Blender-compatible GLB.",
      },
      {
        path: "docs/decisions.md",
        content: "# Decisions\n2026-11-16: Keep the product general-purpose.",
      },
    ],
    scene: { objects: [sceneObject()] },
  };
  const create = await request("POST", "/import", document);
  assert.equal(create.status, 201);
  let project = (await create.json()).project;
  const result = await request("GET", `/${project.id}/search?q=editable`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).hits[0].path, "SEBBY.md");
  assert.equal(
    (await request("GET", `/${project.id}/search?q=prop`, undefined, "bob"))
      .status,
    404,
  );
  const binding = bindAgent("alice", project.id, "bot-alice", false),
    scope = { projectId: project.id, grantId: binding.grantId, revision: 1 };
  const overview = await invoke("project_overview", {});
  assert.equal(overview.knowledge.length, 2);
  const found = await invoke("project_search", { ...scope, query: "editable" });
  assert.equal(found.revision, 1);
  await assert.rejects(
    invoke("project_search", { ...scope, revision: 99, query: "prop" }),
    /revision changed/,
  );
  await assert.rejects(
    invoke(
      "project_search",
      { ...scope, query: "prop" },
      { userId: "bob", botId: "bot-bob" },
    ),
    /not authorized/,
  );
  const candidate = structuredClone(document.scene);
  candidate.objects[0].mesh = extrudeFace(candidate.objects[0].mesh, 3, 0.1);
  const proposed = await invoke("project_propose_changes", {
    ...scope,
    summary: "Extend the editable prop",
    scene: candidate,
  });
  project = (await (await request("GET", `/${project.id}`)).json()).project;
  assert.deepEqual(project.scene, document.scene);
  const review = await reviewProposal("alice", proposed.proposal.id);
  assert.equal(review.sceneChanged, true);
  const applied = applyProposal(
    "alice",
    proposed.proposal.id,
    review.proposal.reviewHash,
  );
  assert.equal(applied.revision, 2);
  assert.deepEqual(applied.scene, candidate);
  const reopened = (await (await request("GET", `/${project.id}`)).json())
    .project;
  assert.deepEqual(reopened.scene, candidate);
  assert.ok(
    documentSchema.safeParse({
      name: reopened.name,
      files: reopened.files,
      scene: reopened.scene,
    }).success,
  );
  unbindAgent("alice", project.id, "bot-alice");
  await assert.rejects(
    invoke("project_search", { ...scope, revision: 2, query: "prop" }),
    /not authorized/,
  );
  const restart = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import Database from 'better-sqlite3'; const db=new Database(process.env.DB_PATH); const p=JSON.parse(db.prepare('SELECT document FROM workspace_projects WHERE id=?').get(process.argv[1]).document); console.log(JSON.stringify({files:p.files,mesh:p.scene.objects[0].mesh})); db.close();",
      project.id,
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(restart).mesh, candidate.objects[0].mesh);
});

test("the actual Three.js mesh geometry exports a GLB with finite indexed-accessor data", async () => {
  const previous = (globalThis as any).FileReader;
  (globalThis as any).FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
  try {
    const group = new THREE.Group();
    group.add(objectMesh(sceneObject()));
    const exported = await new GLTFExporter().parseAsync(group, {
      binary: true,
    });
    assert.ok(exported instanceof ArrayBuffer);
    const data = Buffer.from(exported);
    assert.equal(data.readUInt32LE(0), 0x46546c67);
    assert.equal(data.readUInt32LE(4), 2);
    assert.equal(data.readUInt32LE(8), data.length);
    const json = JSON.parse(
      data.subarray(20, 20 + data.readUInt32LE(12)).toString(),
    );
    assert.equal(json.meshes.length, 1);
    assert.ok(json.accessors.every((a: any) => a.count > 0));
    const file = path.join(root, "editable-prop.glb");
    writeFileSync(file, data);
    assert.ok(readFileSync(file).length > 1000);
    const blender = process.env.SEBBY_BLENDER_BIN;
    if (blender) {
      const script = path.join(root, "check_glb.py");
      writeFileSync(
        script,
        "import bpy, sys, json\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--')+1])\nmeshes=[o for o in bpy.context.scene.objects if o.type=='MESH']\nassert len(meshes)==1\no=meshes[0]\nassert len(o.data.vertices)>=8 and len(o.data.polygons)>=12\nassert abs(o.dimensions.x-2)<0.0001\nprint('SEBBY_GLB_VERIFIED',json.dumps({'meshes':len(meshes),'vertices':len(o.data.vertices),'polygons':len(o.data.polygons)}))\n",
      );
      const output = execFileSync(
        blender,
        ["--background", "--factory-startup", "--python", script, "--", file],
        { encoding: "utf8", timeout: 45000, maxBuffer: 1000000 },
      );
      assert.match(output, /SEBBY_GLB_VERIFIED/);
      console.log(output.match(/SEBBY_GLB_VERIFIED[^\n]*/)?.[0]);
    }
  } finally {
    (globalThis as any).FileReader = previous;
  }
});
