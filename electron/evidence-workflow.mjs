import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parse } from "parse5";
import { MAX_TEXT_BYTES, validateRelative, validateText } from "./services.mjs";
import { noLinks } from "./isolation-config.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const unsafeLabel = /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/;
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw Error("Invalid evidence workflow request.");
};
const validId = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);

export function inspectMarkup(content) {
  validateText(content);
  const document = parse(content, { sourceCodeLocationInfo: true });
  const elements = Object.create(null),
    headings = [],
    landmarks = [];
  let count = 0,
    scripts = 0,
    externalReferences = 0;
  const visit = (node) => {
    if (++count > 12000)
      throw Error("Markup has too many nodes for bounded analysis.");
    if (node.tagName) {
      const tag = node.tagName;
      elements[tag] = (elements[tag] || 0) + 1;
      if (tag === "script") scripts++;
      const evidence = {
        tag,
        line: node.sourceCodeLocation?.startLine || null,
      };
      if (/^h[1-6]$/.test(tag) && headings.length < 40) headings.push(evidence);
      if (
        ["main", "nav", "header", "footer", "section", "aside"].includes(tag) &&
        landmarks.length < 40
      )
        landmarks.push(evidence);
      for (const attribute of node.attrs || [])
        if (
          ["src", "href", "action", "poster", "srcset"].includes(
            attribute.name,
          ) &&
          attribute.value
        )
          externalReferences++;
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(document);
  return {
    elements,
    headings,
    landmarks,
    scripts,
    resourceReferences: externalReferences,
  };
}

export function buildStaticPrototype(sectionCount) {
  if (!Number.isInteger(sectionCount) || sectionCount < 1 || sectionCount > 8)
    throw Error("Invalid static blueprint.");
  const sections = Array.from(
    { length: sectionCount },
    (_, i) =>
      `<section><p class="eyebrow">SECTION ${i + 1}</p><h2>Original section ${i + 1}</h2><p>Replace this original sample content with your own reviewed content.</p></section>`,
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original static study</title><style>body{margin:0;background:#102132;color:#e9f6ff;font:18px system-ui;line-height:1.6}main{max-width:960px;margin:auto;padding:48px 24px}header{padding:24px 0 40px}h1{font-size:42px;line-height:1.1}section{padding:24px;margin:20px 0;border:1px solid #45677c;border-radius:16px;background:#183248}.eyebrow{font-size:12px;letter-spacing:3px;color:#8edbff}footer{padding:24px;color:#aac4d5}</style></head><body><main><header><p class="eyebrow">SEBBY / ORIGINAL STATIC STUDY</p><h1>A fresh starting point</h1><p>A fixed-template structural prototype. No source text, assets, branding or scripts were copied.</p></header>${sections}<footer>Static markup only. No application logic, network access, or executed target code.</footer></main></body></html>`;
}

export function testStaticPrototype(content, sectionCount) {
  const observations = inspectMarkup(content);
  const results = [
    { name: "No script elements", passed: observations.scripts === 0 },
    {
      name: "No resource URLs or form actions",
      passed: observations.resourceReferences === 0,
    },
    {
      name: "Expected original sections",
      passed: observations.elements.section === sectionCount,
    },
    {
      name: "Standalone HTML document",
      passed:
        observations.elements.html === 1 && observations.elements.main === 1,
    },
  ];
  if (results.some((result) => !result.passed))
    throw Error("Generated static prototype failed its checks.");
  return results;
}

export class EvidenceWorkflow {
  #proposals = new Map();
  #builds = new Map();
  #busy = false;
  #closed = false;
  constructor({
    workspace,
    confirm = async () => false,
    preview,
    dataDirectory,
  }) {
    if (
      !workspace ||
      typeof dataDirectory !== "string" ||
      !path.isAbsolute(dataDirectory)
    )
      throw Error(
        "Evidence workflow requires a workspace and app-data directory.",
      );
    Object.assign(this, { workspace, confirm, preview });
    this.buildRoot = path.join(dataDirectory, "evidence-builds");
  }
  get isBusy() {
    return this.#busy;
  }
  #assert() {
    if (this.#closed) throw Error("Evidence workflow is closed.");
  }
  async #run(action) {
    this.#assert();
    if (this.#busy) throw Error("Finish the current evidence operation first.");
    this.#busy = true;
    try {
      return await action();
    } finally {
      this.#busy = false;
    }
  }
  async #source(proposal) {
    this.#assert();
    if (this.workspace.root !== proposal.workspace)
      throw Error("Selected workspace changed; inspect the target again.");
    const file = await this.workspace.read(proposal.source.path);
    this.#assert();
    validateText(file.content);
    if (
      this.workspace.root !== proposal.workspace ||
      sha(file.content) !== proposal.source.sha256
    )
      throw Error("Source changed; inspect the target again before building.");
    return file;
  }
  async prepare(input) {
    return this.#run(async () => {
      exact(input, ["path", "authorized"]);
      if (
        input.authorized !== true ||
        typeof input.path !== "string" ||
        input.path.length > 240 ||
        unsafeLabel.test(input.path) ||
        !/\.html?$/i.test(input.path)
      )
        throw Error("Authorize one relative local HTML target.");
      validateRelative(input.path);
      if (!this.workspace.root || unsafeLabel.test(this.workspace.root))
        throw Error("Choose a local workspace first.");
      if (this.#proposals.size >= 10)
        throw Error(
          "Ten evidence proposals are retained this session. Restart before preparing more.",
        );
      const root = this.workspace.root;
      const relative = input.path;
      const approved = await this.confirm(
        "Inspect this authorized static target?",
        `File: ${relative}\nWorkspace: ${root}\n\nConfirm that you own this target or have permission to analyze it. Sebby reads bounded local HTML as data, without running scripts, fetching URLs or sending it to AI. This inspects structure only; it does not recover an application's behavior.`,
      );
      this.#assert();
      if (approved !== true) return { status: "denied" };
      if (root !== this.workspace.root)
        throw Error("Selected workspace changed.");
      const file = await this.workspace.read(relative);
      this.#assert();
      if (root !== this.workspace.root)
        throw Error("Selected workspace changed.");
      validateText(file.content);
      const observations = inspectMarkup(file.content);
      const proposal = {
        id: randomUUID(),
        workspace: root,
        source: {
          path: relative,
          sha256: sha(file.content),
          bytes: Buffer.byteLength(file.content),
        },
        observations,
        blueprint: {
          name: "Original static study",
          recipe: "original-static-v1",
          sectionCount: Math.max(
            1,
            Math.min(
              8,
              observations.headings.length ||
                observations.elements.section ||
                3,
            ),
          ),
          explanation:
            "Use the observed heading/section count, capped at eight, to create a fresh fixed-template page. Layout, sample text, colors and styling come from Sebby's original template, not from the target.",
        },
        limitations: [
          "Static HTML structure only; no computed layout or runtime behavior observed.",
          "No script, stylesheet, URL, iframe, asset, account or binary was opened or executed.",
          "No source text, assets, branding or implementation will be copied into the prototype.",
          "This is not REA integration, arbitrary-app reconstruction or isolated code execution.",
          "Heading and landmark evidence lists are capped at 40 entries; element totals count all parsed elements.",
        ],
      };
      this.#proposals.set(proposal.id, proposal);
      return { status: "prepared", proposal: structuredClone(proposal) };
    });
  }
  async build(input) {
    return this.#run(async () => {
      exact(input, ["proposalId"]);
      const proposal =
        validId(input.proposalId) && this.#proposals.get(input.proposalId);
      if (!proposal)
        throw Error("Unknown evidence proposal. Inspect a target first.");
      if (this.#builds.size >= 10)
        throw Error(
          "Ten builds are retained this session. Restart before building more.",
        );
      await this.#source(proposal);
      const approved = await this.confirm(
        "Build this reviewed original static prototype?",
        `Source: ${proposal.source.path}\nSource SHA-256: ${proposal.source.sha256}\n\nBlueprint:\n${JSON.stringify(proposal.blueprint, null, 2)}\n\nCreate a new scratch folder under Sebby's app data. Only Sebby's fixed original HTML/CSS template is generated. No imported code is run, no npm install/build is performed, and the selected workspace is not changed.`,
      );
      this.#assert();
      if (approved !== true) return { status: "denied" };
      await this.#source(proposal);
      const html = buildStaticPrototype(proposal.blueprint.sectionCount);
      const results = testStaticPrototype(
        html,
        proposal.blueprint.sectionCount,
      );
      await fs.mkdir(this.buildRoot, { recursive: true });
      this.#assert();
      await noLinks(this.buildRoot, true);
      if ((await fs.readdir(this.buildRoot)).length >= 20)
        throw Error(
          "Scratch build retention limit reached (20 folders). Review the evidence-builds folder before creating more.",
        );
      this.#assert();
      const id = randomUUID(),
        directory = path.join(this.buildRoot, id);
      await fs.mkdir(directory);
      await noLinks(directory, true);
      this.#assert();
      await fs.writeFile(path.join(directory, "index.html"), html, {
        flag: "wx",
        mode: 0o600,
      });
      this.#assert();
      const artifact = {
        id,
        proposalId: proposal.id,
        directory,
        path: "index.html",
        sha256: sha(html),
        bytes: Buffer.byteLength(html),
        tests: results,
        reportPath: "evidence.json",
      };
      await fs.writeFile(
        path.join(directory, artifact.reportPath),
        JSON.stringify(
          {
            format: "sebby-static-evidence",
            version: 1,
            proposal,
            artifact: {
              path: artifact.path,
              sha256: artifact.sha256,
              tests: results,
            },
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      this.#assert();
      this.#builds.set(id, artifact);
      return { status: "built", artifact: structuredClone(artifact) };
    });
  }
  async previewBuild(input) {
    return this.#run(async () => {
      exact(input, ["buildId"]);
      const artifact =
        validId(input.buildId) && this.#builds.get(input.buildId);
      if (!artifact)
        throw Error(
          "Unknown build. Build the reviewed static prototype first.",
        );
      if (typeof this.preview?.openArtifact !== "function")
        throw Error(
          "Static artifact preview is unavailable. The build remains saved.",
        );
      await noLinks(artifact.directory, true);
      const target = path.join(artifact.directory, artifact.path);
      const expected = await noLinks(target);
      if (expected.size > MAX_TEXT_BYTES)
        throw Error("Generated artifact exceeds the preview size limit.");
      const handle = await fs.open(target, "r");
      let contents;
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.ino !== expected.ino ||
          opened.dev !== expected.dev
        )
          throw Error("Generated artifact changed while opening.");
        const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            offset,
            buffer.length - offset,
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        contents = buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
      this.#assert();
      if (contents.length > MAX_TEXT_BYTES || sha(contents) !== artifact.sha256)
        throw Error(
          "Generated artifact changed; build a new reviewed prototype before previewing.",
        );
      const result = await this.preview.openArtifact({
        directory: artifact.directory,
        path: artifact.path,
        sha256: artifact.sha256,
      });
      this.#assert();
      return {
        status:
          result?.phase === "open" && result?.lastOutcome === "opened"
            ? "previewed"
            : "not-opened",
        preview: result,
      };
    });
  }
  async shutdown() {
    this.#closed = true;
  }
}

export function installEvidenceWorkflow({ register, ...options }) {
  const service = new EvidenceWorkflow(options);
  register("evidence-prepare", (input) => service.prepare(input));
  register("evidence-build", (input) => service.build(input));
  register("evidence-preview", (input) => service.previewBuild(input));
  return service;
}
