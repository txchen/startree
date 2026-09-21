import assert from 'node:assert/strict';

import { assertAccessible } from './local-worker-acceptance.mjs';

export const verifyPinnedBookmarks = async (page, browser) => {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const cards = page.locator('.bookmark-card-shell');
  const originalOrder = await cards.evaluateAll((items) =>
    items.map((item) => item.dataset.bookmarkId),
  );
  const first = originalOrder[0];
  const second = originalOrder[1];
  const waitForOrder = (target, order) =>
    target.waitForFunction(
      (expected) =>
        JSON.stringify(
          [...document.querySelectorAll('[data-pin-id]')].map((item) => item.dataset.pinId),
        ) === JSON.stringify(expected),
      order,
    );
  await cards.nth(0).locator('.bookmark-pin-button').click();
  await waitForOrder(page, [first]);
  await cards.nth(1).locator('.bookmark-pin-button').click();
  await waitForOrder(page, [first, second]);
  const pinned = page.getByRole('region', { name: 'Pinned', exact: true });
  await pinned.getByRole('button', { name: 'Arrange pins' }).click();
  await pinned
    .locator('li')
    .nth(1)
    .getByRole('button', { name: /earlier$/ })
    .click();
  await waitForOrder(page, [second, first]);
  await pinned
    .locator('li')
    .nth(0)
    .getByRole('button', { name: /later$/ })
    .click();
  await waitForOrder(page, [first, second]);
  assert.deepEqual(
    await cards.evaluateAll((items) => items.map((item) => item.dataset.bookmarkId)),
    originalOrder,
  );
  await assertAccessible(page, 'pinned Bookmarks and arrangement controls');

  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await otherContext.newPage();
  try {
    await other.goto(new URL('/', page.url()).href);
    await other.getByRole('heading', { level: 1, name: 'Bookmarks', exact: true }).waitFor();
    await waitForOrder(other, [first, second]);
    const firstUrl = await cards.nth(0).locator('a').getAttribute('href');
    assert.equal(await other.locator('[data-pin-id] a').first().getAttribute('href'), firstUrl);
    await assertAccessible(other, 'mobile pinned Bookmarks');
    await other.getByRole('button', { name: 'Arrange pins' }).click();
    await other
      .locator('[data-pin-id]')
      .nth(1)
      .getByRole('button', { name: /earlier$/ })
      .click();
    await waitForOrder(other, [second, first]);
    assert.equal(
      await other.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await other.reload();
    await waitForOrder(other, [second, first]);
    await other.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
        );
      }
    });
    await otherContext.setOffline(true);
    await other.reload();
    await waitForOrder(other, [second, first]);
    // Match the existing offline acceptance harness: network emulation does not
    // consistently emit the browser's offline lifecycle event after a reload.
    await other.evaluate(() => window.dispatchEvent(new Event('offline')));
    await other.locator('.sync-status.offline').waitFor();
    await other.getByRole('button', { name: 'Arrange pins' }).click();
    assert.equal(
      await other
        .locator('[data-pin-id]')
        .first()
        .getByRole('button', { name: /^Unpin / })
        .isDisabled(),
      true,
    );
  } finally {
    await otherContext.close();
  }

  await page.reload();
  await waitForOrder(page, [second, first]);
  await page.getByRole('button', { name: 'Arrange pins' }).click();
  await page
    .locator('[data-pin-id]')
    .first()
    .getByRole('button', { name: /^Unpin / })
    .click();
  await waitForOrder(page, [first]);
  await page
    .locator('[data-pin-id]')
    .first()
    .getByRole('button', { name: /^Unpin / })
    .click();
  await pinned.waitFor({ state: 'detached' });
  assert.deepEqual(
    await cards.evaluateAll((items) => items.map((item) => item.dataset.bookmarkId)),
    originalOrder,
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
};
