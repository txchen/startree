import assert from 'node:assert/strict';
import { assertAccessible } from './local-worker-acceptance.mjs';

export const verifyRecentBookmarks = async (page) => {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const context = page.context();
  const base = new URL(page.url()).origin;
  const cards = page.locator('.bookmark-card-shell');
  const first = await cards.nth(0).getAttribute('data-bookmark-id');
  const second = await cards.nth(1).getAttribute('data-bookmark-id');
  const waitForOrder = async (target, ids) => {
    await target.waitForFunction(
      (expected) =>
        JSON.stringify(
          [...document.querySelectorAll('[data-recent-id]')].map((item) => item.dataset.recentId),
        ) === JSON.stringify(expected),
      ids,
    );
    if (ids.length) {
      const disclosure = target.locator('.recent-disclosure');
      if (!(await disclosure.evaluate((element) => element.open))) {
        await disclosure.locator('summary').click();
      }
    }
  };
  const external = (url) => url.origin !== base;
  const serveDestination = (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Destination</title>' });
  await context.route(external, serveDestination);
  const openInNewTab = async (link, options = { modifiers: ['Control'] }) => {
    const opened = context.waitForEvent('page');
    await link.click(options);
    const destination = await opened;
    await destination.waitForLoadState('domcontentloaded');
    await destination.close();
  };
  let other;
  try {
    await openInNewTab(cards.nth(0).locator('a'));
    await waitForOrder(page, [first]);
    await openInNewTab(cards.nth(1).locator('a'), { button: 'middle' });
    await waitForOrder(page, [second, first]);
    await openInNewTab(page.locator('[data-recent-id] a').nth(1));
    await waitForOrder(page, [first, second]);
    await page.reload();
    await waitForOrder(page, [first, second]);
    await cards.nth(1).locator('a').click();
    await page.waitForURL((url) => url.origin !== base);
    await page.goBack();
    await waitForOrder(page, [second, first]);
    const search = page.getByPlaceholder('Search titles, URLs, Tags, and Notes');
    await search.fill(await cards.nth(0).locator('strong').textContent());
    await openInNewTab(page.locator(`.search-results a[data-open-bookmark-id="${first}"]`));
    await search.fill('');
    await waitForOrder(page, [first, second]);
    await cards.nth(1).locator('.bookmark-pin-button').click();
    await page.locator(`[data-pin-id="${second}"]`).waitFor();
    await openInNewTab(page.locator(`[data-pin-id="${second}"] a`));
    await waitForOrder(page, [second, first]);
    const firstCardTop = (await cards.first().boundingBox()).y;
    await page.locator('.recent-disclosure summary').click();
    assert.equal((await cards.first().boundingBox()).y, firstCardTop);
    assert.ok((await page.locator('.bookmark-shortcut-bar').boundingBox()).height < 70);
    if (process.env.STARTREE_CAPTURE_SHORTCUTS) {
      await page.screenshot({ path: '/tmp/startree-shortcuts-desktop.png', fullPage: true });
    }
    await page.locator('.recent-disclosure summary').click();
    await page.locator('.recent-disclosure summary').press('Escape');
    assert.equal(
      await page.locator('.recent-disclosure').evaluate((element) => element.open),
      false,
    );
    await cards.nth(1).locator('.bookmark-pin-button').click();
    await page.locator(`[data-pin-id="${second}"]`).waitFor({ state: 'detached' });
    await assertAccessible(page, 'recently opened Bookmarks');

    other = await context.newPage();
    await other.setViewportSize({ width: 390, height: 844 });
    await other.goto(base);
    await waitForOrder(other, [second, first]);
    await assertAccessible(other, 'mobile recent Bookmarks');
    if (process.env.STARTREE_CAPTURE_SHORTCUTS) {
      await other.screenshot({ path: '/tmp/startree-shortcuts-mobile.png', fullPage: true });
    }
    assert.equal(
      await other.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (!(await page.locator('.recent-disclosure').evaluate((element) => element.open)))
      await page.locator('.recent-disclosure summary').click();
    await page.getByRole('button', { name: 'Clear recent', exact: true }).click();
    await waitForOrder(other, []);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
        );
    });
    await context.setOffline(true);
    // Prevent destination loading here, but retain a native primary activation.
    await page.evaluate(() => {
      document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });
    await cards.nth(0).locator('a').click();
    await waitForOrder(page, [first]);
    await page.reload();
    await waitForOrder(page, [first]);
    await context.setOffline(false);
    if (!(await page.locator('.recent-disclosure').evaluate((element) => element.open)))
      await page.locator('.recent-disclosure summary').click();
    await page.getByRole('button', { name: 'Clear recent', exact: true }).click();
    await waitForOrder(page, []);
    await page.reload();
    await waitForOrder(page, []);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
  } finally {
    await context.setOffline(false);
    await other?.close();
    await context.unroute(external, serveDestination);
  }
};
