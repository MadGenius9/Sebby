import fs from "node:fs/promises";
import path from "node:path";
export function installStudioExport({
  register,
  choosePath,
  isClosing = () => false,
}) {
  let busy = false;
  register("export-studio", async (input) => {
    if (busy) throw Error("Finish the current export first.");
    if (
      !input ||
      Object.keys(input).some((k) => !["format", "bytes"].includes(k)) ||
      !["json", "glb", "png"].includes(input.format) ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength < 2 ||
      input.bytes.byteLength > 16 * 1024 * 1024
    )
      throw Error("Invalid or oversized Studio export.");
    const { format } = input,
      bytes = Buffer.from(input.bytes);
    if (format === "json") {
      const doc = JSON.parse(bytes.toString("utf8"));
      if (
        doc?.version !== 1 ||
        !Array.isArray(doc.parts) ||
        doc.parts.length > 64
      )
        throw Error("Invalid scene file.");
    }
    if (
      format === "glb" &&
      (bytes.length < 12 ||
        bytes.toString("ascii", 0, 4) !== "glTF" ||
        bytes.readUInt32LE(4) !== 2 ||
        bytes.readUInt32LE(8) !== bytes.length)
    )
      throw Error("Invalid GLB file.");
    if (
      format === "png" &&
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("Invalid PNG file.");
    busy = true;
    try {
      const selected = await choosePath(format);
      if (!selected || isClosing()) return { saved: false };
      if (path.extname(selected).toLowerCase() !== `.${format}`)
        throw Error(`Choose a .${format} filename.`);
      await fs.writeFile(selected, bytes, { flag: "wx", mode: 0o600 });
      return { saved: true };
    } finally {
      busy = false;
    }
  });
}
