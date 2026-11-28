import { test, expect } from '@playwright/test';

const appPath = '/coinxchange/';
const fixturePhoto = 'coinxchange/assets/coin-lincoln-cent.png';

async function openDiscovery(page) {
  await page.route('**/account-config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: "window.COINXCHANGE_CONFIG = Object.freeze({ supabaseUrl: '', supabasePublishableKey: '' });"
  }));
  await page.goto(appPath);
  await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Coin Discovery' }).click();
}

async function preparePhoto(page) {
  await page.locator('#photo').setInputFiles(fixturePhoto);
  await expect(page.locator('#photoStatus')).toContainText('Photo ready');
  await expect(page.locator('#preview')).toBeVisible();
}

test('actual coin photo and description survive reload and are removed together', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH'].includes(request.method())) requests.push(request.url());
  });
  await openDiscovery(page);
  await preparePhoto(page);
  await page.locator('#photoCoinName').fill('My 1979-D Lincoln cent');
  await page.locator('#savePhotoDescription').click();
  await expect(page.locator('#collection')).toHaveClass(/active/);
  const photo = page.getByRole('img', { name: 'Your photo of My 1979-D Lincoln cent' });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cx_collection')));
  expect(saved).toHaveLength(1);
  expect(saved[0].photoDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved[0].photoDataUrl.length).toBeLessThan(700000);
  expect(requests).toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('src', saved[0].photoDataUrl);
  await expect.poll(() => photo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Remove coin', exact: true }).click();
  await expect(page.locator('#collectionList img')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cx_collection')))).toEqual([]);
});

test('reference-guide save keeps the selected photo and consumes the draft once', async ({ page }) => {
  await openDiscovery(page);
  await preparePhoto(page);
  await page.locator('#coinSelect').selectOption({ index: 1 });
  await page.locator('#identify').click();
  await page.locator('#saveDiscovered').click();
  await expect(page.locator('#preview')).not.toBeVisible();
  await page.locator('#saveDiscovered').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cx_collection')));
  expect(saved).toHaveLength(2);
  expect(saved[0].photoDataUrl).toBeUndefined();
  expect(saved[1].photoDataUrl).toMatch(/^data:image\/jpeg;base64,/);
});

test('browser quota failure leaves the photo draft available and never reports a save', async ({ page }) => {
  await openDiscovery(page);
  await preparePhoto(page);
  await page.locator('#photoCoinName').fill('Coin that needs storage');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cx_collection') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#savePhotoDescription').click();
  await expect(page.locator('#photoSaveStatus')).toContainText('Could not confirm');
  await expect(page.locator('#preview')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cx_collection'))).toBeNull();
  await expect(page.locator('#collectionCount')).toHaveText('0');
});

test('invalid image is rejected and a photo save cannot silently become details only', async ({ page }) => {
  await openDiscovery(page);
  await page.locator('#photo').setInputFiles({
    name: 'not-a-photo.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  });
  await expect(page.locator('#photoStatus')).toContainText('Choose a JPEG');
  await page.locator('#photoCoinName').fill('Invalid photo');
  await page.locator('#savePhotoDescription').click();
  await expect(page.locator('#photoSaveStatus')).toContainText('Choose a coin photo');
  expect(await page.evaluate(() => localStorage.getItem('cx_collection'))).toBeNull();
});

test('untrusted stored photo URLs cannot trigger an external request', async ({ page }) => {
  const external = [];
  await page.route('https://photo-tracker.example/**', route => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem('cx_collection', JSON.stringify([
    { name: 'Legacy text coin', notes: 'Keep existing data', photoDataUrl: 'https://photo-tracker.example/private' }
  ])));
  await openDiscovery(page);
  await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
  await expect(page.locator('#collectionList')).toContainText('Legacy text coin');
  await expect(page.locator('#collectionList')).toContainText('Photo unavailable');
  await expect(page.locator('#collectionList img')).toHaveCount(0);
  expect(external).toEqual([]);
});
