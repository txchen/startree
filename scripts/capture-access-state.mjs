import { chromium } from 'playwright';

const previewUrl = process.env.STARTREE_PREVIEW_URL;
const output = process.env.STARTREE_ACCESS_STORAGE_STATE;
if (!previewUrl || !output) {
  throw new Error('Set STARTREE_PREVIEW_URL and STARTREE_ACCESS_STORAGE_STATE.');
}
if (new URL(previewUrl).protocol !== 'https:') {
  throw new Error('Cloudflare Access state must be captured from HTTPS preview.');
}

const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(previewUrl);
  console.log('Complete the Cloudflare Access login in the opened browser.');
  await page.getByRole('heading', { level: 1, name: 'Bookmarks' }).waitFor({ timeout: 300_000 });
  await context.storageState({ path: output });
  console.log(`Saved the Access browser state to ${output}. Keep this untracked file private.`);
} finally {
  await browser.close();
}
