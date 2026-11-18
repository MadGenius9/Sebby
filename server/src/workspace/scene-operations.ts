import { z } from "zod";
import {
  documentSchema,
  objectSchema,
  type ProjectDocument,
} from "./schema.js";
import {
  boxMesh,
  extrudeFace,
  insetFace,
  moveVertex,
  triangulateMesh,
} from "./mesh.js";

const id = z.string().uuid();
const vector = z.tuple([
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
]);
const name = z.string().trim().min(1).max(80);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const scale = z.tuple([
  z.number().min(0.01).max(1000),
  z.number().min(0.01).max(1000),
  z.number().min(0.01).max(1000),
]);
export const sceneOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      id,
      name,
      kind: z.enum(["box", "sphere", "cylinder", "editable-cube"]),
      position: vector.optional(),
      rotation: vector.optional(),
      scale: scale.optional(),
      color: color.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("update"),
      id,
      name: name.optional(),
      position: vector.optional(),
      rotation: vector.optional(),
      scale: scale.optional(),
      color: color.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 2, "Specify an object change"),
  z.object({ op: z.literal("duplicate"), id, newId: id, name }).strict(),
  z.object({ op: z.literal("remove"), id }).strict(),
  z
    .object({
      op: z.literal("extrude"),
      id,
      face: z.number().int().min(0).max(2047),
      distance: z
        .number()
        .finite()
        .min(-1000)
        .max(1000)
        .refine((n) => Math.abs(n) >= 0.001),
    })
    .strict(),
  z
    .object({
      op: z.literal("inset"),
      id,
      face: z.number().int().min(0).max(2047),
      ratio: z.number().min(0.01).max(0.9),
    })
    .strict(),
  z.object({ op: z.literal("triangulate"), id }).strict(),
  z
    .object({
      op: z.literal("vertex"),
      id,
      vertex: z.number().int().min(0).max(2047),
      position: vector,
    })
    .strict(),
]);
export const sceneOperationsSchema = z
  .array(sceneOperationSchema)
  .min(1)
  .max(24);

// Pure candidate construction: neither saved scenes nor proposals change if a later operation fails.
export function applySceneOperations(
  scene: ProjectDocument["scene"],
  input: unknown,
): ProjectDocument["scene"] {
  const operations = sceneOperationsSchema.parse(input);
  let next = structuredClone(documentSchema.shape.scene.parse(scene));
  for (const operation of operations) {
    const index = next.objects.findIndex((o) => o.id === operation.id);
    if (operation.op === "add") {
      if (index >= 0) throw new Error("An object with that ID already exists");
      next.objects.push(
        objectSchema.parse({
          id: operation.id,
          name: operation.name,
          kind: operation.kind === "editable-cube" ? "mesh" : operation.kind,
          position: operation.position ?? [0, 0.5, 0],
          rotation: operation.rotation ?? [0, 0, 0],
          scale: operation.scale ?? [1, 1, 1],
          color: operation.color ?? "#83ceff",
          ...(operation.kind === "editable-cube" ? { mesh: boxMesh() } : {}),
        }),
      );
    } else {
      if (index < 0)
        throw new Error("Object not found in the saved candidate scene");
      const object = next.objects[index];
      if (operation.op === "remove") next.objects.splice(index, 1);
      else if (operation.op === "duplicate") {
        if (next.objects.some((o) => o.id === operation.newId))
          throw new Error("The duplicate ID already exists");
        next.objects.push({
          ...structuredClone(object),
          id: operation.newId,
          name: operation.name,
        });
      } else if (operation.op === "update") {
        const { op, id, ...changes } = operation;
        next.objects[index] = objectSchema.parse({ ...object, ...changes });
      } else {
        if (object.kind !== "mesh")
          throw new Error("Mesh operations require an editable mesh object");
        const mesh =
          operation.op === "extrude"
            ? extrudeFace(object.mesh, operation.face, operation.distance)
            : operation.op === "inset"
              ? insetFace(object.mesh, operation.face, operation.ratio)
              : operation.op === "triangulate"
                ? triangulateMesh(object.mesh)
                : moveVertex(object.mesh, operation.vertex, operation.position);
        next.objects[index] = { ...object, mesh };
      }
    }
    next = documentSchema.shape.scene.parse(next);
  }
  return next;
}
