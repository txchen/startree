// Linux only: reads renderer private memory from /proc.
// STARTREE_PERFORMANCE_DIST selects the build, so two builds can be compared on one machine.
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { startPerformanceBrowserFixture } from './performance-browser-fixture.mjs';

const runs = Number(process.env.RUNS ?? 3);
const settleMs = Number(process.env.SETTLE_MS ?? 45_000);
const fixture = await startPerformanceBrowserFixture('hierarchy');

const rendererPids = () =>
  execSync(`pgrep -f -- '--type=renderer' || true`).toString().trim().split('\n').filter(Boolean);
const privateMegabytes = (pid) => {
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const field = (name) => Number(rollup.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return (field('Private_Dirty') + field('Private_Clean')) / 1024;
  } catch {
    return 0;
  }
};

const launch = async (userDataDir, knownPids) => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    serviceWorkers: 'block',
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.route('https://example.com/**', (route) => route.abort());
  const rendererPid = () =>
    rendererPids()
      .filter((pid) => !knownPids.has(pid))
      .map((pid) => [pid, privateMegabytes(pid)])
      .sort((left, right) => right[1] - left[1])[0];
  return { context, page, rendererPid };
};

const sample = async (page, rendererPid, durationMs) => {
  let peak = 0;
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    peak = Math.max(peak, rendererPid()?.[1] ?? 0);
    await page.waitForTimeout(200);
  }
  return peak;
};

const settled = async (context, page, rendererPid) => {
  const session = await context.newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  // Chromium returns freed renderer memory after roughly 30 seconds of idleness.
  await page.waitForTimeout(settleMs);
  const heap = await session.send('Runtime.getHeapUsage');
  await session.detach();
  return { privateMB: rendererPid()?.[1] ?? 0, pageHeapMB: heap.usedSize / 1e6 };
};

const measureStart = async (userDataDir) => {
  const knownPids = new Set(rendererPids());
  const { context, page, rendererPid } = await launch(userDataDir, knownPids);
  try {
    await page.goto(fixture.url);
    await page.locator('.folder-tile').first().waitFor();
    const startupPeakMB = await sample(page, rendererPid, 6_000);
    const idle = await settled(context, page, rendererPid);
    await page.locator('#bookmark-search-input').fill('Performance Bookmark 10');
    await page.locator('#search-result-0').first().waitFor();
    const searchPeakMB = await sample(page, rendererPid, 3_000);
    const searched = await settled(context, page, rendererPid);
    return { startupPeakMB, idle, searchPeakMB, searched };
  } finally {
    await context.close();
  }
};

const results = { cold: [], retained: [] };
try {
  for (let run = 0; run < runs; run += 1) {
    const userDataDir = mkdtempSync(join(tmpdir(), 'startree-memory-'));
    try {
      results.cold.push(await measureStart(userDataDir));
      results.retained.push(await measureStart(userDataDir));
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
} finally {
  await fixture.close();
}

const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (samples) => ({
  startupPeakMB: median(samples.map((s) => s.startupPeakMB)),
  idlePrivateMB: median(samples.map((s) => s.idle.privateMB)),
  idlePageHeapMB: median(samples.map((s) => s.idle.pageHeapMB)),
  searchPeakMB: median(samples.map((s) => s.searchPeakMB)),
  searchedPrivateMB: median(samples.map((s) => s.searched.privateMB)),
  searchedPageHeapMB: median(samples.map((s) => s.searched.pageHeapMB)),
});
const round = (value) => (typeof value === 'number' ? Number(value.toFixed(1)) : value);
console.log(
  JSON.stringify(
    {
      fixture: fixture.manifest,
      runs,
      summary: Object.fromEntries(
        Object.entries(results).map(([name, samples]) => [
          name,
          Object.fromEntries(Object.entries(summarize(samples)).map(([k, v]) => [k, round(v)])),
        ]),
      ),
      samples: results,
    },
    null,
    2,
  ),
);
