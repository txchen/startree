import assert from 'node:assert/strict';
import { assertAccessible } from './local-worker-acceptance.mjs';

export const verifyEncryptedNotes = async (browser, base) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const requests = [];
  const secretTitle = 'Private acceptance title';
  const secretBody = 'Private acceptance body';
  const password = 'notes acceptance password';
  const unlock = async (target, secret = password) => {
    await target.getByLabel('Notes password', { exact: true }).fill(secret);
    await target.getByRole('button', { name: 'Unlock notes', exact: true }).click();
    await target.locator('.notes-layout').waitFor();
  };
  const saved = (target) =>
    target
      .locator('.notes-save-status')
      .filter({ hasText: /^Saved$/ })
      .waitFor();
  context.on('request', (request) =>
    requests.push({ url: request.url(), body: request.postData() ?? '' }),
  );
  let otherContext;
  try {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Bookmarks', exact: true }).waitFor();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    assert.equal(
      requests.some((request) => /NotesPage-|notes-storage-|\/api\/notes\//.test(request.url)),
      false,
      'Bookmark startup must not request Notes code or data, even from the service worker',
    );
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByLabel('New notes password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue to recovery key' }).click();
    const recovery = await page.locator('.notes-recovery-key').textContent();
    await page.getByLabel('Verify recovery key').fill(recovery);
    await page.getByRole('button', { name: 'Verify and open notes' }).click();
    await saved(page);
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.getByRole('textbox', { name: 'Note title', exact: true }).fill(secretTitle);
    await page.getByRole('textbox', { name: 'Note content', exact: true }).fill(secretBody);
    await saved(page);
    if (process.env.STARTREE_CAPTURE_NOTES)
      await page.screenshot({ path: '/tmp/startree-notes-implemented-desktop.png' });
    await assertAccessible(page, 'unlocked encrypted Notes');
    assert.ok(requests.some((request) => /NotesPage-.*\.js/.test(request.url)));
    for (const request of requests) {
      for (const secret of [password, recovery, secretTitle, secretBody])
        assert.equal(
          request.body.includes(secret),
          false,
          'Plaintext must never enter a network request',
        );
    }
    const retained = await page.evaluate(async () => {
      const request = indexedDB.open('startree-notes');
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const entries = await new Promise((resolve, reject) => {
        const read = database.transaction('encrypted').objectStore('encrypted').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      database.close();
      return JSON.stringify({
        entries,
        local: { ...localStorage },
        session: { ...sessionStorage },
      });
    });
    for (const secret of [password, recovery, secretTitle, secretBody])
      assert.equal(retained.includes(secret), false);
    const remote = await page.evaluate(() =>
      fetch('/api/notes/vault').then((response) => response.text()),
    );
    assert.equal(remote.includes(secretTitle), false);
    assert.equal(remote.includes(secretBody), false);
    await page.getByRole('button', { name: 'Lock now' }).click();
    await page.getByRole('heading', { name: 'Your notes are locked' }).waitFor();
    assert.equal(await page.getByText(secretTitle, { exact: true }).count(), 0);
    await assertAccessible(page, 'locked Notes');
    await page.getByLabel('Notes password', { exact: true }).fill('incorrect');
    await page.getByRole('button', { name: 'Unlock notes', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'could not unlock' }).waitFor();
    await unlock(page);
    await context.setOffline(true);
    await page
      .getByRole('textbox', { name: 'Note content', exact: true })
      .fill('Offline private edit');
    await page.locator('.notes-save-status').filter({ hasText: 'sync pending' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Your notes are locked' }).waitFor();
    await page.getByLabel('Open copy').selectOption({ index: 1 });
    await unlock(page);
    assert.equal(
      await page.getByRole('textbox', { name: 'Note content', exact: true }).inputValue(),
      'Offline private edit',
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await saved(page);

    otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const other = await otherContext.newPage();
    await other.goto(`${base}/notes`);
    await unlock(other);
    await page
      .getByRole('textbox', { name: 'Note content', exact: true })
      .fill('First device edit');
    await saved(page);
    await other
      .getByRole('textbox', { name: 'Note content', exact: true })
      .fill('Second device edit');
    await other.getByRole('button', { name: 'Keep both versions' }).waitFor();
    await other.getByRole('button', { name: 'Keep both versions' }).click();
    await saved(other);
    assert.equal(await other.locator('.notes-list-item').count(), 2);
    await other.getByRole('button', { name: 'Lock now' }).click();
    await other.getByRole('button', { name: 'Use recovery key', exact: true }).click();
    await other.getByLabel('Recovery key', { exact: true }).fill(recovery);
    await other.getByRole('button', { name: 'Unlock notes', exact: true }).click();
    await other
      .getByLabel('New notes password', { exact: true })
      .fill('replacement notes password');
    await other.getByLabel('Confirm password', { exact: true }).fill('replacement notes password');
    await other.getByRole('button', { name: 'Continue to recovery key' }).click();
    const newRecovery = await other.locator('.notes-recovery-key').textContent();
    assert.notEqual(newRecovery, recovery);
    await other.getByLabel('Verify recovery key').fill(newRecovery);
    await other.getByRole('button', { name: 'Verify and open notes' }).click();
    await saved(other);
    await other.reload();
    await unlock(other, 'replacement notes password');
    assert.equal(await other.locator('.notes-list-item').count(), 2);
    await other.setViewportSize({ width: 390, height: 844 });
    await other.locator('.notes-list-item').first().click();
    await other.getByRole('textbox', { name: 'Note content', exact: true }).waitFor();
    assert.equal(
      await other.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (process.env.STARTREE_CAPTURE_NOTES)
      await other.screenshot({ path: '/tmp/startree-notes-implemented-mobile.png' });
    await assertAccessible(other, 'mobile Notes editor');
    const nav = await other.locator('.page-navigation').boundingBox();
    assert.ok(
      Math.abs(nav.x + nav.width / 2 - 195) < 2,
      'Mobile Page navigation should be centered',
    );
    await other.evaluate(() => {
      const now = Date.now.bind(Date);
      window.__notesClock = now;
      Date.now = () => now() + 16 * 60_000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await other.getByRole('heading', { name: 'Your notes are locked' }).waitFor();
    assert.equal(await other.locator('.notes-body-input').count(), 0);
    await other.evaluate(() => {
      Date.now = window.__notesClock;
    });
    await unlock(other, 'replacement notes password');

    await other.getByRole('link', { name: 'Bookmarks', exact: true }).click();
    await other.getByRole('heading', { name: 'Bookmarks', exact: true }).waitFor();
    await other.getByRole('link', { name: 'Notes', exact: true }).click();
    await other.getByRole('heading', { name: 'Your notes are locked' }).waitFor();
    console.log(
      'Encrypted Notes: lazy loading, ciphertext-only persistence, offline recovery, conflicts, key recovery, and mobile layout passed.',
    );
  } finally {
    await otherContext?.close();
    await context.close();
  }
};
