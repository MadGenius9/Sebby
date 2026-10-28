import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { sanitizeStaticDocument } from "../electron/preview-sanitize.mjs";
function elements(html) {
  const out = [];
  function walk(n) {
    if (n.tagName) out.push(n);
    for (const c of n.childNodes || []) walk(c);
  }
  walk(parse(html, { scriptingEnabled: false }));
  return out;
}
test("static subset removes resource hints, scripts, SVG/MathML, embeds, redirects and executable attributes", () => {
  const input = `<link rel=preconnect href=https://other.test><meta http-equiv=refresh content="0;url=https://other.test"><base href=https://other.test><script>throw 1</script><svg><foreignObject><div onload=x>bad</div></foreignObject></svg><math><mtext>bad</mtext></math><iframe srcdoc="<script>x</script>"></iframe><object data=file:///private></object><div id=visible class=card style="color:red" onclick="x()">Hello</div><a href=https://other.test ping=https://other.test>link</a><img src=https://other.test srcset="https://other.test 1x" onerror=x><input type=file><form action=https://other.test>secret</form>`;
  const result = sanitizeStaticDocument(input),
    nodes = elements(result.html);
  assert.ok(result.removed > 10);
  assert.ok(
    !nodes.some((n) =>
      [
        "script",
        "link",
        "meta",
        "base",
        "svg",
        "math",
        "iframe",
        "object",
        "form",
      ].includes(n.tagName),
    ),
  );
  assert.ok(
    !nodes
      .flatMap((n) => n.attrs)
      .some((a) => /^(on|href|src|ping|action)/.test(a.name)),
  );
  assert.ok(result.html.includes("Hello"));
  assert.ok(result.html.includes("color:red"));
  const field = nodes.find((n) => n.tagName === "input");
  assert.ok(field.attrs.some((a) => a.name === "disabled"));
  assert.equal(field.attrs.find((a) => a.name === "type").value, "text");
});
test("malformed and noscript markup is reparsed without creating resource-bearing elements", () => {
  const result = sanitizeStaticDocument(
    `<noscript><link rel=dns-prefetch href=//other.test></noscript><table><svg><style><img src=x onerror=x></style></svg></table><style>body{color:blue}</style><p title="&quot; onmouseover=x">Text</p>`,
  );
  const nodes = elements(result.html);
  assert.ok(
    !nodes.some(
      (n) =>
        n.tagName === "link" ||
        n.namespaceURI !== "http://www.w3.org/1999/xhtml",
    ),
  );
  assert.ok(
    !nodes
      .flatMap((n) => n.attrs)
      .some((a) => a.name.startsWith("on") || a.name === "src"),
  );
  assert.ok(result.html.includes("color:blue"));
});
test("size and markup depth limits reject pathological static documents", () => {
  assert.throws(
    () => sanitizeStaticDocument("x".repeat(256 * 1024 + 1)),
    /limit/,
  );
  assert.throws(
    () => sanitizeStaticDocument("<br>".repeat(2001)),
    /complexity/,
  );
  assert.throws(
    () =>
      sanitizeStaticDocument("<div>".repeat(110) + "x" + "</div>".repeat(110)),
    /nesting/,
  );
});
