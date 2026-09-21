import { chromium } from 'playwright';

import { startPerformanceBrowserFixture } from './performance-browser-fixture.mjs';

const fixture = await startPerformanceBrowserFixture();
const { url } = fixture;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const slowIndex of [false, true]) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.addInitScript(
        ({ slowIndex }) => {
          const BaseWorker = window.Worker;
          window.Worker = class extends BaseWorker {
            postMessage(message, ...args) {
              if (slowIndex && message.type === 'replace')
                setTimeout(() => super.postMessage(message, ...args), 1000);
              else super.postMessage(message, ...args);
            }
          };
          const observer = new MutationObserver(() => {
            if (!window.browsable && document.querySelector('.folder-tile'))
              window.browsable = performance.now();
          });
          observer.observe(document, { childList: true, subtree: true });
        },
        { slowIndex },
      );
      await page.goto(url);
      await page.locator('.folder-tile').first().waitFor();
      const cold = await page.evaluate(() => window.browsable);
      await page.locator('#bookmark-search-input').fill('Performance Bookmark 10');
      await page.locator('.search-results').waitFor();
      await page.reload();
      await page.locator('.folder-tile').first().waitFor();
      samples.push({ cold, warm: await page.evaluate(() => window.browsable) });
      await context.close();
    }
    const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(
      JSON.stringify(
        {
          fixtureCase: 'hierarchy',
          bookmarks: fixture.manifest.bookmarks,
          folders: fixture.manifest.folders,
          indexDelayMs: slowIndex ? 1000 : 0,
          medianColdBrowseMs: median(samples.map((sample) => sample.cold)),
          medianWarmBrowseMs: median(samples.map((sample) => sample.warm)),
          samples,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser?.close();
  await fixture.close();
}
