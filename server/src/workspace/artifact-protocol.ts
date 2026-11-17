import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectDocument } from "./schema.js";
export const ARTIFACT_LIMITS = {
  files: 200,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  transportBytes: 12 * 1024 * 1024,
};
export function artifactPath(value: string) {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").length <= 12 &&
    value
      .split("/")
      .every(
        (p) =>
          /^[a-zA-Z0-9_@.()+ -]+$/.test(p) &&
          p !== "." &&
          p !== ".." &&
          !/[ .]$/.test(p) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p) &&
          ![".git", "node_modules"].includes(p.toLowerCase()),
      )
  );
}
export function outputDirectory(document: ProjectDocument) {
  let pkg: any;
  try {
    pkg = JSON.parse(
      document.files.find((f) => f.path === "package.json")?.content || "{}",
    );
  } catch {
    throw new Error("Invalid package.json");
  }
  const directory = pkg?.sebby?.outputDirectory ?? "dist";
  if (typeof directory !== "string" || !artifactPath(directory))
    throw new Error(
      "sebby.outputDirectory must be a relative output folder without traversal",
    );
  return directory;
}
export function artifactMime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    (
      {
        html: "text/html; charset=utf-8",
        css: "text/css; charset=utf-8",
        js: "text/javascript; charset=utf-8",
        mjs: "text/javascript; charset=utf-8",
        json: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        wasm: "application/wasm",
        glb: "model/gltf-binary",
        txt: "text/plain; charset=utf-8",
        map: "application/json",
      } as Record<string, string>
    )[ext || ""] || "application/octet-stream"
  );
}
const rawSchema = z
  .object({
    version: z.literal(1),
    outputDirectory: z.string().refine(artifactPath),
    files: z
      .array(
        z
          .object({
            path: z.string().refine(artifactPath),
            base64: z
              .string()
              .max(Math.ceil(ARTIFACT_LIMITS.fileBytes / 3) * 4),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(ARTIFACT_LIMITS.files),
  })
  .strict();
export type ArtifactFile = {
  path: string;
  bytes: number;
  sha256: string;
  mime: string;
  data: Buffer;
};
export type ValidatedArtifacts = {
  outputDirectory: string;
  files: ArtifactFile[];
  totalBytes: number;
  manifestHash: string;
};
export function validateArtifacts(value: unknown): ValidatedArtifacts {
  const raw = rawSchema.parse(value);
  const paths = raw.files.map((f) => f.path.toLowerCase()),
    seen = new Set(paths);
  if (
    seen.size !== paths.length ||
    paths.some((p) =>
      p
        .split("/")
        .slice(0, -1)
        .some((_, i, parts) => seen.has(parts.slice(0, i + 1).join("/"))),
    )
  )
    throw new Error("Build output paths collide");
  let totalBytes = 0;
  const files = raw.files
    .map((file) => {
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          file.base64,
        )
      )
        throw new Error("Invalid build output encoding");
      const data = Buffer.from(file.base64, "base64");
      if (
        data.toString("base64") !== file.base64 ||
        data.length > ARTIFACT_LIMITS.fileBytes
      )
        throw new Error("Build output exceeds file limit");
      totalBytes += data.length;
      if (totalBytes > ARTIFACT_LIMITS.totalBytes)
        throw new Error("Build outputs exceed total size limit");
      const sha256 = createHash("sha256").update(data).digest("hex");
      if (sha256 !== file.sha256)
        throw new Error("Build output hash does not match");
      return {
        path: file.path,
        bytes: data.length,
        sha256,
        mime: artifactMime(file.path),
        data,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifestHash = createHash("sha256")
    .update(
      JSON.stringify({
        outputDirectory: raw.outputDirectory,
        files: files.map(({ path, bytes, sha256 }) => ({
          path,
          bytes,
          sha256,
        })),
      }),
    )
    .digest("hex");
  return {
    outputDirectory: raw.outputDirectory,
    files,
    totalBytes,
    manifestHash,
  };
}
// Constant trusted guest code, also exercised against filesystem fixtures. No project module is imported.
export const COLLECT_OUTPUT_SOURCE = String.raw`
async function collectOutput(root, outputDirectory) {
 const fs=await import('node:fs/promises'),path=await import('node:path'),{constants}=await import('node:fs'),{createHash}=await import('node:crypto');
 const valid=(p)=>typeof p==='string'&&p.length>0&&p.length<=240&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').length<=12&&p.split('/').every(s=>/^[a-zA-Z0-9_@.()+ -]+$/.test(s)&&s!=='.'&&s!=='..'&&!/[ .]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(s)&&!['.git','node_modules'].includes(s.toLowerCase()));
 if(!valid(outputDirectory))throw new Error('Invalid output directory');
 const base=await fs.realpath(root),directory=path.join(base,outputDirectory);
 let stat;try{stat=await fs.lstat(directory);}catch(e){if(e.code==='ENOENT')return {version:1,outputDirectory,files:[]};throw e;}
 if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('Output directory must be a regular directory');
 let entries=0,total=0;const files=[];
 const inside=(p)=>p===directory||p.startsWith(directory+path.sep);
 async function walk(current,relative,depth) {
  if(depth>12||!inside(await fs.realpath(current)))throw new Error('Output directory exceeds collection bounds');
  for(const name of (await fs.readdir(current)).sort()) {
   if(++entries>512)throw new Error('Too many output entries');
   const rel=relative?relative+'/'+name:name;if(!valid(rel))throw new Error('Invalid output path');
   const filename=path.join(current,name),s=await fs.lstat(filename);
   if(s.isSymbolicLink())throw new Error('Output links are not supported');
   if(s.isDirectory()){await walk(filename,rel,depth+1);continue;}
   if(!s.isFile()||s.nlink!==1||files.length>=200)throw new Error('Output is not a bounded regular file');
   const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try {
    const opened=await handle.stat();
    if(!opened.isFile()||opened.nlink!==1||!inside(await fs.realpath('/proc/self/fd/'+handle.fd)))throw new Error('Output file escaped its directory');
    if(opened.size>2097152||total+opened.size>8388608)throw new Error('Build output exceeds size limits');
    const data=Buffer.alloc(Math.min(2097152,8388608-total)+1);let size=0;
    while(size<data.length){const read=await handle.read(data,size,data.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await handle.stat();if(size>2097152||total+size>8388608||after.nlink!==1||after.size!==size||!inside(await fs.realpath('/proc/self/fd/'+handle.fd)))throw new Error('Build output changed or exceeded limits during collection');
    const content=data.subarray(0,size);total+=size;files.push({path:rel,base64:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')});
   } finally {await handle.close();}
  }
 }
 await walk(directory,'',0);return {version:1,outputDirectory,files};
}
`;
