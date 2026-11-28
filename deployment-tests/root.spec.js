import { test, expect } from '@playwright/test';

const staging = process.env.COINXCHANGE_DEPLOY_TEST_MODE === 'staging';

test('the actual publish root loads the Founder Edition and the intended account mode', async ({ page, request }) => {
  const errors = [];
  const missing = [];
  const outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4174') return route.continue();
    outbound.push(url.origin + url.pathname);
    return route.abort();
  });

  await page.goto('/');
  await expect(page.locator('#welcomeScreen .phase-eyebrow')).toHaveText('COINXCHANGE — FOUNDER EDITION');
  await expect(page.getByRole('heading', { name: /Every Coin Has a Story/ })).toBeVisible();
  // No replacement of account-config.js: this tests the file which would be published.
  const project = await page.evaluate(() => window.COINXCHANGE_CONFIG?.supabaseUrl);
  expect(project).toBe(staging ? 'https://uyccxknjcugtvgoiukoh.supabase.co' : '');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const email = page.locator('#signInPanel').getByLabel('Email address', { exact: true });
  if (staging) await expect(email).toBeEnabled();
  else await expect(email).toBeDisabled();
  const assets = ['accounts.js', 'discovery-collection-market.js', 'vendor/supabase.js', 'assets/phase-two-welcome.svg'];
  for (const asset of assets) expect((await request.get('/' + asset)).ok(), asset).toBe(true);

  if (staging) {
    const metadata = await (await request.get('/build-info.json')).json();
    expect(metadata.environment).toBe('staging');
    expect(metadata.supabaseProject).toBe('uyccxknjcugtvgoiukoh');
    await page.goto('/?account=recovery');
    await expect(page.locator('#otpRecoveryForm')).toBeVisible();
    await expect(page.locator('#otpRecoveryForm input')).toBeEnabled();
  }
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
  expect(outbound, 'Loading an empty session must not send mail or require a backend request').toEqual([]);
});
