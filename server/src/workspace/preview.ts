import { parse, serialize } from "parse5";
import path from "node:path";
import type { ProjectDocument } from "./schema.js";

export function buildPreview(document: ProjectDocument, entry: string) {
  const source = document.files.find((f) => f.path === entry);
  if (!source || !entry.endsWith(".html"))
    throw new Error("Choose a saved HTML file");
  const doc: any = parse(source.content);
  const warnings: string[] = [];
  const local = (reference: string) => {
    if (!reference || /^[a-z][a-z0-9+.-]*:|^\/\/|^\//i.test(reference))
      return null;
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(entry), reference.split(/[?#]/)[0]),
    );
    return document.files.find((f) => f.path === resolved) || null;
  };
  const attr = (node: any, name: string) =>
    node.attrs?.find((a: any) => a.name === name)?.value;
  const text = (node: any, value: string) => {
    node.childNodes = [{ nodeName: "#text", value, parentNode: node }];
  };
  const walk = (parent: any) => {
    const next = [];
    for (const node of parent.childNodes || []) {
      if (
        ["base", "iframe", "frame", "object", "embed"].includes(node.tagName) ||
        (node.tagName === "meta" && attr(node, "http-equiv"))
      ) {
        warnings.push(`Removed ${node.tagName} from preview`);
        continue;
      }
      if (node.tagName === "script" && attr(node, "src")) {
        const file = local(attr(node, "src"));
        if (!file) {
          warnings.push(`Script unavailable: ${attr(node, "src")}`);
          continue;
        }
        node.attrs = node.attrs.filter(
          (a: any) => !["src", "integrity", "crossorigin"].includes(a.name),
        );
        node.attrs.push({
          name: "src",
          value: `data:text/javascript;base64,${Buffer.from(file.content).toString("base64")}`,
        });
        if (attr(node, "type") === "module")
          warnings.push(
            "Relative module imports are not bundled in browser preview. Use a build runner for bundled projects.",
          );
      }
      if (
        node.tagName === "link" &&
        attr(node, "rel")?.toLowerCase() === "stylesheet"
      ) {
        const file = local(attr(node, "href"));
        if (!file) {
          warnings.push(`Stylesheet unavailable: ${attr(node, "href")}`);
          continue;
        }
        node.tagName = node.nodeName = "style";
        node.attrs = [];
        text(node, file.content.replace(/<\/style/gi, "<\\/style"));
      }
      if (node.tagName === "a")
        node.attrs = node.attrs.filter(
          (a: any) => !["href", "target", "ping"].includes(a.name),
        );
      walk(node);
      if (node.content) walk(node.content);
      next.push(node);
    }
    parent.childNodes = next;
  };
  walk(doc);
  const head = doc.childNodes
    .find((n: any) => n.tagName === "html")
    ?.childNodes.find((n: any) => n.tagName === "head");
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  if (!head) throw new Error("Could not parse HTML");
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
  return { html: serialize(doc), warnings: [...new Set(warnings)] };
}
