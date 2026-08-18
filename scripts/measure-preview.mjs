import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';

import { submitEditorAndMeasureMutation } from './browser-mutation-timing.mjs';
import { summarizePerformanceResults, validatePerformanceResults } from './performance-metrics.mjs';

const previewUrl = process.env.STARTREE_PREVIEW_URL;
const storageStatePath = process.env.STARTREE_ACCESS_STORAGE_STATE;
const fixtureCase = process.env.STARTREE_PERFORMANCE_CASE;
if (!previewUrl || !storageStatePath || !['hierarchy', 'concentration'].includes(fixtureCase)) {
  throw new Error(
    'Set STARTREE_PREVIEW_URL, STARTREE_ACCESS_STORAGE_STATE, and STARTREE_PERFORMANCE_CASE=hierarchy|concentration.',
  );
}
const parsedUrl = new URL(previewUrl);
if (parsedUrl.protocol !== 'https:') throw new Error('Preview measurements require an HTTPS URL.');

const storageState = JSON.parse(readFileSync(storageStatePath, 'utf8'));
const folderId = '20000000-0000-4000-8000-000000000001';
const measuredPath = fixtureCase === 'concentration' ? `/bookmarks/${folderId}` : '/bookmarks';
const measuredUrl = new URL(measuredPath, parsedUrl).toString();
const results = {
  coldBrowseMs: [],
  warmBrowseMs: [],
  lcpMs: [],
  inpMs: [],
  cls: [],
  localInteractionMs: [],
  mutationAckMs: [],
  mutationCompleteMs: [],
};

const installObservers = async (page) => {
  await page.addInitScript(() => {
    globalThis.__startreePerformance = { lcp: 0, cls: 0, eventDurations: [] };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) globalThis.__startreePerformance.lcp = latest.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) globalThis.__startreePerformance.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId)
          globalThis.__startreePerformance.eventDurations.push(entry.duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 0 });
  });
};

const waitForBrowsableContent = async (page) => {
  const contentSelector = fixtureCase === 'concentration' ? '.bookmark-card-shell' : '.folder-tile';
  await page.locator(contentSelector).first().waitFor({ timeout: 10_000 });
  await page.locator('#bookmark-search-input').waitFor();
  if (new URL(page.url()).origin !== parsedUrl.origin) {
    throw new Error('The Access session expired or redirected away from the protected preview.');
  }
};

const measureMutation = async (page) => {
  await page.locator('#bookmark-search-input').fill('');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.getByLabel('Folder name').fill(`Performance Probe ${Date.now()}`);
  return submitEditorAndMeasureMutation(page);
};

const measureLocalSearch = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const input = document.querySelector('#bookmark-search-input');
        if (!(input instanceof HTMLInputElement)) {
          reject(new Error('Bookmark search was not available.'));
          return;
        }
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelector('.search-results')) {
            observer.disconnect();
            resolve(performance.now() - started);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        input.value = 'Performance Bookmark 10';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        setTimeout(() => {
          observer.disconnect();
          reject(new Error('Search did not render within one second.'));
        }, 1_000);
      }),
  );

const measureModeChange = async (page) => {
  await page.locator('#bookmark-search-input').fill('');
  const started = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
  const duration = await page.evaluate((start) => performance.now() - start, started);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return duration;
};

const measureFolderNavigation = async (page) => {
  const startingUrl = page.url();
  const started = await page.evaluate(() => performance.now());
  await page.locator('.folder-tile > button').first().click();
  await page.waitForURL((url) => url.toString() !== startingUrl);
  await page.getByRole('heading', { level: 1 }).waitFor();
  const duration = await page.evaluate((start) => performance.now() - start, started);
  await page.goBack();
  await waitForBrowsableContent(page);
  return duration;
};

const browser = await chromium.launch({ headless: true });
try {
  for (let index = 0; index < 5; index += 1) {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await installObservers(page);
    const started = performance.now();
    await page.goto(measuredUrl, { waitUntil: 'domcontentloaded' });
    await waitForBrowsableContent(page);
    results.coldBrowseMs.push(performance.now() - started);
    results.localInteractionMs.push(await measureLocalSearch(page));
    results.localInteractionMs.push(await measureModeChange(page));
    if (fixtureCase === 'hierarchy') {
      results.localInteractionMs.push(await measureFolderNavigation(page));
    }
    await page.locator('#bookmark-search-input').click();
    await page.keyboard.type('x');
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => globalThis.__startreePerformance);
    results.lcpMs.push(metrics.lcp);
    results.cls.push(metrics.cls);
    results.inpMs.push(Math.max(0, ...metrics.eventDurations));
    await context.close();
  }

  const warmContext = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 900 },
  });
  const warmPage = await warmContext.newPage();
  await warmPage.goto(measuredUrl);
  await waitForBrowsableContent(warmPage);
  await warmPage.route('**/api/bookmarks/snapshot', (route) => route.abort('connectionfailed'));
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    await warmPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForBrowsableContent(warmPage);
    results.warmBrowseMs.push(performance.now() - started);
  }
  await warmPage.unrouteAll({ behavior: 'wait' });
  await warmPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForBrowsableContent(warmPage);
  const mutation = await measureMutation(warmPage);
  results.mutationAckMs.push(mutation.acknowledgement);
  results.mutationCompleteMs.push(mutation.completion);
  await warmContext.close();
} finally {
  await browser.close();
}

const summary = summarizePerformanceResults(results);
console.log(JSON.stringify({ fixtureCase, runs: 5, summary, samples: results }, null, 2));
validatePerformanceResults(results);
