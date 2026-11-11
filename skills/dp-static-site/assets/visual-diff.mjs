#!/usr/bin/env node
/**
 * visual-diff.mjs — prove the built site matches the original HTML mockup.
 *
 * Serves the mockup from its own directory (so relative assets resolve), opens both it
 * and the built page in the same browser at the same viewports, screenshots each, and
 * pixel-diffs them. Writes PNGs + a JSON summary and exits non-zero if any viewport is
 * over threshold.
 *
 *   node visual-diff.mjs --mockup ./mockup/index.html --built http://localhost:4173/
 *
 * Options
 *   --mockup <path|url>   Original HTML file (or a URL). Required.
 *   --built  <url>        Built site URL. Required.
 *   --out    <dir>        Output directory.            [.dp-static-site/diff]
 *   --widths <list>       Comma-separated viewports.   [390,768,1440]
 *   --threshold <pct>     Max differing pixels, %.     [0.5]
 *   --mask <selector>     Hide a node in BOTH pages before capture. Repeatable.
 *                         Use for clocks, random data, carousels — not for real diffs.
 *   --mask-mockup <sel>   Hide only in the mockup (e.g. a "design notes" overlay).
 *   --mask-built  <sel>   Hide only in the built page.
 *   --remove-built <sel>  display:none a node in the built page, so it takes NO layout
 *                         space. For deliberate additions that are not in the mockup
 *                         (a "form not wired up" notice, a cookie banner). Unlike
 *                         --mask this changes the layout, so it answers a different
 *                         question: "does everything ELSE still line up?" Always report
 *                         both numbers — the as-built one is the real result.
 *   --viewport-only       Capture the viewport instead of the full page.
 *   --settle <ms>         Extra wait after fonts/network settle. [400]
 *   --keep-open           Leave the browser open on failure (headed) for inspection.
 *
 * Requires: npm i -D playwright pixelmatch pngjs   +   npx playwright install chromium
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ args -- */

function parseArgs(argv) {
  const out = { widths: [390, 768, 1440], threshold: 0.5, settle: 400, out: '.dp-static-site/diff',
                mask: [], maskMockup: [], maskBuilt: [], removeBuilt: [], removeMockup: [],
                fullPage: true, keepOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--mockup':        out.mockup = next(); break;
      case '--built':         out.built = next(); break;
      case '--out':           out.out = next(); break;
      case '--widths':        out.widths = next().split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean); break;
      case '--threshold':     out.threshold = parseFloat(next()); break;
      case '--settle':        out.settle = parseInt(next(), 10); break;
      case '--mask':          out.mask.push(next()); break;
      case '--mask-mockup':   out.maskMockup.push(next()); break;
      case '--mask-built':    out.maskBuilt.push(next()); break;
      case '--remove-built':  out.removeBuilt.push(next()); break;
      case '--remove-mockup': out.removeMockup.push(next()); break;
      case '--viewport-only': out.fullPage = false; break;
      case '--keep-open':     out.keepOpen = true; break;
      case '-h': case '--help': out.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(2); }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.mockup || !args.built) {
  const self = path.basename(fileURLToPath(import.meta.url));
  console.log(`Usage: node ${self} --mockup <path|url> --built <url> [options]\n` +
              `See the header of this file for the full option list.`);
  process.exit(args.help ? 0 : 2);
}

/* ------------------------------------------------------------- deps check -- */

async function need(name, hint) {
  try { return await import(name); }
  catch {
    console.error(`\nMissing dependency: ${name}\n  ${hint}\n`);
    process.exit(3);
  }
}

const { chromium } = await need('playwright',
  'npm i -D playwright && npx playwright install chromium');
const pixelmatchMod = await need('pixelmatch', 'npm i -D pixelmatch');
const { PNG } = await need('pngjs', 'npm i -D pngjs');
const pixelmatch = pixelmatchMod.default ?? pixelmatchMod;

/* ---------------------------------------------------- static file server -- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};

/** Serve `root` on an ephemeral port. Returns { url, close }. */
async function serveDir(root) {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // Contain every request inside root — this server sees only local mockup files,
      // but a mockup can contain arbitrary hrefs, so refuse traversal outright.
      const target = path.join(root, rel);
      const resolved = path.resolve(target);
      if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      const file = existsSync(resolved) && (await import('node:fs')).statSync(resolved).isDirectory()
        ? path.join(resolved, 'index.html')
        : resolved;
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => server.close(r)),
  };
}

/* ------------------------------------------------------------- capturing -- */

