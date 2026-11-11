/**
 * Minimal static server for the exported site. Node only — no extra dependency.
 *   node .dp-static-site/serve.mjs [dir] [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'out');
const port = Number(process.argv[3] ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function resolveFile(urlPath) {
  const target = path.resolve(path.join(root, urlPath));
  if (target !== root && !target.startsWith(root + path.sep)) return null; // no traversal
  try {
    const info = await stat(target);
    if (info.isDirectory()) return path.join(target, 'index.html');
    return target;
  } catch {
    return target.endsWith('.html') ? null : `${target}.html`;
  }
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = await resolveFile(urlPath);
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
