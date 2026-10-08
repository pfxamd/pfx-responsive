// GitHub CI only: real app -> local gateway -> isolated PFx Preview Core.
// No fake frames or mocked HTTP methods. The Linux Core must be running.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../core/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({viewport: {width: 1550, height: 900}, acceptDownloads: true});
const problems = [];
page.on('pageerror', error => problems.push(error.message));
page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.locator('#connectionText').getByText('Core connected').waitFor({timeout: 20_000});
  assert.equal(await page.locator('#openButton').isEnabled(), true);
  await page.locator('#urlInput').fill('https://example.com/');
  await page.locator('#openButton').click();
  await page.waitForFunction(() => document.querySelectorAll('.preview-card').length === 3, {timeout: 30_000});
  await page.waitForFunction(() => [...document.querySelectorAll('.preview-card')].every(card =>
    card.querySelector('[data-field=status]')?.textContent === 'LIVE'), null, {timeout: 45_000});
  await page.waitForFunction(() => [...document.querySelectorAll('.device-screen img')].some(image =>
    !image.hidden && image.naturalWidth > 0), null, {timeout: 45_000});
  assert.deepEqual(await page.locator('.preview-top-text strong').allTextContents(), ['Mobile','Tablet','Desktop']);
  await page.locator('.preview-card').first().click();
  await page.locator('#widthInput').fill('420');
  await page.locator('#heightInput').fill('820');
  await page.locator('#applyDimensions').click();
  await page.waitForFunction(() => document.querySelector('.preview-card [data-field=dimensions]')?.textContent.includes('420 × 820'), null, {timeout: 15_000});
  const downloadEvent = page.waitForEvent('download', {timeout: 25_000});
  await page.locator('#captureButton').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^PFx-mobile-420x820\.png$/);
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  assert.ok(png.byteLength > 1000, 'actual PNG screenshot must contain image pixels');
  await page.locator('.device-screen').first().click({position:{x:25,y:25}});
  await page.locator('#closeAll').click();
  await page.waitForFunction(() => document.querySelectorAll('.preview-card').length === 0, null, {timeout: 30_000});
  if(problems.length) throw new Error(`Browser errors: ${problems.join('; ')}`);
  console.log(JSON.stringify({status:'PASS',viewports:3,resize:'420x820',screenshotBytes:png.byteLength,liveFrame:true,closedSessions:true,pageErrors:0}));
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
