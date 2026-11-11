/**
 * The check that actually matters on mobile, where the mockup has no design to diff
 * against: does the page overflow sideways, and does anything stick out of the viewport?
 *
 *   node .dp-static-site/responsive-check.mjs http://127.0.0.1:4173
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const routes = ['/', '/about/', '/why-choose-us/', '/products-and-services/', '/contact/'];
const widths = [320, 390, 768, 1024];

const browser = await chromium.launch();
let failures = 0;

for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();

  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts?.ready);

    const result = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - vw;
      const culprits = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          // Ignore the fixed contact tab, which is meant to hang off the edge.
          if (getComputedStyle(el).position === 'fixed') continue;
          if (r.right > vw + 1 && r.width > 0) {
            culprits.push(`${el.tagName.toLowerCase()}.${el.className || '?'} → ${Math.round(r.right)}px`);
          }
        }
      }
      return { overflow, culprits: culprits.slice(0, 3) };
    }, width);

    const ok = result.overflow <= 0;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'OVER'} ${String(width).padStart(4)}px ${route.padEnd(26)}` +
        (ok ? '' : ` +${result.overflow}px  ${result.culprits.join(' | ')}`),
    );
  }
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} page/width combos overflow.` : '\nNo horizontal overflow anywhere.');
process.exit(failures ? 1 : 0);
