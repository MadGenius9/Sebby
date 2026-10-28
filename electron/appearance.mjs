import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const PAL_IDS = Object.freeze([
  "orbit",
  "scout",
  "wisp",
  "luma",
  "nook",
  "finch",
  "tidal",
  "moss",
  "piper",
]);
export const APPEARANCE_PRESETS = Object.freeze({
  ice: Object.freeze({ body: "#78C5F5", accent: "#3D9BD8", glow: "#B9EAFF" }),
  mint: Object.freeze({ body: "#83D6BC", accent: "#348C81", glow: "#BBF9DF" }),
  lavender: Object.freeze({
    body: "#B5A0EA",
    accent: "#7963BB",
    glow: "#E5D8FF",
  }),
  ember: Object.freeze({ body: "#EEAD7A", accent: "#B75D43", glow: "#FFE0AF" }),
});
export const DEFAULT_APPEARANCE = Object.freeze({
  pal: "orbit",
  palettePreset: "ice",
  colors: APPEARANCE_PRESETS.ice,
  motion: true,
});
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error("Appearance accepts only the supported visual settings.");
}
function colors(value) {
  exact(value, ["body", "accent", "glow"]);
  const result = {};
  for (const key of ["body", "accent", "glow"]) {
    if (typeof value[key] !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value[key]))
      throw Error("Choose six-digit hex colors such as #78C5F5.");
    result[key] = value[key].toUpperCase();
  }
  return result;
}
export function validateAppearance(input) {
  exact(input, ["pal", "palettePreset", "colors", "motion"]);
  if (
    !PAL_IDS.includes(input.pal) ||
    !["ice", "mint", "lavender", "ember", "custom"].includes(
      input.palettePreset,
    ) ||
    typeof input.motion !== "boolean"
  )
    throw Error("Choose a supported companion, palette and motion setting.");
  const provided = input.colors === undefined ? null : colors(input.colors);
  if (input.palettePreset === "custom" && !provided)
    throw Error("Custom palettes need body, accent and glow colors.");
  return {
    pal: input.pal,
    palettePreset: input.palettePreset,
    colors:
      input.palettePreset === "custom"
        ? provided
        : { ...APPEARANCE_PRESETS[input.palettePreset] },
    motion: input.motion,
  };
}
/** Validated visual metadata only; assets and material application remain code-owned. */
export class AppearanceStore {
  constructor(directory) {
    this.file = path.join(directory, "sebby-appearance.json");
    this.value = structuredClone(DEFAULT_APPEARANCE);
    this.ready = false;
    this.queue = Promise.resolve();
  }
  async load() {
    if (this.ready) return this.get();
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
        throw Error("Invalid appearance file.");
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      exact(data, ["version", "appearance"]);
      if (data.version !== 1) throw Error("Unsupported appearance version.");
      const value = validateAppearance(data.appearance);
      if (
        JSON.stringify(value.colors) !==
        JSON.stringify(colors(data.appearance.colors))
      )
        throw Error("Stored preset colors do not match the selected preset.");
      this.value = value;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error(
          "Appearance settings could not be loaded. Existing data was not overwritten.",
        );
    }
    this.ready = true;
    return this.get();
  }
  get() {
    if (!this.ready) throw Error("Load appearance settings first.");
    return structuredClone(this.value);
  }
  async save(input) {
    if (!this.ready) throw Error("Load appearance settings first.");
    const value = validateAppearance(input);
    const operation = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(
          temporary,
          JSON.stringify({ version: 1, appearance: value }, null, 2),
          { flag: "wx", mode: 0o600 },
        );
        await fs.rename(temporary, this.file);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      this.value = structuredClone(value);
      return this.get();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
