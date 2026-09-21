import AxeBuilder from '@axe-core/playwright';

export const verifyNavigationDuringStartupRefresh = async (page) => {
  const refresh = Promise.withResolvers();
  const intercepted = Promise.withResolvers();
  await page.route('**/api/bookmarks/snapshot', async (route) => {
    intercepted.resolve();
    await refresh.promise;
    await route.fulfill({ status: 304 });
  });
  try {
    await page.goto(new URL('/', page.url()).toString());
    await intercepted.promise;
    await page.waitForURL('**/bookmarks/10000000-0000-4000-8000-000000000001');
    await page.getByRole('heading', { level: 1, name: 'Reading' }).waitFor();
    await page.locator('.folder-grid button').filter({ hasText: 'Articles' }).click();
    await page.getByRole('heading', { level: 1, name: 'Articles' }).waitFor();
    const synchronized = page.waitForResponse('**/api/bookmarks/snapshot');
    refresh.resolve();
    await synchronized;
    await page.unrouteAll({ behavior: 'wait' });
    // Search is queued after indexing, so it also lets startup finish settling.
    await page.locator('#bookmark-search-input').fill('Example Reference');
    await page.locator('.search-results a').filter({ hasText: 'Example Reference' }).waitFor();
    await page.locator('#bookmark-search-input').press('Escape');
    await page.getByRole('heading', { level: 1, name: 'Articles' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Articles' }).waitFor();
  } finally {
    refresh.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
};

export const assertAccessible = async (page, state) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  if (!violations.length) return;
  const diagnostics = violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  throw new Error(`${state} failed accessibility scanning: ${JSON.stringify(diagnostics)}`);
};

export const createAndVerifyHostileFolder = async (page) => {
  const name = '<img src=x onerror=window.__x0=1>';
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.getByLabel('Folder name').fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
  const folder = page.locator('.folder-tile', { hasText: name });
  await folder.waitFor();
  if (
    (await folder.locator('img, script, [onerror]').count()) ||
    (await page.evaluate(() => globalThis.__x0))
  ) {
    throw new Error('Hostile Folder text became executable markup.');
  }
};

export const createAndVerifyHostileBookmark = async (page) => {
  const title = '<script>window.__x1=1</script>';
  const note = '<img src=x onerror=window.__x2=1>';
  const tag = '<svg onload=window.__x3=1>';
  await page.getByRole('button', { name: 'Add Bookmark' }).click();
  await page.getByLabel('URL').fill('https://example.org/hostile');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel(/Tags/).fill(tag);
  await page.getByLabel('Note').fill(note);
  await page.getByRole('button', { name: 'Save' }).click();
  const bookmark = page.locator('.bookmark-card-shell', { hasText: title });
  await bookmark.waitFor();
  await bookmark.getByText(note, { exact: true }).waitFor();
  await bookmark.getByText(tag, { exact: true }).waitFor();
  if (
    (await bookmark.locator('script, [onerror], [onload]').count()) ||
    (await page.evaluate(() => globalThis.__x1 || globalThis.__x2 || globalThis.__x3))
  ) {
    throw new Error('Hostile Bookmark, Tag, or Note text became executable markup.');
  }
};