async function capture(browser, url, width, { masks, removes = [], settle, fullPage }) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    // Deterministic capture: kill animations, freeze carousels, disable smooth scroll.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  // Fonts are the single biggest source of false diffs — wait for them explicitly.
  await page.evaluate(() => document.fonts?.ready);

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important; animation-delay: 0s !important;
        transition-duration: 0s !important; transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      html { scroll-behavior: auto !important; }
      ${masks.length ? `${masks.join(',')} { visibility: hidden !important; }` : ''}
      ${removes.length ? `${removes.join(',')} { display: none !important; }` : ''}
    `,
  });

  if (settle) await page.waitForTimeout(settle);

  const buf = await page.screenshot({ fullPage, animations: 'disabled', scale: 'css' });
  const fontsUsed = await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily);
  await context.close();
  return { png: PNG.sync.read(buf), fontFamily: fontsUsed };
}

/** Pad both images to the same canvas so a height difference is reported, not thrown. */
function align(a, b) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (src) => {
    if (src.width === width && src.height === height) return src;
    const dst = new PNG({ width, height });
    // Fill with opaque magenta so padded regions register as differences, loudly.
    for (let i = 0; i < dst.data.length; i += 4) {
      dst.data[i] = 255; dst.data[i + 1] = 0; dst.data[i + 2] = 255; dst.data[i + 3] = 255;
    }
    PNG.bitblt(src, dst, 0, 0, src.width, src.height, 0, 0);
    return dst;
  };
  return [pad(a), pad(b), width, height];
}

/* ------------------------------------------------------------------ main -- */

const outDir = path.resolve(args.out);
await mkdir(outDir, { recursive: true });

let mockupServer = null;
let mockupUrl = args.mockup;
if (!/^https?:\/\//i.test(args.mockup)) {
  // A single-file mockup may route its pages by hash (`mockup.html#about`). Split the
  // fragment off before touching the filesystem, then re-attach it to the served URL.
  const hashAt = args.mockup.indexOf('#');
  const filePart = hashAt === -1 ? args.mockup : args.mockup.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : args.mockup.slice(hashAt);

  const abs = path.resolve(filePart);
  if (!existsSync(abs)) { console.error(`Mockup not found: ${abs}`); process.exit(2); }
  const isFile = (await import('node:fs')).statSync(abs).isFile();
  const root = isFile ? path.dirname(abs) : abs;
  mockupServer = await serveDir(root);
  const base = isFile
    ? `${mockupServer.url}/${encodeURIComponent(path.basename(abs))}`
    : `${mockupServer.url}/`;
  mockupUrl = base + hash;
  console.log(`Serving mockup from ${root} -> ${mockupUrl}`);
}

const browser = await chromium.launch({ headless: !args.keepOpen });
const results = [];
let failed = false;

try {
  for (const width of args.widths) {
    const shot = (url, extraMask, removes) => capture(browser, url, width, {
      masks: [...args.mask, ...extraMask],
      removes,
      settle: args.settle,
      fullPage: args.fullPage,
    });

    const a = await shot(mockupUrl, args.maskMockup, args.removeMockup);
    const b = await shot(args.built, args.maskBuilt, args.removeBuilt);

    const [imgA, imgB, width_, height_] = align(a.png, b.png);
    const diff = new PNG({ width: width_, height: height_ });

    const differing = pixelmatch(imgA.data, imgB.data, diff.data, width_, height_, {
      threshold: 0.12,          // per-pixel colour tolerance; absorbs antialiasing
      includeAA: false,
      alpha: 0.25,
      diffMask: false,
    });

    const total = width_ * height_;
    const pct = (differing / total) * 100;
    const pass = pct <= args.threshold;
    if (!pass) failed = true;

    const base = path.join(outDir, `${width}`);
    await writeFile(`${base}-mockup.png`, PNG.sync.write(a.png));
    await writeFile(`${base}-built.png`, PNG.sync.write(b.png));
    await writeFile(`${base}-diff.png`, PNG.sync.write(diff));

    const heightDelta = a.png.height - b.png.height;

    results.push({
      width, pct: +pct.toFixed(3), differing, total, pass,
      mockupSize: [a.png.width, a.png.height],
      builtSize: [b.png.width, b.png.height],
      heightDelta,
      fontFamily: { mockup: a.fontFamily, built: b.fontFamily },
      fontMatch: a.fontFamily === b.fontFamily,
      diffImage: path.relative(process.cwd(), `${base}-diff.png`),
    });

    const flag = pass ? 'PASS' : 'FAIL';
    console.log(
      `${flag}  ${String(width).padStart(4)}px  ${pct.toFixed(2).padStart(6)}%  ` +
      `(${differing}/${total})  height ${a.png.height} vs ${b.png.height}` +
      (a.fontFamily === b.fontFamily ? '' : `  ** font mismatch **`)
    );
    if (a.fontFamily !== b.fontFamily) {
      console.log(`        mockup body font: ${a.fontFamily}`);
      console.log(`        built  body font: ${b.fontFamily}`);
    }
    if (Math.abs(heightDelta) > 8) {
      console.log(`        height differs by ${heightDelta}px — a section is missing, ` +
                  `extra, or mis-spaced. Look at the diff before touching colours.`);
    }
  }
} finally {
  if (!args.keepOpen || !failed) await browser.close();
  if (mockupServer) await mockupServer.close();
}

const summary = {
  generatedAt: new Date().toISOString(),
  mockup: args.mockup,
  built: args.built,
  threshold: args.threshold,
  masked: args.mask,
  fullPage: args.fullPage,
  pass: !failed,
  results,
};
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`\nPNGs and summary.json in ${path.relative(process.cwd(), outDir)}`);
console.log(failed
  ? 'RESULT: over threshold — open the -diff.png for the worst viewport and fix the largest region first.'
  : 'RESULT: match.');

process.exit(failed ? 1 : 0);
