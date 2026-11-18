// Capture des éléments #shot-* d'un prototype .dc.html servi en local.
// Usage : PKGS=<dossier des paquets npm> node cap.js <fichier> <dossier de sortie> <échelle> [préfixe]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const [file, outdir, scale, prefix = ''] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1700, height: 1100 }, deviceScaleFactor: +scale || 1 });
  await ctx.route(/unpkg\.com\//, (r) => {
    const m = r.request().url().match(/unpkg\.com\/(@?[^@]+)@([^/]+)\/([^?]*)/);
    if (!m) return r.abort();
    const fp = path.join(process.env.PKGS, (m[1] + '@' + m[2]).replace('/', '_'), 'package', m[3]);
    return fs.existsSync(fp) ? r.fulfill({ path: fp }) : r.abort();
  });
  await ctx.route(/static\.krcg\.org\//, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto('http://127.0.0.1:8765/' + encodeURIComponent(file), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  const ids = await p.$$eval('[id^="shot-"]', (els, pre) => els.map((e) => e.id).filter((id) => !pre || id.startsWith('shot-' + pre)), prefix);
  for (const id of ids) {
    await p.locator(`[id="${id}"]`).screenshot({ path: path.join(outdir, id.slice(5) + '.png') });
  }
  console.log(JSON.stringify({ count: ids.length, errs }));
  await b.close();
})();
