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
  const rootSession = await browser.newBrowserCDPSession();
  let commandId = 0;
  const sendWorker = (sessionId, method) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      const cleanup = () => {
        clearTimeout(timeout);
        rootSession.off('Target.receivedMessageFromTarget', receive);
      };
      const receive = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        cleanup();
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Search Worker did not respond to ${method}.`));
      }, 10_000);
      rootSession.on('Target.receivedMessageFromTarget', receive);
      rootSession
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method }),
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });

  const samples = [];
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('https://example.com/**', (route) => route.abort());
    await page.goto(fixture.url);
    await page.locator('.folder-tile').first().waitFor();
    await page.locator('#bookmark-search-input').fill('Performance Bookmark 10');
    await page.locator('.search-results').waitFor();
    await page.locator('#bookmark-search-input').press('Escape');
    const pageSession = await context.newCDPSession(page);
    const { targetInfos } = await rootSession.send('Target.getTargets');
    const target = targetInfos.find(
      (target) => target.type === 'worker' && target.url.includes('bookmark-search-worker'),
    );
    if (!target) throw new Error('The search Worker was not available for measurement.');
    const { sessionId } = await rootSession.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    const measure = async (phase) => {
      await pageSession.send('HeapProfiler.collectGarbage');
      await sendWorker(sessionId, 'HeapProfiler.collectGarbage');
      const main = await pageSession.send('Runtime.getHeapUsage');
      const worker = await sendWorker(sessionId, 'Runtime.getHeapUsage');
      const dom = await pageSession.send('Memory.getDOMCounters');
      samples.push({
        run,
        phase,
        mainHeapBytes: main.usedSize,
        searchHeapBytes: worker.usedSize,
        totalHeapBytes: main.usedSize + worker.usedSize,
        domNodes: dom.nodes,
      });
    };
    await measure('root');
    await page.locator('.folder-tile > button').first().click();
    await page.locator('.bookmark-card-shell').first().waitFor();
    await measure('folder');
    await page.locator('#folder-sidebar .root-folder').click();
    await page.getByRole('heading', { level: 1, name: 'Bookmarks', exact: true }).waitFor();
    await measure('returned');
    await context.close();
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = ['root', 'folder', 'returned'].map((phase) => {
    const selected = samples.filter((sample) => sample.phase === phase);
    return {
      phase,
      ...Object.fromEntries(
        ['mainHeapBytes', 'searchHeapBytes', 'totalHeapBytes', 'domNodes'].map((metric) => [
          metric,
          median(selected.map((sample) => sample[metric])),
        ]),
      ),
    };
  });
  console.log(
    JSON.stringify(
      {
        fixture: fixture.manifest,
        browserVersion: browser.version(),
        nodeVersion: process.version,
        runs: 3,
        summary,
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
