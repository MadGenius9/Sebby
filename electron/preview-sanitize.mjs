import { parse, serialize } from "parse5";
const HTML = "http://www.w3.org/1999/xhtml";
const TAGS = new Set(
  "html head body title style main section article aside header footer nav h1 h2 h3 h4 h5 h6 p div span a strong em b i u s small mark pre code blockquote ol ul li dl dt dd table thead tbody tfoot tr th td caption colgroup col figure figcaption br hr details summary label button input textarea select option img".split(
    " ",
  ),
);
const ATTRS = new Set(
  "id class title lang dir role style width height colspan rowspan scope open start reversed type value checked selected placeholder rows cols alt".split(
    " ",
  ),
);
/** Conservative static document subset, not an interactive HTML runtime.
 * AST parsing defeats malformed markup/resource-hint tricks; CSP and native
 * permission/network policies remain mandatory independent defenses. */
export function sanitizeStaticDocument(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 256 * 1024)
    throw Error("Preview source exceeds limit.");
  if ((source.match(/</g) || []).length > 2000)
    throw Error("Preview markup complexity exceeds limit.");
  const document = parse(source, { scriptingEnabled: false });
  let removed = 0;
  const visit = (node, depth = 0) => {
    if (depth > 100) throw Error("Preview markup nesting exceeds limit.");
    if (node.childNodes)
      node.childNodes = node.childNodes.filter((child) => {
        if (child.nodeName === "#comment") {
          removed++;
          return false;
        }
        if (
          child.tagName &&
          (child.namespaceURI !== HTML || !TAGS.has(child.tagName))
        ) {
          removed++;
          return false;
        }
        if (child.attrs) {
          child.attrs = child.attrs.filter((attr) => {
            const allowed =
              !attr.namespace &&
              (ATTRS.has(attr.name) || /^aria-[a-z-]+$/.test(attr.name));
            if (!allowed) removed++;
            return allowed;
          });
          // No account entry, file picker, form submission or native controls in a static preview.
          if (
            ["input", "button", "textarea", "select", "option"].includes(
              child.tagName,
            )
          ) {
            child.attrs.push({ name: "disabled", value: "" });
            if (child.tagName === "input")
              child.attrs = child.attrs
                .filter((a) => a.name !== "type")
                .concat({ name: "type", value: "text" });
          }
        }
        visit(child, depth + 1);
        return true;
      });
  };
  visit(document);
  return { html: serialize(document), removed };
}
