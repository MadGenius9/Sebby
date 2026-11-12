import { buildGroup, disposeGroup } from "./scene";
import type { SceneDocument } from "./model";
export async function saveStudioFile(
  format: "json" | "glb" | "png",
  bytes: Uint8Array,
) {
  const api = window.sebby as unknown as
    | {
        exportStudio?: (input: {
          format: string;
          bytes: Uint8Array;
        }) => Promise<{ saved: boolean }>;
      }
    | undefined;
  if (api?.exportStudio) return api.exportStudio({ format, bytes });
  if (window.sebby)
    throw Error("Restart the updated desktop app to enable Studio exports.");
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type:
        format === "json"
          ? "application/json"
          : format === "png"
            ? "image/png"
            : "model/gltf-binary",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `sebby-scene.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { saved: true };
}
export async function exportGlb(scene: SceneDocument) {
  const { GLTFExporter } =
    await import("three/addons/exporters/GLTFExporter.js");
  const group = buildGroup(scene);
  try {
    const data = await new GLTFExporter().parseAsync(group, { binary: true });
    if (!(data instanceof ArrayBuffer)) throw Error("GLB export failed.");
    return saveStudioFile("glb", new Uint8Array(data));
  } finally {
    disposeGroup(group);
  }
}
