import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const appPaths = ['/', '/coinxchange/'];

for (const appPath of appPaths) {
  test.describe(`COINXCHANGE at ${appPath}`, () => {
    test.beforeEach(async ({ page }) => {
await page.route('**/coinxchange/account-config.js', route =>
  route.fulfill({
    contentType: 'application/javascript',
    body: "window.COINXCHANGE_CONFIG = Object.freeze({ supabaseUrl: '', supabasePublishableKey: '' });"
  })
);
await page.goto(appPath);
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
    });

    test('welcome and account screens are clear demo-only experiences', async ({ page }) => {
      test.skip(appPath === '/', 'The Phase 2 screens are served from /coinxchange/.');
      await page.reload();
      await expect(page.getByRole('heading', { name: /Every Coin Has a Story/ })).toBeVisible();
      await expect(page.locator('#welcomeScreen .phase-eyebrow'))
        .toHaveText('COINXCHANGE — FOUNDER EDITION');
      await expect(page.getByText('DISCOVER • CONNECT • COLLECT')).toBeVisible();

      const initialStorage = await page.evaluate(() => JSON.stringify(localStorage));
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
      await expect(page.locator('#signInPanel').getByText(/demonstration only.*do not enter real credentials/i)).toBeVisible();
      await expect(page.locator('#signInPanel').getByLabel('Email address')).toBeDisabled();
      await expect(page.locator('#signInPanel').getByLabel('Password')).toBeDisabled();
      await page.getByRole('link', { name: 'Forgot Password?' }).click();
      await expect(page.getByRole('heading', { name: 'Forgot Password' })).toBeVisible();
      await expect(page.locator('#forgotPasswordPanel').getByLabel('Email address')).toBeDisabled();

      await page.getByRole('link', { name: 'Back to Sign In' }).click();
      await page.getByRole('link', { name: 'Create Account' }).click();
      await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
      await expect(page.locator('#createAccountPanel').getByLabel('Email address')).toBeDisabled();
      await expect(page.locator('#createAccountPanel').getByLabel('Password')).toBeDisabled();
      expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(initialStorage);

      await page.getByRole('button', { name: 'Continue as guest' }).click();
      await expect(page.locator('#social')).toHaveClass(/active/);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    });

    test('welcome and account screens fit phone, tablet, and desktop widths', async ({ page }) => {
      test.skip(appPath === '/', 'The Phase 2 screens are served from /coinxchange/.');
      await page.reload();
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [screen, route] of [
          ['welcomeScreen', 'welcome'],
          ['accountScreen', 'sign-in'],
          ['accountScreen', 'create-account'],
          ['accountScreen', 'forgot-password']
        ]) {
          await page.evaluate(screenRoute => window.go(screenRoute), route);
          await expect(page.locator(`#${screen}`)).toBeVisible();
          const overflows = await page.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth
          );
          expect(overflows, `${route} overflows at ${width}px`).toBe(false);
        }
      }
    });

    test('keyboard navigation updates the active section', async ({ page }) => {
      await page.reload();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator(appPath === '/coinxchange/' ? '#welcomeScreen' : 'main')).toBeFocused();

      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Discover a Coin →' }).click();
      }
      const discoveryButton = page.getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: 'Coin Discovery' });
      await discoveryButton.focus();
      await page.keyboard.press('Enter');

      await expect(page.locator('#discover')).toHaveClass(/active/);
      await expect(discoveryButton).toHaveAttribute('aria-current', 'page');
    });

    test('discovery saves a reference coin and collection persists on reload', async ({ page }) => {
      await page.getByRole('navigation').getByRole('button', { name: 'Coin Discovery' }).click();
      await page.getByLabel('Reference example').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Show Discovery Guide' }).click();

      const reportTitle = page.locator('#reportTitle');
      await expect(reportTitle).not.toBeEmpty();
      const coinName = await reportTitle.textContent();
      await page.getByRole('button', { name: 'Save to Collection' }).click();
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await expect(page.locator('#collectionList')).toContainText(coinName);

      await page.reload();
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await expect(page.locator('#collectionList')).toContainText(coinName);
    });

    test('market filters, watchlist, and save-to-vault actions work', async ({ page }) => {
      await page.getByRole('navigation').getByRole('button', { name: 'Market Exchange' }).click();
      await page.locator('#marketCategory').selectOption({ index: 1 });
      await expect(page.locator('#marketStatus')).toContainText('of 6 reference coins shown');

      const watchButton = page.locator('#marketRows button[data-market-action="watch"]').first();
      await watchButton.click();
      await expect(page.locator('#marketRows button[data-market-action="watch"]').first())
        .toHaveAttribute('aria-pressed', 'true');

      await page.locator('#marketScope').selectOption('watchlist');
      await expect(page.locator('#marketRows tr')).toHaveCount(1);
      await page.locator('#marketRows button[data-market-action="collect"]').click();
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await expect(page.locator('#collectionList')).not.toContainText('Your vault is empty');
    });

    test('community posts and discussion replies persist on reload', async ({ page }) => {
      await page.getByRole('navigation').getByRole('button', { name: 'Community' }).click();
      const postText = `Browser regression post ${Date.now()}`;
      await page.locator('#social').getByLabel('Display name').fill('Regression Tester');
      await page.getByLabel('Post text').fill(postText);
      await page.getByRole('button', { name: 'Publish Post' }).click();

      const post = page.locator('#socialFeed .feedpost').filter({ hasText: postText });
      await expect(post).toBeVisible();
      await post.getByRole('button', { name: /Like/ }).click();
      await expect(post.getByRole('button', { name: /Like/ })).toContainText('1 Like');
      await post.getByRole('button', { name: /Join discussion/ }).click();
      await expect(page.locator('#discussion')).toHaveClass(/active/);

      const replyText = `Browser regression reply ${Date.now()}`;
      await page.locator('#replyName').fill('Regression Tester');
      await page.getByLabel('Your reply').fill(replyText);
      await page.getByRole('button', { name: 'Post reply' }).click();
      await expect(page.locator('#discussionContent')).toContainText(replyText);

      await page.reload();
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
      await page.getByRole('navigation').getByRole('button', { name: 'Community' }).click();
      const persistedPost = page.locator('#socialFeed .feedpost').filter({ hasText: postText });
      await expect(persistedPost.getByRole('button', { name: /Like/ })).toContainText('1 Like');
      await persistedPost.getByRole('button', { name: /Join discussion/ }).click();
      await expect(page.locator('#discussionContent')).toContainText(replyText);
    });

    test('valid existing cx_* records retain JSON formats and extra fields', async ({ page }) => {
      const existingData = {
        cx_collection: [{ name: 'Legacy Steel Cent', notes: 'Original note', customField: 'keep' }],
        cx_posts: [{ id: 'legacy-post', name: 'Legacy Member', text: 'Legacy post', likes: 2, customField: 'keep' }],
        cx_likes: { 'legacy-post': true },
        cx_watch: ['1909'],
        cx_replies: { 'legacy-post': [{ name: 'Legacy Reply', text: 'Still available' }] }
      };
      await page.addInitScript(data => {
        for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
      }, existingData);
      await page.goto(appPath);
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await expect(page.locator('#collectionList')).toContainText('Legacy Steel Cent');
      await page.getByRole('navigation').getByRole('button', { name: 'Community' }).click();
      const legacyPost = page.locator('#socialFeed .feedpost').filter({ hasText: 'Legacy post' });
      await legacyPost.getByRole('button', { name: /Join discussion/ }).click();
      await expect(page.locator('#discussionContent')).toContainText('Still available');
      await page.getByRole('navigation').getByRole('button', { name: 'Market Exchange' }).click();
      await page.locator('#marketScope').selectOption('watchlist');
      await expect(page.locator('#marketRows tr')).toHaveCount(1);
      const stored = await page.evaluate(keys => Object.fromEntries(
        keys.map(key => [key, JSON.parse(localStorage.getItem(key))])
      ), Object.keys(existingData));
      expect(stored).toEqual(existingData);
    });

    test('unreadable saved collection data is preserved and not overwritten', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('cx_collection', '{not valid json');
      });
      await page.goto(appPath);
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await page.getByLabel('Coin name', { exact: true }).fill('Attempted write');
      await page.getByRole('button', { name: 'Add to My Vault' }).click();

      await expect(page.locator('#toast')).toContainText('Existing data was not overwritten');
      expect(await page.evaluate(() => localStorage.getItem('cx_collection')))
        .toBe('{not valid json');
      await expect(page.locator('#collectionList')).toContainText('Your vault is empty');
    });

    test('storage write failures are reported without changing in-memory collection', async ({ page }) => {
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'cx_collection') {
            throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await page.goto(appPath);
      if (appPath === '/coinxchange/') {
        await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      }
      await page.getByRole('navigation').getByRole('button', { name: 'My Collection' }).click();
      await page.getByLabel('Coin name', { exact: true }).fill('Unsaved coin');
      await page.getByRole('button', { name: 'Add to My Vault' }).click();

      await expect(page.locator('#toast')).toContainText('Could not save collection data');
      await expect(page.locator('#collectionList')).toContainText('Your vault is empty');
      expect(await page.evaluate(() => localStorage.getItem('cx_collection'))).toBeNull();
    });

    test('mobile-width layouts do not create page-level horizontal overflow', async ({ page }) => {
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        for (const section of ['discover', 'social', 'market', 'collection', 'blueprint']) {
          await page.locator(`[data-page="${section}"]`).click();
          const overflows = await page.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth
          );
          expect(overflows, `${section} overflows at ${width}px`).toBe(false);
        }
      }
    });

    test('core sections have no WCAG 2.1 A/AA axe violations @a11y', async ({ page }) => {
      const navigation = page.getByRole('navigation', { name: 'Main navigation' });
      for (const [section, label] of [
        ['home', 'Overview'],
        ['discover', 'Coin Discovery'],
        ['social', 'Community'],
        ['market', 'Market Exchange'],
        ['collection', 'My Collection'],
        ['blueprint', 'Launch Plan']
      ]) {
        await navigation.getByRole('button', { name: label }).click();
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          results.violations,
          `${section} accessibility violations: ${JSON.stringify(results.violations.map(v => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map(n => n.target)
          })))}`
        ).toEqual([]);
      }
    });

    test('welcome and account screens have no WCAG 2.1 A/AA axe violations @a11y', async ({ page }) => {
      test.skip(appPath === '/', 'The Phase 2 screens are served from /coinxchange/.');
      await page.reload();
      for (const screen of [
        ['welcomeScreen', null],
        ['accountScreen', 'Sign In'],
        ['accountScreen', 'Forgot Password'],
        ['accountScreen', 'Create Account']
      ]) {
        if (screen[1] === 'Sign In') {
          await page.getByRole('button', { name: 'Sign In' }).click();
        } else if (screen[1] === 'Forgot Password') {
          await page.getByRole('link', { name: 'Forgot Password?' }).click();
        } else if (screen[1] === 'Create Account') {
          await page.getByRole('link', { name: 'Back to Welcome' }).click();
          await page.getByRole('button', { name: 'Create Account' }).click();
        }

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(results.violations, `${screen[1] || 'welcome'} accessibility violations`)
          .toEqual([]);
      }
    });
  });
}
