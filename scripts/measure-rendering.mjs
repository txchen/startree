import { chromium } from 'playwright';

import { startPerformanceBrowserFixture } from './performance-browser-fixture.mjs';

const fixtureCase = process.argv[2] ?? 'hierarchy';
if (!['hierarchy', 'concentration'].includes(fixtureCase)) {
  throw new Error('Choose hierarchy or concentration.');
}
const fixture = await startPerformanceBrowserFixture(fixtureCase);
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const samples = [];
  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('https://example.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.folder-tile')) {
          window.__browseReadyMs = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto(fixture.url);
    await page.locator('.folder-tile').first().waitFor();
    const coldBrowseMs = await page.evaluate(() => window.__browseReadyMs);
    await page.locator('#bookmark-search-input').fill('Performance Bookmark 10');
    await page.locator('.search-results').waitFor();
    await page.locator('#bookmark-search-input').press('Escape');
    const folderPaintMs = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (!document.querySelector('.bookmark-card-shell')) return;
            observer.disconnect();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - started)),
            );
          });
          observer.observe(document, { childList: true, subtree: true });
          document.querySelector('.folder-tile > button').click();
        }),
    );
    const renderedCards = await page.locator('.bookmark-card-shell').count();
    await page.locator('#folder-sidebar .root-folder').click();
    await page.getByRole('heading', { level: 1, name: 'Bookmarks', exact: true }).waitFor();
    await page.reload();
    await page.locator('.folder-tile').first().waitFor();
    const warmBrowseMs = await page.evaluate(() => window.__browseReadyMs);
    samples.push({ coldBrowseMs, warmBrowseMs, folderPaintMs, renderedCards });
    await context.close();
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    JSON.stringify(
      {
        fixture: fixture.manifest,
        browserVersion: browser.version(),
        runs: samples.length,
        summary: Object.fromEntries(
          Object.keys(samples[0]).map((metric) => [
            metric,
            median(samples.map((sample) => sample[metric])),
          ]),
        ),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await fixture.close();
}
