import path from "node:path";
import { parse, serialize } from "parse5";
import { context, type Loader, type Plugin } from "esbuild";
import {
  artifactMime,
  artifactPath,
  type ArtifactFile,
} from "./artifact-protocol.js";
let preparing = false;
export async function compileBuildPreview(
  files: Pick<ArtifactFile, "path" | "data">[],
) {
  if (preparing)
    throw new Error(
      "Another build preview is being prepared. Try again shortly.",
    );
  preparing = true;
  try {
    return await compile(files);
  } finally {
    preparing = false;
  }
}
async function compile(files: Pick<ArtifactFile, "path" | "data">[]) {
  const map = new Map(files.map((f) => [f.path, f.data]));
  if (!map.has("index.html"))
    throw new Error(
      "This build has no index.html. Download its files instead.",
    );
  const deadline = Date.now() + 10000,
    warnings: string[] = [
      "Preview runs in a sandboxed frame with API fetches and external resources restricted. Client-side URL routing and runtime-created asset URLs may need separate preview hosting.",
    ];
  const resolve = (reference: string, importer: string) => {
    if (/^(?:https?:|file:|node:|\/\/)/i.test(reference))
      throw new Error("External resources are not supported by this preview");
    let raw: string;
    try {
      raw = decodeURIComponent(reference.split(/[?#]/)[0]);
    } catch {
      throw new Error("Invalid resource URL");
    }
    const key = path.posix.normalize(
      raw.startsWith("/")
        ? raw.slice(1)
        : path.posix.join(path.posix.dirname(importer), raw),
    );
    if (!artifactPath(key) || !map.has(key))
      throw new Error(
        `Build resource is unavailable: ${reference.slice(0, 180)}`,
      );
    return key;
  };
  let bundles = 0,
    previewBytes = map.get("index.html")!.length,
    moduleEntries = 0;
  const budget = (size: number) => {
    previewBytes += size;
    if (previewBytes > 16 * 1024 * 1024)
      throw new Error("Build preview document is too large");
  };
  async function bundle(
    entry: string,
    inline?: { content: string; loader: "js" | "css" },
  ) {
    if (++bundles > 48 || Date.now() > deadline)
      throw new Error("Build preview exceeds compilation limits");
    const virtual = inline
      ? new Map([...map, [entry, Buffer.from(inline.content)]])
      : map;
    const plugin: Plugin = {
      name: "saved-build-files",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point")
            return { path: entry, namespace: "saved-build" };
          if (/^(?:https?:|file:|node:|\/\/)/i.test(args.path))
            return {
              errors: [
                {
                  text: "External resources are not supported by this preview",
                },
              ],
            };
          if (args.path.startsWith("data:"))
            return { path: args.path, external: true };
          if (
            !args.path.startsWith(".") &&
            !args.path.startsWith("/") &&
            !["url-token", "import-rule"].includes(args.kind)
          )
            return {
              errors: [
                {
                  text: "Unbundled package imports are not supported in build previews",
                },
              ],
            };
          try {
            return {
              path: resolve(args.path, args.importer || entry),
              namespace: "saved-build",
            };
          } catch (e) {
            return { errors: [{ text: (e as Error).message }] };
          }
        });
        build.onLoad({ filter: /.*/, namespace: "saved-build" }, (args) => {
          const data = virtual.get(args.path);
          if (!data) return { errors: [{ text: "Build resource not found" }] };
          const ext = path.posix.extname(args.path).toLowerCase();
          const loader: Loader =
            inline && args.path === entry
              ? inline.loader
              : ext === ".css"
                ? "css"
                : ext === ".json"
                  ? "json"
                  : [".js", ".mjs", ".cjs"].includes(ext)
                    ? "js"
                    : "dataurl";
          return { contents: data, loader, resolveDir: "/" };
        });
      },
    };
    const ctx = await context({
      entryPoints: [entry],
      bundle: true,
      write: false,
      outdir: "/virtual-preview",
      platform: "browser",
      format: "iife",
      target: "es2022",
      plugins: [plugin],
      tsconfigRaw: "{}",
      logLevel: "silent",
      metafile: false,
      sourcemap: false,
      legalComments: "inline",
    });
    const timeout = setTimeout(
      () => {
        void ctx.cancel().catch(() => {});
      },
      Math.max(1, deadline - Date.now()),
    );
    try {
      const result = await ctx.rebuild();
      if (Date.now() > deadline)
        throw new Error("Build preview compilation timed out");
      if (result.warnings.some((w) => w.id === "empty-import-meta"))
        throw new Error(
          "This build uses import.meta and needs separate preview hosting. Download the build files instead.",
        );
      warnings.push(...result.warnings.map((w) => w.text).slice(0, 10));
      budget(
        (result.outputFiles || []).reduce((n, f) => n + f.contents.length, 0),
      );
      const javascript =
        result.outputFiles
          ?.filter((f) => f.path.endsWith(".js"))
          .map((f) => f.text)
          .join("\n") || "";
      const css =
        result.outputFiles
          ?.filter((f) => f.path.endsWith(".css"))
          .map((f) => f.text)
          .join("\n") || "";
      return { javascript, css };
    } finally {
      clearTimeout(timeout);
      await ctx.dispose();
    }
  }
  const document: any = parse(map.get("index.html")!.toString("utf8"));
  const html = document.childNodes.find((n: any) => n.tagName === "html"),
    head = html.childNodes.find((n: any) => n.tagName === "head"),
    body = html.childNodes.find((n: any) => n.tagName === "body");
  const delayed: any[] = [],
    styles: any[] = [];
  let inlineId = 0;
  const inlineName = (extension: string) => {
    let name: string;
    do {
      name = `__inline_${inlineId++}.${extension}`;
    } while (map.has(name));
    return name;
  };
  const attr = (n: any, k: string) =>
    n.attrs?.find((a: any) => a.name === k)?.value;
  const setText = (n: any, value: string) => {
    n.childNodes = [{ nodeName: "#text", value, parentNode: n }];
  };
  const styleNode = (css: string) => ({
    nodeName: "style",
    tagName: "style",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    attrs: [],
    childNodes: [
      { nodeName: "#text", value: css.replace(/<\/style/gi, "<\\/style") },
    ],
    parentNode: head,
  });
  const dataURL = (reference: string) => {
    if (reference.startsWith("data:")) return reference;
    const key = resolve(reference, "index.html");
    budget(Math.ceil(map.get(key)!.length / 3) * 4);
    return `data:${artifactMime(key).split(";")[0]};base64,${map.get(key)!.toString("base64")}`;
  };
  async function walk(parent: any) {
    const next = [];
    for (const node of parent.childNodes || []) {
      if (
        ["base", "iframe", "frame", "object", "embed"].includes(node.tagName) ||
        (node.tagName === "meta" && attr(node, "http-equiv"))
      )
        continue;
      if (node.tagName === "script") {
        const src = attr(node, "src"),
          module = attr(node, "type") === "module";
        if (module) {
          if (++moduleEntries > 1)
            throw new Error(
              "Multiple module entry points need separate preview hosting",
            );
          const entry = src
            ? resolve(src, "index.html")
            : inlineName("js");
          const compiled = await bundle(
            entry,
            src
              ? undefined
              : {
                  content: (node.childNodes || [])
                    .map((n: any) => n.value || "")
                    .join(""),
                  loader: "js",
                },
          );
          node.attrs = [];
          setText(
            node,
            compiled.javascript.replace(/<\/script/gi, "<\\/script"),
          );
          if (compiled.css) styles.push(styleNode(compiled.css));
          delayed.push(node);
          continue;
        }
        if (src) {
          const key = resolve(src, "index.html");
          budget(Math.ceil(map.get(key)!.length / 3) * 4);
          node.attrs = node.attrs.filter(
            (a: any) => !["src", "integrity", "crossorigin"].includes(a.name),
          );
          node.attrs.push({
            name: "src",
            value: `data:text/javascript;base64,${map.get(key)!.toString("base64")}`,
          });
        }
      }
      if (node.tagName === "link") {
        const rel = attr(node, "rel")?.toLowerCase();
        if (
          rel === "modulepreload" ||
          rel === "preload" ||
          rel === "preconnect" ||
          rel === "dns-prefetch"
        )
          continue;
        if (rel === "stylesheet") {
          const compiled = await bundle(
            resolve(attr(node, "href") || "", "index.html"),
          );
          node.nodeName = node.tagName = "style";
          node.attrs = [];
          setText(node, compiled.css.replace(/<\/style/gi, "<\\/style"));
          node.previewCompiled = true;
        } else if (attr(node, "href")) {
          try {
            node.attrs.find((a: any) => a.name === "href").value = dataURL(
              attr(node, "href"),
            );
          } catch {
            continue;
          }
        }
      }
      if (node.tagName === "style" && !node.previewCompiled) {
        const content = (node.childNodes || [])
          .map((n: any) => n.value || "")
          .join("");
        const compiled = await bundle(inlineName("css"), {
          content,
          loader: "css",
        });
        setText(node, compiled.css.replace(/<\/style/gi, "<\\/style"));
      }
      for (const attribute of node.attrs || []) {
        if (
          attribute.name === "src" &&
          ["img", "source", "audio", "video"].includes(node.tagName)
        )
          attribute.value = dataURL(attribute.value);
        if (attribute.name === "poster" && node.tagName === "video")
          attribute.value = dataURL(attribute.value);
      }
      if (node.tagName === "a")
        node.attrs = node.attrs.filter(
          (a: any) => !["href", "target", "ping"].includes(a.name),
        );
      if (node.attrs)
        node.attrs = node.attrs.filter(
          (a: any) => !["srcset", "imagesrcset", "formaction"].includes(a.name),
        );
      await walk(node);
      if (node.content) await walk(node.content);
      next.push(node);
    }
    parent.childNodes = next;
  }
  await walk(document);
  head.childNodes.push(...styles);
  for (const script of delayed) {
    script.parentNode = body;
    body.childNodes.push(script);
  }
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  head.childNodes.unshift({
    nodeName: "meta",
    tagName: "meta",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    attrs: [
      { name: "http-equiv", value: "Content-Security-Policy" },
      { name: "content", value: policy },
    ],
    childNodes: [],
    parentNode: head,
  });
  const result = serialize(document);
  if (Buffer.byteLength(result) > 16 * 1024 * 1024)
    throw new Error("Build preview document is too large");
  return { html: result, warnings: [...new Set(warnings)].slice(0, 20) };
}
