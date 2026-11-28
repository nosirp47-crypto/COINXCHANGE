import { test, expect } from '@playwright/test';

test.use({ screenshot: 'only-on-failure' });

const appPath = '/coinxchange/';
const providerOrigin = 'https://coinxchange-tests.supabase.co';
const publicKey = 'sb_publishable_coinxchange_browser_contract_test_key';
const userId = '11111111-1111-4111-8111-111111111111';
const email = 'collector@example.test';
const password = 'CoinCollector-2026!';
const timestamp = '2026-11-22T14:00:00.000Z';

const guestData = {
  cx_collection: [{ name: 'Guest steel cent', notes: 'Keep this browser copy', extra: 'preserve' }],
  cx_watch: ['1943'],
  cx_posts: [{ id: 'guest-post', name: 'Guest', text: 'Local discussion', likes: 0 }],
  cx_likes: {},
  cx_replies: {}
};

function user(overrides = {}) {
  return {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { display_name: 'Test Collector' },
    identities: [{ id: userId, identity_id: userId, user_id: userId, provider: 'email' }],
    ...overrides
  };
}

function session() {
  const now = Math.floor(Date.now() / 1000);
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({
      iss: `${providerOrigin}/auth/v1`, sub: userId, aud: 'authenticated',
      role: 'authenticated', email, iat: now, exp: now + 3600
    }),
    Buffer.from('test-signature-only').toString('base64url')
  ].join('.');
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'test-refresh-token',
    user: user()
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// This fixture exercises the real browser SDK against HTTP responses. It does
// not emulate database authorization; supabase/tests covers actual SQL/RLS.
async function providerFixture(page, { config, seedGuest = true, recoveryMail = {} } = {}) {
  const state = {
    requests: [],
    profile: { id: userId, display_name: 'Test Collector', created_at: timestamp, updated_at: timestamp },
    collection: [],
    watchlist: [],
    failSignIn: false,
    failInsert: false,
    failRecovery: false,
    failExchange: false,
    failPhotoUpload: false,
    failPhotoDownload: false,
    photoDownloadGate: null,
    photos: new Set(),
    photoBytes: null,
    insertGate: null,
    collectionReadGate: null,
    verifyGate: null,
    passwordGate: null,
    signupGate: null,
    signupReturnsSession: false,
    serial: 0
  };

  if (seedGuest) {
    await page.addInitScript(data => {
      if (sessionStorage.getItem('account-contract-fixture-seeded')) return;
      for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('account-contract-fixture-seeded', 'yes');
    }, guestData);
  }

  const browserConfig = config ?? { supabaseUrl: providerOrigin, supabasePublishableKey: publicKey };
  await page.route('**/account-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.COINXCHANGE_CONFIG = Object.freeze(${JSON.stringify(browserConfig)});`
  }));

  await page.route(`${providerOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = request.headers();
    let body = null;
    try { body = request.postDataJSON(); } catch { /* GET and OPTIONS have no JSON body. */ }
    state.requests.push({ method, path: url.pathname, search: url.search, body, headers });

    const respond = (json, status = 200) => route.fulfill({
      status,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': '*'
      },
      body: status === 204 ? '' : JSON.stringify(json)
    });
    const authError = (message, code = 'invalid_credentials', status = 400) =>
      respond({ code, error_code: code, msg: message, message }, status);
    if (method === 'OPTIONS') return respond(null, 204);

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password' && state.passwordGate) await state.passwordGate.promise;
      if (url.searchParams.get('grant_type') === 'password' && state.failSignIn) {
        return authError('Invalid login credentials');
      }
      if (url.searchParams.get('grant_type') === 'pkce' && state.failExchange) {
        return authError('Recovery link expired. Request a new link.', 'flow_state_expired');
      }
      return respond(session());
    }
    if (url.pathname === '/auth/v1/verify') {
      if (state.verifyGate) await state.verifyGate.promise;
      if (body?.type === 'signup' && recoveryMail.confirmation && body.token === recoveryMail.confirmation && body.email === email) {
        delete recoveryMail.confirmation;
        return respond(session());
      }
      if (body?.type !== 'recovery' || !recoveryMail.code || body?.token !== recoveryMail.code || body?.email !== email) {
        return authError('Invalid or expired code', 'otp_expired');
      }
      delete recoveryMail.code;
      return respond(session());
    }
    if (url.pathname === '/auth/v1/signup') {
      if (state.signupGate) await state.signupGate.promise;
      recoveryMail.confirmation = '00123456';
      if (state.signupReturnsSession) return respond(session());
      return respond(user({ email_confirmed_at: undefined, confirmation_sent_at: timestamp }));
    }
    if (url.pathname === '/auth/v1/recover') {
      if (!state.failRecovery && body?.email === email) recoveryMail.code = '01234567';
      return state.failRecovery
        ? authError('Too many requests. Please try again later.', 'over_email_send_rate_limit', 429)
        : respond({});
    }
    if (url.pathname === '/auth/v1/user') return respond(user());
    if (url.pathname === '/auth/v1/logout') return respond(null, 204);

    if (url.pathname.startsWith('/storage/v1/object/coin-photos/') && method === 'POST') {
      if (state.failPhotoUpload) return respond({ error: 'Unauthorized', message: 'Upload rejected' }, 403);
      const path = url.pathname.replace('/storage/v1/object/coin-photos/', '');
      state.photos.add(path);
      return respond({ Key: 'coin-photos/' + path, Id: 'test-object' });
    }
    if (url.pathname.startsWith('/storage/v1/object/coin-photos/') && method === 'GET') {
      if (state.photoDownloadGate) await state.photoDownloadGate.promise;
      const path = url.pathname.replace('/storage/v1/object/coin-photos/', '');
      if (state.failPhotoDownload || !state.photos.has(path) || !state.photoBytes) {
        return respond({ error: 'Not found', message: 'Photo unavailable' }, 404);
      }
      return route.fulfill({
        contentType: 'image/jpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: state.photoBytes
      });
    }
    if (url.pathname === '/storage/v1/object/coin-photos' && method === 'DELETE') {
      if (body.prefixes.some(path => state.collection.some(row => row.photo_path === path))) {
        return respond({ error: 'Unauthorized', message: 'Photo still referenced' }, 403);
      }
      body.prefixes.forEach(path => state.photos.delete(path));
      return respond(body.prefixes.map(name => ({ name })));
    }

    const table = url.pathname.replace('/rest/v1/', '');
    const objectResponse = (headers.accept || '').includes('application/vnd.pgrst.object+json');
    const representation = rows => objectResponse ? (rows[0] ?? null) : rows;
    const eq = key => url.searchParams.get(key)?.replace(/^eq\./, '');
    const matches = row => ['id', 'owner_id', 'reference_id'].every(key => !eq(key) || row[key] === eq(key));

    if (table === 'profiles') {
      if (method === 'PATCH') state.profile = { ...state.profile, ...body };
      return respond(representation(matches(state.profile) ? [state.profile] : []));
    }
    if (table === 'collection_items') {
      if (method === 'POST') {
        if (state.insertGate) await state.insertGate.promise;
        if (state.failInsert) {
          return respond({ code: '42501', message: 'new row violates row-level security policy' }, 403);
        }
        const values = Array.isArray(body) ? body : [body];
        const inserted = values.map(value => ({
          id: `22222222-2222-4222-8222-${String(++state.serial).padStart(12, '0')}`,
          owner_id: userId,
          created_at: timestamp,
          reference_id: null,
          ...value
        }));
        state.collection.unshift(...inserted);
        return respond(representation(inserted), 201);
      }
      if (method === 'PATCH') {
        const updated = [];
        state.collection = state.collection.map(row => {
          if (!matches(row)) return row;
          const result = { ...row, ...body };
          updated.push(result);
          return result;
        });
        return respond(representation(updated));
      }
      if (method === 'DELETE') {
        const removed = state.collection.filter(matches);
        state.collection = state.collection.filter(row => !matches(row));
        return respond(representation(removed));
      }
      const rows = state.collection.filter(matches).map(row => ({ ...row }));
      if (state.collectionReadGate) {
        const gate = state.collectionReadGate;
        state.collectionReadGate = null;
        await gate.promise;
      }
      return respond(representation(rows));
    }
    if (table === 'watchlist_items') {
      if (method === 'POST') {
        const values = Array.isArray(body) ? body : [body];
        const inserted = values.map(value => ({ owner_id: userId, created_at: timestamp, ...value }));
        for (const value of inserted) {
          if (!state.watchlist.some(row => row.owner_id === value.owner_id && row.reference_id === value.reference_id)) {
            state.watchlist.push(value);
          }
        }
        return respond(representation(inserted), 201);
      }
      if (method === 'DELETE') {
        const removed = state.watchlist.filter(matches);
        state.watchlist = state.watchlist.filter(row => !matches(row));
        return respond(representation(removed));
      }
      return respond(representation(state.watchlist.filter(matches)));
    }
    return respond({ message: `Unexpected provider route: ${method} ${url.pathname}` }, 404);
  });
  return state;
}

async function expectGuestDataUnchanged(page) {
  const saved = await page.evaluate(keys => Object.fromEntries(
    keys.map(key => [key, JSON.parse(localStorage.getItem(key))])
  ), Object.keys(guestData));
  expect(saved).toEqual(guestData);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(password);
}

async function signIn(page) {
  await page.goto(appPath);
  await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.locator('#signInEmail')).toBeEnabled();
  await page.locator('#signInEmail').fill(email);
  await page.locator('#signInPassword').fill(password);
  await page.locator('#signInForm').getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.locator('#profileName')).toHaveValue('Test Collector');
  await expect(page.locator('#accountNav')).toHaveText(/My Account/);
}

async function goTo(page, name) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name }).click();
}

test.describe('COINXCHANGE account and private-data integration', () => {
  for (const [description, config] of [
    ['missing configuration', { supabaseUrl: '', supabasePublishableKey: '' }],
    ['a privileged secret key', { supabaseUrl: providerOrigin, supabasePublishableKey: 'sb_secret_never_send_this_from_a_browser' }]
  ]) {
    test(`${description} keeps credentials disabled and sends no provider requests`, async ({ page }) => {
      const provider = await providerFixture(page, { config });
      await page.goto(appPath);
      await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.locator('#signInEmail')).toBeDisabled();
      await expect(page.locator('#signInPassword')).toBeDisabled();
      await page.locator('#signInPanel').getByRole('link', { name: 'Back to Welcome' }).click();
      await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      await goTo(page, 'My Collection');
      await expect(page.locator('#collectionList')).toContainText('Guest steel cent');
      await expectGuestDataUnchanged(page);
      expect(provider.requests).toEqual([]);
    });
  }

  test('signup awaiting email confirmation does not grant a signed-in account', async ({ page }) => {
    const provider = await providerFixture(page);
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(page.locator('#createEmail')).toBeEnabled();
    await page.locator('#createName').fill('New Collector');
    await page.locator('#createEmail').fill(email);
    await page.locator('#createPassword').fill(password);
    await page.locator('#createAccountForm').getByRole('button', { name: 'Create Account', exact: true }).click();

    await expect(page.locator('#createAccountForm .account-status')).toContainText(/email|confirm/i);
    await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
    const signup = provider.requests.find(request => request.path === '/auth/v1/signup');
    expect(signup.body.email).toBe(email);
    expect(signup.body.data.display_name).toBe('New Collector');
    expect(provider.requests.filter(request => request.path.startsWith('/rest/v1/'))).toEqual([]);
    await expect(page.locator('#createPassword')).toHaveValue('');
    await expectGuestDataUnchanged(page);
  });

  test('invalid credentials show an error without loading private records', async ({ page }) => {
    const provider = await providerFixture(page);
    provider.failSignIn = true;
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.locator('#signInEmail')).toBeEnabled();
    await page.locator('#signInEmail').fill(email);
    await page.locator('#signInPassword').fill(password);
    await page.locator('#signInForm').getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.locator('#signInPanel .account-status')).toContainText(/invalid|incorrect|could not|unable|check/i);
    await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
    expect(provider.requests.filter(request => request.path.startsWith('/rest/v1/'))).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  test('an eight-digit signup code confirms the account in a separate browser session', async ({ page, browser, baseURL }) => {
    const mail = {};
    const requester = await browser.newPage({ baseURL });
    try {
      await providerFixture(requester, { recoveryMail: mail });
      await requester.goto(appPath);
      await requester.locator('#welcomeScreen').getByRole('button', { name: 'Create Account', exact: true }).click();
      await requester.locator('#createName').fill('Mobile Collector');
      await requester.locator('#createEmail').fill(email);
      await requester.locator('#createPassword').fill(password);
      await requester.locator('#createAccountForm button[type="submit"]').click();
      await expect(requester.locator('#createAccountForm .account-status')).toContainText('check your email');
    } finally { await requester.close(); }

    const provider = await providerFixture(page, { recoveryMail: mail });
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Create Account', exact: true }).click();
    await page.getByText('Already have a confirmation code?', { exact: true }).click();
    await page.getByLabel('Confirmation email address').fill(email);
    await page.getByLabel('Confirmation code', { exact: true }).fill('000000');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.locator('#confirmEmailForm .account-status')).toContainText(/invalid|expired/);
    await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);

    await page.getByLabel('Confirmation code', { exact: true }).fill(mail.confirmation);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.locator('#member')).toBeVisible();
    await expect(page.locator('#confirmEmailCode')).toHaveValue('');
    await expect(page.locator('#newPassword')).toBeDisabled();
    expect(provider.requests.some(req => req.path === '/auth/v1/verify' && req.body.type === 'signup' && req.body.token === '00123456')).toBe(true);
    await expectGuestDataUnchanged(page);
  });

  test('account vault, profile, and watchlist persist via the provider without changing guest records', async ({ page }) => {
    const provider = await providerFixture(page);
    await signIn(page);
    await goTo(page, 'My Collection');
    await expect(page.locator('#collectionList')).not.toContainText('Guest steel cent');
    await page.getByLabel('Coin name', { exact: true }).fill('Private 1964 Kennedy half dollar');
    await page.getByLabel('Notes', { exact: true }).fill('<img src=x onerror=alert(1)> renders as a note');
    await page.getByRole('button', { name: 'Add to My Vault', exact: true }).click();
    await expect(page.locator('#collectionList')).toContainText('Private 1964 Kennedy half dollar');
    await expect(page.locator('#collectionList')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#collectionList img')).toHaveCount(0);

    await goTo(page, 'Market Exchange');
    await page.locator('#marketRows [data-market-action="watch"]').first().click();
    await expect(page.locator('#marketRows [data-market-action="watch"]').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#accountNav').click();
    await page.locator('#profileName').fill('Updated Collector');
    await page.locator('#profileForm').getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect.poll(() => provider.profile.display_name).toBe('Updated Collector');

    await page.reload();
    await expect(page.locator('#profileName')).toHaveValue('Updated Collector');
    const explore = page.locator('#welcomeScreen').getByRole('button', { name: 'Explore Coins', exact: true });
    if (await explore.isVisible()) await explore.click();
    await goTo(page, 'My Collection');
    await expect(page.locator('#collectionList')).toContainText('Private 1964 Kennedy half dollar');
    await goTo(page, 'Market Exchange');
    await expect(page.locator('#marketRows [data-market-action="watch"]').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#marketRows [data-market-action="watch"]').first().click();
    await expect(page.locator('#marketRows [data-market-action="watch"]').first()).toHaveAttribute('aria-pressed', 'false');
    expect(provider.watchlist).toEqual([]);

    const write = provider.requests.find(request => request.path === '/rest/v1/collection_items' && request.method === 'POST');
    expect(write.headers.authorization).toMatch(/^Bearer /);
    expect(write.headers.apikey).toBe(publicKey);
    await expectGuestDataUnchanged(page);

    await goTo(page, 'My Collection');
    await page.locator('#collectionList').getByRole('button', { name: 'Remove coin' }).click();
    await expect(page.locator('#collectionList')).not.toContainText('Private 1964 Kennedy half dollar');
    expect(provider.collection).toEqual([]);
  });

  test('a failed account save keeps the draft and never falls back to browser guest storage', async ({ page }) => {
    const provider = await providerFixture(page);
    provider.failInsert = true;
    await signIn(page);
    await goTo(page, 'My Collection');
    await page.getByLabel('Coin name', { exact: true }).fill('Rejected private coin');
    await page.getByRole('button', { name: 'Add to My Vault', exact: true }).click();
    await expect(page.locator('#toast')).toContainText(/could not|unable|failed|try again/i);
    await expect(page.locator('#collectionList')).not.toContainText('Rejected private coin');
    await expect(page.getByLabel('Coin name', { exact: true })).toHaveValue('Rejected private coin');
    expect(provider.collection).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  async function choosePhoto(page, provider, name = 'Photographed 1979-D cent') {
    await goTo(page, 'Coin Discovery');
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      context.fillStyle = '#bc7535';
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = '#231606';
      context.fillRect(20, 12, 24, 40);
      return canvas.toDataURL('image/jpeg', 0.85);
    });
    provider.photoBytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    await page.locator('#photo').setInputFiles({ name: 'my-cent.jpg', mimeType: 'image/jpeg', buffer: provider.photoBytes });
    await expect(page.locator('#photoStatus')).toContainText('Photo ready');
    await page.locator('#photoCoinName').fill(name);
  }

  test('private coin photos survive reload and another browser, preserve on edit, and delete after the row', async ({ page, browser, baseURL }) => {
    const provider = await providerFixture(page);
    await signIn(page);
    await choosePhoto(page, provider);
    await page.locator('#savePhotoDescription').click();
    await expect(page.locator('#photoSaveStatus')).toContainText('saved to your private account');
    await goTo(page, 'My Collection');
    const photo = page.locator('#collectionList img.saved-coin-photo');
    await expect(photo).toHaveAttribute('alt', 'Your photo of Photographed 1979-D cent');
    await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const storedPath = provider.collection[0].photo_path;
    expect(storedPath).toMatch(new RegExp('^' + userId + '/[^/]+\\.jpg$'));
    expect(provider.photos.has(storedPath)).toBe(true);
    await expectGuestDataUnchanged(page);

    await page.reload();
    await expect(page.locator('#profileName')).toHaveValue('Test Collector');
    await goTo(page, 'My Collection');
    await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    provider.failPhotoDownload = true;
    await page.reload();
    await expect(page.locator('#profileName')).toHaveValue('Test Collector');
    await goTo(page, 'My Collection');
    await expect(page.locator('#collectionList')).toContainText('Photographed 1979-D cent');
    await expect(page.locator('#collectionList .photo-unavailable')).toContainText('Photo unavailable');
    provider.failPhotoDownload = false;
    await page.locator('#accountNav').click();
    await page.locator('#retryAccount').click();
    await goTo(page, 'My Collection');
    await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.getByRole('button', { name: 'Edit Photographed 1979-D cent' }).click();
    await page.getByLabel('Coin name', { exact: true }).fill('My photographed cent');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('#collectionList')).toContainText('My photographed cent');
    expect(provider.collection[0].photo_path).toBe(storedPath);
    const edit = provider.requests.find(req => req.method === 'PATCH' && req.path === '/rest/v1/collection_items');
    expect(edit.body).not.toHaveProperty('photo_path');

    const second = await browser.newPage({ baseURL });
    try {
      const secondProvider = await providerFixture(second);
      secondProvider.collection = provider.collection;
      secondProvider.photos = provider.photos;
      secondProvider.photoBytes = provider.photoBytes;
      await signIn(second);
      await goTo(second, 'My Collection');
      await expect.poll(() => second.locator('#collectionList img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expectGuestDataUnchanged(second);
    } finally { await second.close(); }

    await page.getByRole('button', { name: 'Remove coin' }).click();
    await expect(page.locator('#collectionList')).not.toContainText('My photographed cent');
    expect(provider.collection).toEqual([]);
    expect(provider.photos.size).toBe(0);
    const deletes = provider.requests.filter(req => req.method === 'DELETE');
    expect(deletes.map(req => req.path)).toEqual(['/rest/v1/collection_items', '/storage/v1/object/coin-photos']);
    await expectGuestDataUnchanged(page);
  });

  test('a rejected private photo upload preserves the draft and creates no coin row', async ({ page }) => {
    const provider = await providerFixture(page);
    provider.failPhotoUpload = true;
    await signIn(page);
    await choosePhoto(page, provider, 'Unsaved photo');
    await page.locator('#savePhotoDescription').click();
    await expect(page.locator('#photoSaveStatus')).toContainText(/not saved|could not|try again|retry/i);
    await expect(page.locator('#photoCoinName')).toHaveValue('Unsaved photo');
    await expect(page.locator('#preview')).toBeVisible();
    expect(provider.requests.filter(req => req.method === 'POST' && req.path === '/rest/v1/collection_items')).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  test('Retry shares an in-flight restored-session load and cannot overwrite newer photo data', async ({ page }) => {
    const provider = await providerFixture(page);
    await signIn(page);
    const path = userId + '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    provider.photos.add(path);
    const encoded = await page.evaluate(() => document.createElement('canvas').toDataURL('image/jpeg').split(',')[1]);
    provider.photoBytes = Buffer.from(encoded, 'base64');
    provider.collection = [{ id: '33333333-3333-4333-8333-333333333333', owner_id: userId, name: 'Earlier photo snapshot', notes: '', photo_path: path, reference_id: null, created_at: timestamp }];
    const reads = () => provider.requests.filter(req => req.method === 'GET' && req.path === '/rest/v1/collection_items').length;
    const before = reads();
    const gate = deferred();
    provider.collectionReadGate = gate;
    try {
      await page.reload();
      await expect.poll(reads).toBe(before + 1);
      await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
      await page.locator('#accountNav').click();
      await expect(page.locator('#member')).toBeVisible();
      // A later server snapshot is available, but Retry must join the already
      // pending read rather than starting a competing hydration operation.
      provider.collection[0].name = 'Newest photo snapshot';
      await page.locator('#retryAccount').click();
      await goTo(page, 'My Collection');
      await page.getByLabel('Coin name', { exact: true }).fill('Blocked during account load');
      await page.getByRole('button', { name: 'Add to My Vault', exact: true }).click();
      await expect(page.locator('#profileForm .account-status')).toContainText('still loading');
      await expect(page.locator('#retryAccount')).toBeDisabled();
      expect(reads()).toBe(before + 1);
      expect(provider.requests.some(req => req.method === 'POST' && req.path === '/rest/v1/collection_items')).toBe(false);
      gate.resolve();
      await expect(page.locator('#retryAccount')).toBeEnabled();
      await goTo(page, 'My Collection');
      await expect(page.locator('#collectionList')).toContainText('Earlier photo snapshot');
      expect(reads()).toBe(before + 1);

      await page.locator('#accountNav').click();
      await page.locator('#retryAccount').click();
      await expect(page.locator('#retryAccount')).toBeEnabled();
      await goTo(page, 'My Collection');
      await expect(page.locator('#collectionList')).toContainText('Newest photo snapshot');
      await expect(page.locator('#collectionList')).not.toContainText('Earlier photo snapshot');
      await expect.poll(() => page.locator('#collectionList img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(reads()).toBe(before + 2);
      await expectGuestDataUnchanged(page);
    } finally { gate.resolve(); }
  });

  for (const flow of ['recovery code', 'confirmation code', 'password sign-in', 'signup session']) {
    test(`sign-out wins over a delayed ${flow} response and clears the SDK session`, async ({ page }) => {
      const mail = { code: '01234567', confirmation: '00123456' };
      const provider = await providerFixture(page, { recoveryMail: mail });
      provider.collection.push({ id: '33333333-3333-4333-8333-333333333333', owner_id: userId, name: 'Private account before logout', notes: '', reference_id: null, photo_path: null, created_at: timestamp });
      await signIn(page);
      const gate = deferred();
      try {
        if (flow === 'recovery code') {
          provider.verifyGate = gate;
          await page.evaluate(() => window.go('forgot-password'));
          await page.locator('#recoveryEmail').fill(email);
          await page.locator('#recoveryCode').fill(mail.code);
          await page.locator('#otpRecoveryForm button[type="submit"]').click();
        } else if (flow === 'confirmation code') {
          provider.verifyGate = gate;
          await page.evaluate(() => window.go('create-account'));
          await page.getByText('Already have a confirmation code?', { exact: true }).click();
          await page.locator('#confirmEmailAddress').fill(email);
          await page.locator('#confirmEmailCode').fill(mail.confirmation);
          await page.locator('#confirmEmailForm button[type="submit"]').click();
        } else if (flow === 'password sign-in') {
          provider.passwordGate = gate;
          await page.evaluate(() => window.go('sign-in'));
          await page.locator('#signInEmail').fill(email);
          await page.locator('#signInPassword').fill(password);
          await page.locator('#signInForm button[type="submit"]').click();
        } else {
          provider.signupGate = gate;
          provider.signupReturnsSession = true;
          await page.evaluate(() => window.go('create-account'));
          await page.locator('#createName').fill('Late signup');
          await page.locator('#createEmail').fill(email);
          await page.locator('#createPassword').fill(password);
          await page.locator('#createAccountForm button[type="submit"]').click();
        }
        const requestPath = flow.endsWith('code') ? '/auth/v1/verify' : flow === 'signup session' ? '/auth/v1/signup' : '/auth/v1/token';
        await expect.poll(() => provider.requests.filter(req => req.path === requestPath && req.method === 'POST').length).toBe(flow === 'password sign-in' ? 2 : 1);
        await page.evaluate(() => window.go('member'));
        await page.locator('#signOut').click();
        await expect(page.locator('#signInEmail')).toBeDisabled();
        await expect(page.locator('#collectionList')).not.toContainText('Private account before logout');
        const privateReads = provider.requests.filter(req => /^\/rest\/v1\/(profiles|collection_items|watchlist_items)$/.test(req.path)).length;
        gate.resolve();
        await expect(page.locator('#signInForm .account-status')).toContainText('You are signed out');
        await expect(page.locator('#signInEmail')).toBeEnabled();
        await expect(page.locator('#member')).toBeHidden();
        await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
        await expect(page.locator('#newPassword')).toBeDisabled();
        expect(provider.requests.filter(req => /^\/rest\/v1\/(profiles|collection_items|watchlist_items)$/.test(req.path)).length).toBe(privateReads);
        expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-coinxchange-tests-auth-token')))).toEqual([]);
        await page.reload();
        await expect(page.locator('#signInEmail')).toBeEnabled();
        await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
        await expectGuestDataUnchanged(page);
      } finally { gate.resolve(); }
    });
  }

  test('sign-out discards a private photo download that finishes afterward', async ({ page }) => {
    const provider = await providerFixture(page);
    const path = userId + '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    provider.photos.add(path);
    provider.collection.push({ id: '33333333-3333-4333-8333-333333333333', owner_id: userId, name: 'Delayed private photo', notes: '', reference_id: null, photo_path: path, created_at: timestamp });
    const gate = deferred();
    provider.photoDownloadGate = gate;
    try {
      await page.goto(appPath);
      const encoded = await page.evaluate(() => document.createElement('canvas').toDataURL('image/jpeg').split(',')[1]);
      provider.photoBytes = Buffer.from(encoded, 'base64');
      await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.locator('#signInEmail').fill(email);
      await page.locator('#signInPassword').fill(password);
      await page.locator('#signInForm button[type="submit"]').click();
      await expect.poll(() => provider.requests.filter(req => req.method === 'GET' && req.path.startsWith('/storage/v1/object/coin-photos/')).length).toBe(1);
      expect(provider.requests.find(req => req.method === 'GET' && req.path.startsWith('/storage/v1/object/coin-photos/')).headers.authorization).toMatch(/^Bearer /);
      await page.evaluate(() => window.go('member'));
      await page.locator('#signOut').click();
      await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
      gate.resolve();
      await expect(page.locator('#collectionList')).not.toContainText('Delayed private photo');
      await expect(page.locator('#collectionList img')).toHaveCount(0);
      await expectGuestDataUnchanged(page);
    } finally { gate.resolve(); }
  });

  test('sign-out clears private data and ignores an account save that completes afterward', async ({ page }) => {
    const provider = await providerFixture(page);
    provider.collection.push({ id: '33333333-3333-4333-8333-333333333333', owner_id: userId, name: 'Private existing coin', notes: '', reference_id: null, created_at: timestamp });
    await signIn(page);
    await goTo(page, 'My Collection');
    await expect(page.locator('#collectionList')).toContainText('Private existing coin');

    const gate = deferred();
    provider.insertGate = gate;
    try {
      await page.getByLabel('Coin name', { exact: true }).fill('Private late response');
      await page.getByRole('button', { name: 'Add to My Vault', exact: true }).click();
      await expect.poll(() => provider.requests.filter(request => request.method === 'POST' && request.path === '/rest/v1/collection_items').length).toBe(1);
      await page.locator('#accountNav').click();
      await page.locator('#signOut').click();
      await expect(page.locator('#accountNav')).not.toHaveText(/My Account/);
      await expect(page.locator('#collectionList')).not.toContainText('Private existing coin');
      gate.resolve();
      await expect.poll(() => provider.collection.some(row => row.name === 'Private late response')).toBe(true);
      await expect(page.locator('#collectionList')).not.toContainText('Private late response');
      await expectGuestDataUnchanged(page);
    } finally {
      gate.resolve();
    }
  });

  test('a configured guest must sign in before saving a coin to an account', async ({ page }) => {
    const provider = await providerFixture(page);
    await page.goto(appPath);
    await expect(page.locator('#signInEmail')).toBeEnabled();
    await page.getByRole('button', { name: 'Explore Coins', exact: true }).click();
    await goTo(page, 'My Collection');
    await page.getByLabel('Coin name', { exact: true }).fill('Guest attempted cloud save');
    await page.getByRole('button', { name: 'Add to My Vault', exact: true }).click();
    await expect(page.locator('#signInPanel')).toBeVisible();
    expect(provider.requests.filter(request => request.path.startsWith('/rest/v1/'))).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  test('password recovery completes through a verified PKCE session and clears submitted passwords', async ({ page }) => {
    const provider = await providerFixture(page);
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await expect(page.locator('#recoveryEmail')).toBeEnabled();
    await page.locator('#recoveryEmail').fill(email);
    await page.locator('#recoveryForm').getByRole('button', { name: 'Send recovery email', exact: true }).click();
    await expect(page.locator('#recoveryForm .account-status')).toContainText(/email|link/i);
    const recover = provider.requests.find(request => request.path === '/auth/v1/recover');
    expect(recover.body.email).toBe(email);
    expect(recover.body.code_challenge).toBeTruthy();

    await page.goto(`${appPath}?account=recovery&code=recovery-code`);
    await expect(page.locator('#resetPasswordPanel')).toBeVisible();
    await expect(page.locator('#newPassword')).toBeEnabled();
    const newPassword = 'A-New-Coin-Password-2026!';
    await page.locator('#newPassword').fill(newPassword);
    await page.locator('#confirmNewPassword').fill(newPassword);
    await page.locator('#resetPasswordForm').getByRole('button', { name: 'Update password', exact: true }).click();
    await expect(page.locator('#resetPasswordPanel .account-status')).toContainText(/password updated/i);
    await expect(page.locator('#newPassword')).toHaveValue('');
    await expect(page.locator('#confirmNewPassword')).toHaveValue('');
    expect(provider.requests.some(request => request.path === '/auth/v1/token' && request.search.includes('grant_type=pkce'))).toBe(true);
    expect(provider.requests.some(request => request.path === '/auth/v1/user' && request.method === 'PUT' && request.body.password === newPassword)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(newPassword);
    await expectGuestDataUnchanged(page);
  });

  test('a recovery email requested in one browser profile resets the password in another', async ({ page, browser, baseURL }) => {
    const recoveryMail = {};
    const requester = await browser.newPage({ baseURL });
    try {
      await providerFixture(requester, { recoveryMail });
      await requester.goto(appPath);
      await requester.evaluate(() => window.go('forgot-password'));
      await requester.locator('#recoveryEmail').fill(email);
      await requester.locator('#recoveryForm button[type="submit"]').click();
      await expect(requester.locator('#recoveryForm .account-status')).toContainText(/email will arrive/i);
    } finally {
      await requester.close();
    }
    const provider = await providerFixture(page, { recoveryMail });
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await page.locator('#recoveryEmail').fill(email);
    const usedCode = recoveryMail.code;
    await page.locator('#recoveryCode').fill(recoveryMail.code);
    await page.locator('#otpRecoveryForm').getByRole('button', { name: 'Verify code' }).click();
    await expect(page.locator('#resetPasswordPanel')).toBeVisible();
    await expect(page.locator('#newPassword')).toBeEnabled();
    await page.locator('#newPassword').fill('Updated-Collection-2026!');
    await page.locator('#confirmNewPassword').fill('Updated-Collection-2026!');
    await page.locator('#resetPasswordForm button[type="submit"]').click();
    await expect(page.locator('#resetPasswordForm .account-status')).toContainText(/password updated/i);
    expect(provider.requests.some(req => req.method === 'PUT' && req.path === '/auth/v1/user' && req.body.password === 'Updated-Collection-2026!')).toBe(true);
    expect(provider.requests.some(req => req.path === '/auth/v1/verify' && req.body?.type === 'recovery')).toBe(true);
    await page.evaluate(() => window.go('forgot-password'));
    await page.locator('#recoveryCode').fill(usedCode);
    await page.locator('#otpRecoveryForm button[type="submit"]').click();
    await expect(page.locator('#otpRecoveryForm .account-status')).toContainText(/invalid|expired/);
    await expect(page.locator('#newPassword')).toBeDisabled();
    await expectGuestDataUnchanged(page);
  });

  test('an invalid email code cannot unlock a password change', async ({ page }) => {
    const provider = await providerFixture(page);
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await page.locator('#recoveryEmail').fill(email);
    await page.locator('#recoveryCode').fill('000000');
    await page.locator('#otpRecoveryForm').getByRole('button', { name: 'Verify code' }).click();
    await expect(page.locator('#otpRecoveryForm .account-status')).toContainText(/invalid|expired/i);
    await expect(page.locator('#newPassword')).toBeDisabled();
    expect(provider.requests.filter(req => req.path === '/auth/v1/user' && req.method === 'PUT')).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  test('an expired recovery link shows a failure and cannot update a password', async ({ page }) => {
    const provider = await providerFixture(page);
    await page.goto(appPath);
    await page.locator('#welcomeScreen').getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await expect(page.locator('#recoveryEmail')).toBeEnabled();
    await page.locator('#recoveryEmail').fill(email);
    await page.locator('#recoveryForm').getByRole('button', { name: 'Send recovery email', exact: true }).click();
    await expect(page.locator('#recoveryForm .account-status')).toContainText(/email|link/i);
    provider.failExchange = true;

    await page.goto(`${appPath}?account=recovery&code=expired-code`);
    await expect(page.locator('#recoveryForm .account-status')).toContainText(/expired|invalid|could not|unable|new.*link/i);
    await expect(page.locator('#newPassword')).toBeDisabled();
    expect(provider.requests.filter(request => request.path === '/auth/v1/user' && request.method === 'PUT')).toEqual([]);
    await expectGuestDataUnchanged(page);
  });

  test('an existing sign-in session cannot authorize an expired recovery link', async ({ page }) => {
    const provider = await providerFixture(page);
    await signIn(page);
    // A member can open a recovery link while an older valid session remains
    // in this browser. That session must not make an invalid link actionable.
    await page.evaluate(() => window.go('forgot-password'));
    await expect(page.locator('#recoveryEmail')).toBeEnabled();
    await page.locator('#recoveryEmail').fill(email);
    await page.locator('#recoveryForm').getByRole('button', { name: 'Send recovery email', exact: true }).click();
    await expect(page.locator('#recoveryForm .account-status')).toContainText(/email|link/i);
    provider.failExchange = true;

    await page.goto(`${appPath}?account=recovery&code=expired-while-signed-in`);
    await expect(page.locator('#recoveryForm .account-status')).toContainText(/expired|invalid|could not|unable|new.*link/i);
    await expect(page.locator('#newPassword')).toBeDisabled();
    await expect(page.locator('#confirmNewPassword')).toBeDisabled();
    expect(provider.requests.some(request => request.path === '/auth/v1/token' && request.search.includes('grant_type=pkce'))).toBe(true);
    expect(provider.requests.filter(request => request.path === '/auth/v1/user' && request.method === 'PUT')).toEqual([]);
    await expectGuestDataUnchanged(page);
  });
});
