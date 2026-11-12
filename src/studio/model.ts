export type Vec3 = [number, number, number];
export type Shape = "box" | "sphere" | "cylinder" | "cone" | "torus";
export type Part = {
  id: string;
  name: string;
  shape: Shape;
  position: Vec3;
  rotation: Vec3;
  size: Vec3;
  color: string;
  metalness: number;
  roughness: number;
};
export type SceneDocument = { version: 1; name: string; parts: Part[] };
export const SHAPES: Shape[] = ["box", "sphere", "cylinder", "cone", "torus"];
export const MAX_PARTS = 64;
function object(x: unknown, keys: string[]): Record<string, unknown> {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).some((k) => !keys.includes(k))
  )
    throw Error("Unsupported scene fields.");
  return x as Record<string, unknown>;
}
function text(x: unknown, max: number): string {
  if (
    typeof x !== "string" ||
    !x.trim() ||
    x.length > max ||
    /[\x00-\x1f]/.test(x)
  )
    throw Error("Invalid scene label.");
  return x;
}
function number(x: unknown, min: number, max: number): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max)
    throw Error(`Scene values must be between ${min} and ${max}.`);
  return x;
}
function vec(x: unknown, min: number, max: number): Vec3 {
  if (!Array.isArray(x) || x.length !== 3)
    throw Error("A scene vector needs three numbers.");
  return x.map((n) => number(n, min, max)) as Vec3;
}
export function validateScene(input: unknown): SceneDocument {
  const x = object(input, ["version", "name", "parts"]);
  if (x.version !== 1 || !Array.isArray(x.parts) || x.parts.length > MAX_PARTS)
    throw Error(`Use scene version 1 with at most ${MAX_PARTS} objects.`);
  const parts = x.parts.map((value) => {
    const p = object(value, [
      "id",
      "name",
      "shape",
      "position",
      "rotation",
      "size",
      "color",
      "metalness",
      "roughness",
    ]);
    const id = text(p.id, 64);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !SHAPES.includes(p.shape as Shape) ||
      typeof p.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(p.color)
    )
      throw Error("Invalid object identity, shape, or color.");
    return {
      id,
      name: text(p.name, 80),
      shape: p.shape as Shape,
      position: vec(p.position, -100, 100),
      rotation: vec(p.rotation, -360, 360),
      size: vec(p.size, 0.02, 100),
      color: p.color,
      metalness: number(p.metalness, 0, 1),
      roughness: number(p.roughness, 0, 1),
    };
  });
  if (new Set(parts.map((p) => p.id)).size !== parts.length)
    throw Error("Object IDs must be unique.");
  return { version: 1, name: text(x.name, 100), parts };
}
export function parseScene(text: string): SceneDocument {
  if (new TextEncoder().encode(text).length > 64 * 1024)
    throw Error("Scene exceeds 64 KiB.");
  return validateScene(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    ),
  );
}
export function part(
  name: string,
  shape: Shape,
  position: Vec3,
  size: Vec3,
  color = "#78c5f5",
  id: string = crypto.randomUUID(),
): Part {
  return {
    id,
    name,
    shape,
    position,
    size,
    color,
    rotation: [0, 0, 0],
    metalness: 0.25,
    roughness: 0.45,
  };
}
export function preset(kind: "robot" | "room" | "empty"): SceneDocument {
  if (kind === "empty")
    return { version: 1, name: "Untitled scene", parts: [] };
  if (kind === "room")
    return {
      version: 1,
      name: "Creative studio",
      parts: [
        part("Floor", "box", [0, -0.1, 0], [8, 0.2, 6], "#40536a", "floor"),
        part(
          "Back wall",
          "box",
          [0, 1.5, -3],
          [8, 3, 0.15],
          "#9babc3",
          "wall-back",
        ),
        part(
          "Side wall",
          "box",
          [-4, 1.5, 0],
          [0.15, 3, 6],
          "#cad3df",
          "wall-side",
        ),
        part(
          "Desk",
          "box",
          [-1, 0.85, -1.9],
          [2.8, 0.16, 1.1],
          "#b88153",
          "desk",
        ),
        part(
          "Desk left leg",
          "box",
          [-2.1, 0.4, -1.9],
          [0.1, 0.8, 0.8],
          "#263547",
          "desk-leg-a",
        ),
        part(
          "Desk right leg",
          "box",
          [0.1, 0.4, -1.9],
          [0.1, 0.8, 0.8],
          "#263547",
          "desk-leg-b",
        ),
        part(
          "Monitor",
          "box",
          [-1, 1.4, -2.15],
          [1.4, 0.8, 0.1],
          "#204764",
          "monitor",
        ),
        part("Sofa", "box", [2.3, 0.45, 1], [1.5, 0.8, 2.5], "#4c8295", "sofa"),
        part(
          "Sofa back",
          "box",
          [3, 0.95, 1],
          [0.25, 1, 2.5],
          "#4c8295",
          "sofa-back",
        ),
        part(
          "Plant pot",
          "cylinder",
          [2.5, 0.35, -2],
          [0.65, 0.7, 0.65],
          "#ba7b50",
          "pot",
        ),
        part(
          "Plant canopy",
          "sphere",
          [2.5, 1.2, -2],
          [1.1, 1.5, 1.1],
          "#538866",
          "plant",
        ),
      ],
    };
  return {
    version: 1,
    name: "Sebby robot concept",
    parts: [
      part("Body", "box", [0, 2.1, 0], [1.7, 1.6, 0.85], "#78c5f5", "body"),
      part("Head", "box", [0, 3.5, 0], [1.4, 0.95, 0.95], "#78c5f5", "head"),
      part(
        "Visor",
        "box",
        [0, 3.55, 0.49],
        [1.1, 0.34, 0.08],
        "#15344c",
        "visor",
      ),
      part(
        "Left eye",
        "sphere",
        [-0.3, 3.55, 0.55],
        [0.13, 0.13, 0.08],
        "#aef6ff",
        "eye-a",
      ),
      part(
        "Right eye",
        "sphere",
        [0.3, 3.55, 0.55],
        [0.13, 0.13, 0.08],
        "#aef6ff",
        "eye-b",
      ),
      part(
        "Core",
        "sphere",
        [0, 2.25, 0.45],
        [0.42, 0.42, 0.14],
        "#aef6ff",
        "core",
      ),
      part(
        "Left arm",
        "cylinder",
        [-1.15, 2.05, 0],
        [0.45, 1.7, 0.45],
        "#4f8db1",
        "arm-a",
      ),
      part(
        "Right arm",
        "cylinder",
        [1.15, 2.05, 0],
        [0.45, 1.7, 0.45],
        "#4f8db1",
        "arm-b",
      ),
      part(
        "Left leg",
        "box",
        [-0.48, 0.65, 0],
        [0.55, 1.2, 0.6],
        "#4f8db1",
        "leg-a",
      ),
      part(
        "Right leg",
        "box",
        [0.48, 0.65, 0],
        [0.55, 1.2, 0.6],
        "#4f8db1",
        "leg-b",
      ),
      part(
        "Left foot",
        "box",
        [-0.48, 0.13, 0.2],
        [0.7, 0.25, 1],
        "#233e58",
        "foot-a",
      ),
      part(
        "Right foot",
        "box",
        [0.48, 0.13, 0.2],
        [0.7, 0.25, 1],
        "#233e58",
        "foot-b",
      ),
    ],
  };
}
export function scenePrompt(scene: SceneDocument, request: string): string {
  const prompt = `Propose an editable 3D scene as JSON only. Do not claim to have rendered or saved it. The user will review and apply the JSON in Sebby Studio.\nSchema: {"version":1,"name":"title","parts":[{"id":"unique-id","name":"label","shape":"box|sphere|cylinder|cone|torus","position":[x,y,z],"rotation":[x,y,z],"size":[width,height,depth],"color":"#78c5f5","metalness":0.25,"roughness":0.45}]}. Up axis Y, ground y=0, units meters, rotations degrees. Primitive base shapes have unit bounds before size scaling; torus lies in XY. Maximum 64 parts, positions -100..100, sizes .02..100, material values 0..1. Use only these fields, no scripts, URLs or assets. Preserve unrelated parts and IDs when editing. Return the full resulting scene, with no markdown or commentary.\nCurrent scene (reference data): ${JSON.stringify(validateScene(scene))}\nUser request: ${request}`;
  if (new TextEncoder().encode(prompt).length > 16000)
    throw Error(
      "Scene plus request is too large for this AI request. Reduce objects or shorten the request.",
    );
  return prompt;
}
export type Wall = { a: [number, number]; b: [number, number] };
export function wallsToScene(
  walls: Wall[],
  width: number,
  height: number,
): SceneDocument {
  number(width, 1, 50);
  number(height, 0.5, 10);
  if (!walls.length || walls.length > 60)
    throw Error("Draw 1–60 wall segments first.");
  const depth = (width * 2) / 3;
  return validateScene({
    version: 1,
    name: "Traced floor plan",
    parts: [
      part(
        "Floor",
        "box",
        [0, -0.1, 0],
        [width, 0.2, depth],
        "#637387",
        "floor",
      ),
      ...walls.map((w, i) => {
        for (const n of [...w.a, ...w.b]) number(n, 0, 1);
        const ax = (w.a[0] - 0.5) * width,
          az = (w.a[1] - 0.5) * depth,
          bx = (w.b[0] - 0.5) * width,
          bz = (w.b[1] - 0.5) * depth;
        const p = part(
          `Wall ${i + 1}`,
          "box",
          [(ax + bx) / 2, height / 2, (az + bz) / 2],
          [Math.hypot(bx - ax, bz - az), height, 0.15],
          "#c3cfdf",
          `wall-${i + 1}`,
        );
        p.rotation[1] = (-Math.atan2(bz - az, bx - ax) * 180) / Math.PI;
        return p;
      }),
    ],
  });
}
