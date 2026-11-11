/**
 * Compare geometry between the mockup and the built page.
 *
 * Screenshot diffs tell you WHERE pages disagree; this tells you WHY, by reading the
 * computed box of the same selector on both sides. Run it whenever a diff region is
 * not obviously a colour or a font.
 *
 *   node .dp-static-site/probe.mjs <mockupUrl> <builtUrl> [width]
 */
import { chromium } from 'playwright';

const [mockupUrl, builtUrl, widthArg, selectorArg] = process.argv.slice(2);
const width = Number(widthArg ?? 1440);

const SELECTORS = selectorArg
  ? selectorArg.split(',').map((s) => s.trim()).filter(Boolean)
  : [
  'header',
  '.header-inner',
  '.logo',
  'nav',
  '.hero',
  '.hero-content',
  '.hero-content h1',
  '.hero-cta',
  '.welcome',
  '.welcome h2',
  '.industries',
  '.industries-grid',
  '.industry-card',
  '.video-about',
  '.video-box',
  '.about-text h2',
  '.service',
  '.service-img',
  '.learn-more',
  '.learn-card',
  '.cta-banner',
  'footer',
  '.footer-top',
  ];

async function measure(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts?.ready);

  const data = await page.evaluate((selectors) => {
    const out = {};
    for (const sel of selectors) {
      // The mockup keeps five page copies in the DOM; only the visible one counts.
      const nodes = [...document.querySelectorAll(sel)].filter(
        (n) => n.getClientRects().length > 0,
      );
      const el = nodes[0];
      if (!el) {
        out[sel] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[sel] = {
        x: Math.round(r.x),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
        font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
        color: cs.color,
        bg: cs.backgroundColor,
        count: nodes.length,
      };
    }
    return out;
  }, SELECTORS);

  await browser.close();
  return data;
}

const [a, b] = await Promise.all([measure(mockupUrl), measure(builtUrl)]);

const fmt = (v) => (v ? `${v.x},${v.y} ${v.w}x${v.h}` : 'MISSING');
let issues = 0;

console.log(`\n${'selector'.padEnd(22)} ${'mockup'.padEnd(22)} ${'built'.padEnd(22)} delta`);
console.log('-'.repeat(84));

for (const sel of SELECTORS) {
  const m = a[sel];
  const c = b[sel];
  let delta = '';
  if (!m || !c) {
    delta = 'PRESENCE';
  } else {
    const d = { x: c.x - m.x, y: c.y - m.y, w: c.w - m.w, h: c.h - m.h };
    const parts = Object.entries(d)
      .filter(([, v]) => Math.abs(v) > 1)
      .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
    if (m.font !== c.font) parts.push(`font ${m.font} -> ${c.font}`);
    if (m.color !== c.color) parts.push(`color ${m.color} -> ${c.color}`);
    if (m.count !== c.count) parts.push(`count ${m.count} -> ${c.count}`);
    delta = parts.join(' ');
  }
  if (delta) issues++;
  console.log(`${sel.padEnd(22)} ${fmt(m).padEnd(22)} ${fmt(c).padEnd(22)} ${delta}`);
}

console.log(`\n${issues} selector(s) differ.`);
