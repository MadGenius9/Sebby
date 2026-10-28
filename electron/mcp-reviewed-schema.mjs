/** Deliberately small JSON/schema subset; no code generation, references or regex evaluation. */
export function parseStrictJSON(text, max = 8192) {
  if (typeof text !== "string" || Buffer.byteLength(text) > max)
    throw Error("Bounded JSON required.");
  let pos = 0,
    nodes = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(text[pos] || "!")) pos++;
  };
  const string = () => {
    const start = pos++;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === '"') return JSON.parse(text.slice(start, pos));
      if (c === "\\") pos++;
    }
    throw Error("Invalid JSON string.");
  };
  function value(depth) {
    if (++nodes > 2000 || depth > 12) throw Error("JSON complexity limit.");
    ws();
    const c = text[pos];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      pos++;
      const obj = c === "{" ? Object.create(null) : [];
      const seen = new Set();
      ws();
      if (text[pos] === (c === "{" ? "}" : "]")) {
        pos++;
        return obj;
      }
      while (true) {
        ws();
        let key;
        if (c === "{") {
          if (text[pos] !== '"') throw Error("JSON key required.");
          key = string();
          if (
            seen.has(key) ||
            ["__proto__", "prototype", "constructor"].includes(key)
          )
            throw Error("Duplicate or unsafe JSON key.");
          seen.add(key);
          ws();
          if (text[pos++] !== ":") throw Error("Invalid JSON.");
        }
        const v = value(depth + 1);
        if (c === "{") obj[key] = v;
        else obj.push(v);
        ws();
        const next = text[pos++];
        if (next === (c === "{" ? "}" : "]")) return obj;
        if (next !== ",") throw Error("Invalid JSON.");
      }
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(pos),
      );
    if (!match) throw Error("Invalid JSON.");
    pos += match[0].length;
    const v = JSON.parse(match[0]);
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("Nonfinite JSON number.");
    return v;
  }
  const result = value(0);
  ws();
  if (pos !== text.length) throw Error("Trailing JSON.");
  return result;
}
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const fieldSecret = (key) =>
  /token|password|secret|credential|authorization|apikey|cookie|privatekey|authentication/i.test(
    key.replace(/[^a-z0-9]/gi, ""),
  );
