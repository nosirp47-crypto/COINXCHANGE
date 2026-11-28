import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/coinxchange/');
  await page.evaluate(() => {
    // Use an isolated member section; account-provider behavior has its own suite.
    document.body.innerHTML = '<main><section id="member"></section></main>';
  });
});

test('nonfounders cannot see counts, including after an authorized view is cleared', async ({ page }) => {
  await page.evaluate(async () => {
    const { createFounderDashboard } = await import('/coinxchange/founder-dashboard.js');
    window.founderReply = { error: { code: '42501' }, data: null };
    window.founderView = createFounderDashboard({ rpc: async () => window.founderReply });
    await window.founderView.load();
  });
  await expect(page.locator('#founderDashboard')).toBeHidden();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('—');
});

test('authorized totals render, refresh, and clear without browser persistence', async ({ page }) => {
  await page.evaluate(async () => {
    const { createFounderDashboard } = await import('/coinxchange/founder-dashboard.js');
    window.founderReply = { data: [{ total_members: 12, confirmed_members: 10, joined_last_7_days: 2,
      joined_last_30_days: 6, as_of: '2026-11-28T07:00:00Z' }] };
    window.founderStorageBefore = JSON.stringify(localStorage);
    window.founderView = createFounderDashboard({ rpc: async name => {
      if (name !== 'founder_signup_counts') throw new Error('Wrong RPC');
      return window.founderReply;
    } });
    await window.founderView.load();
  });
  await expect(page.getByRole('heading', { name: 'Founder dashboard' })).toBeVisible();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('12');
  await expect(page.locator('[data-founder-count="confirmed_members"]')).toHaveText('10');
  await page.evaluate(() => { window.founderReply.data[0].total_members = 13; });
  await page.getByRole('button', { name: 'Refresh member totals' }).click();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('13');
  expect(await page.evaluate(() => JSON.stringify(localStorage) === window.founderStorageBefore)).toBe(true);
  await page.evaluate(() => window.founderView.clear());
  await expect(page.locator('#founderDashboard')).toBeHidden();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('—');
});

test('pending counts cannot reappear after sign-out', async ({ page }) => {
  await page.evaluate(async () => {
    const { createFounderDashboard } = await import('/coinxchange/founder-dashboard.js');
    const pending = new Promise(resolve => { window.resolveFounderReply = resolve; });
    window.founderView = createFounderDashboard({ rpc: () => pending });
    window.founderPending = window.founderView.load();
    window.founderView.clear();
    window.resolveFounderReply({ data: [{ total_members: 12, confirmed_members: 10, joined_last_7_days: 2,
      joined_last_30_days: 6, as_of: '2026-11-28T07:00:00Z' }] });
    await window.founderPending;
  });
  await expect(page.locator('#founderDashboard')).toBeHidden();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('—');
});

test('malformed or failed refresh removes stale totals', async ({ page }) => {
  await page.evaluate(async () => {
    const { createFounderDashboard } = await import('/coinxchange/founder-dashboard.js');
    let valid = true;
    window.founderView = createFounderDashboard({ rpc: async () => {
      if (valid) { valid = false; return { data: [{ total_members: 12, confirmed_members: 10,
        joined_last_7_days: 2, joined_last_30_days: 6, as_of: '2026-11-28T07:00:00Z' }] }; }
      return { data: [{ total_members: '<script>alert(1)</script>' }] };
    } });
    await window.founderView.load();
  });
  await expect(page.locator('#founderDashboard')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh member totals' }).click();
  await expect(page.locator('#founderDashboard')).toBeHidden();
  await expect(page.locator('[data-founder-count="total_members"]')).toHaveText('—');
});
