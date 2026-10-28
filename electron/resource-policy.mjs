import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
/** Deny remote requests and local files outside the built renderer. */
export async function allowedResource(rawURL, rendererRoot, dev = false) {
  try {
    const url = new URL(rawURL);
    if (['data:', 'blob:'].includes(url.protocol)) return true;
    if (dev && ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === '5173' && !url.username && !url.password) return true;
    if (url.protocol !== 'file:') return false;
    const candidate = fileURLToPath(url);
    if (!inside(rendererRoot, candidate)) return false;
    // The build directory is immutable while the app is running; resolve links
    // as well as lexical paths to prevent a packaged asset linking outside it.
    const [root, resolved] = await Promise.all([fs.realpath(rendererRoot), fs.realpath(candidate)]);
    return inside(root, resolved);
  } catch { return false; }
}