export function rejectSecrets(value) {
  function scan(v) {
    if (
      typeof v === "string" &&
      /(?:\bsk-[a-zA-Z0-9_-]{12,}|\bgithub_pat_[\w]+|\bgh[pousr]_[\w]{12,}|\bBearer\s+\S+|-----BEGIN [^-]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.test(
        v,
      )
    )
      throw Error("Credential-like input is not allowed.");
    if (Array.isArray(v)) v.forEach(scan);
    else if (object(v))
      for (const [k, x] of Object.entries(v)) {
        if (fieldSecret(k)) throw Error("Credential fields are not allowed.");
        scan(x);
      }
  }
  scan(value);
}
export function validateSchema(schema) {
  if (Buffer.byteLength(JSON.stringify(schema)) > 16384)
    throw Error("Schema too large.");
  let nodes = 0;
  function visit(s, depth) {
    if (!object(s) || ++nodes > 100 || depth > 6)
      throw Error("Unsupported schema complexity.");
    const keys = [
      "type",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "minItems",
      "maxItems",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "enum",
      "description",
      "title",
      "$schema",
    ];
    if (Object.keys(s).some((k) => !keys.includes(k)))
      throw Error("Unsupported schema keyword.");
    if (
      s.$schema !== undefined &&
      s.$schema !== "https://json-schema.org/draft/2020-12/schema"
    )
      throw Error("Unsupported schema dialect.");
    if (
      ![
        "object",
        "array",
        "string",
        "number",
        "integer",
        "boolean",
        "null",
      ].includes(s.type)
    )
      throw Error("Explicit schema type required.");
    for (const k of ["description", "title"])
      if (
        s[k] !== undefined &&
        (typeof s[k] !== "string" || s[k].length > 2000)
      )
        throw Error("Invalid schema text.");
    if (
      s.enum !== undefined &&
      (!Array.isArray(s.enum) ||
        !s.enum.length ||
        s.enum.length > 30 ||
        s.enum.some((v) => v !== null && typeof v === "object"))
    )
      throw Error("Unsupported enum.");
    for (const k of ["minItems", "maxItems", "minLength", "maxLength"])
      if (
        s[k] !== undefined &&
        (!Number.isSafeInteger(s[k]) || s[k] < 0 || s[k] > 8192)
      )
        throw Error("Invalid schema bound.");
    for (const k of ["minimum", "maximum"])
      if (s[k] !== undefined && !Number.isFinite(s[k]))
        throw Error("Invalid number bound.");
    if (s.type === "object") {
      if (
        s.additionalProperties !== undefined &&
        s.additionalProperties !== false
      )
        throw Error("Open schema properties unsupported.");
      if (s.properties !== undefined && !object(s.properties))
        throw Error("Invalid properties.");
      const props = s.properties || {};
      if (Object.keys(props).length > 50) throw Error("Too many properties.");
      for (const [k, v] of Object.entries(props)) {
        if (
          fieldSecret(k) ||
          ["__proto__", "constructor", "prototype"].includes(k)
        )
          throw Error("Credential or unsafe schema property.");
        visit(v, depth + 1);
      }
      if (
        s.required !== undefined &&
        (!Array.isArray(s.required) ||
          s.required.some(
            (k) => typeof k !== "string" || !Object.hasOwn(props, k),
          ) ||
          new Set(s.required).size !== s.required.length)
      )
        throw Error("Invalid required properties.");
    } else if (
      s.properties !== undefined ||
      s.required !== undefined ||
      s.additionalProperties !== undefined
    )
      throw Error("Misplaced object schema fields.");
    if (s.type === "array") {
      visit(s.items, depth + 1);
    } else if (
      s.items !== undefined ||
      s.minItems !== undefined ||
      s.maxItems !== undefined
    )
      throw Error("Misplaced array schema fields.");
    if (
      s.type !== "string" &&
      (s.minLength !== undefined || s.maxLength !== undefined)
    )
      throw Error("Misplaced string schema fields.");
    if (
      !["number", "integer"].includes(s.type) &&
      (s.minimum !== undefined || s.maximum !== undefined)
    )
      throw Error("Misplaced numeric schema fields.");
  }
  visit(schema, 0);
  if (schema.type !== "object")
    throw Error("Tool arguments must be an object.");
  return schema;
}
export function validateArguments(schema, value) {
  rejectSecrets(value);
  function visit(s, v) {
    if (s.enum && !s.enum.some((x) => Object.is(x, v)))
      throw Error("Input not in enum.");
    if (s.type === "object") {
      if (!object(v)) throw Error("Object required.");
      const props = s.properties || {};
      if (
        Object.keys(v).some((k) => !Object.hasOwn(props, k)) ||
        (s.required || []).some((k) => !Object.hasOwn(v, k))
      )
        throw Error("Unexpected or missing input field.");
      for (const [k, x] of Object.entries(v)) visit(props[k], x);
    } else if (s.type === "array") {
      if (
        !Array.isArray(v) ||
        v.length > (s.maxItems ?? 100) ||
        v.length < (s.minItems ?? 0)
      )
        throw Error("Array bounds exceeded.");
      v.forEach((x) => visit(s.items, x));
    } else if (s.type === "null") {
      if (v !== null) throw Error("Null required.");
    } else if (s.type === "integer" || s.type === "number") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        (s.type === "integer" && !Number.isSafeInteger(v)) ||
        v < (s.minimum ?? -Infinity) ||
        v > (s.maximum ?? Infinity)
      )
        throw Error("Invalid numeric input.");
    } else if (typeof v !== s.type) throw Error("Invalid input type.");
    else if (
      s.type === "string" &&
      ([...v].length < (s.minLength ?? 0) ||
        [...v].length > (s.maxLength ?? 8192))
    )
      throw Error("String bounds exceeded.");
  }
  visit(schema, value);
  return value;
}
