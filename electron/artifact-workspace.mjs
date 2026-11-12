import { createHash } from "node:crypto";
import { Workspace } from "./services.mjs";

// Trusted artifact adapter, never exposed as a renderer-controlled workspace.
export class ArtifactWorkspace {
  constructor(workspace = new Workspace()) {
    this.workspace = workspace;
    this.expected = null;
    this.generation = 0;
  }
  get root() {
    return this.workspace.root;
  }
  async selectArtifact({ directory, path, sha256 }) {
    const generation = ++this.generation;
    this.expected = null;
    if (path !== "index.html" || !/^[a-f0-9]{64}$/.test(sha256))
      throw Error("Invalid static artifact identity.");
    await this.workspace.select(directory);
    if (generation !== this.generation)
      throw Error("Static artifact selection changed.");
    this.expected = { path, sha256, root: this.workspace.root };
  }
  async read(relative) {
    const expected = this.expected;
    if (!expected || relative !== expected.path || this.root !== expected.root)
      throw Error("Unknown static artifact.");
    const file = await this.workspace.read(relative);
    if (
      expected !== this.expected ||
      this.root !== expected.root ||
      createHash("sha256").update(file.content).digest("hex") !==
        expected.sha256
    )
      throw Error("Static artifact changed. Build a new reviewed prototype.");
    return file;
  }
}
