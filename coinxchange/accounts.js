// Account data is deliberately separate from the existing cx_* guest records.
// PostgreSQL RLS, not these UI checks, is the authority for every private row.
const bridge = window.coinxchangeBridge;
const rawConfig = window.COINXCHANGE_CONFIG || {};
const byId = id => document.getElementById(id);

function publicConfig(config) {
  if (!config.supabaseUrl && !config.supabasePublishableKey) return null;
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('A valid HTTPS project URL is required.');
  }
  const key = String(config.supabasePublishableKey || '').trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
    let payload;
    try {
      const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    } catch {
      throw new Error('A publishable or legacy anon key is required.');
    }
    if (payload.role !== 'anon') throw new Error('Privileged keys must never be used in a browser.');
  }
  return { url: url.origin, key };
}

function unavailable() {
  document.querySelectorAll('.phase-demo-notice').forEach(node => {
    node.textContent = 'Member accounts are unavailable while setup is completed. Account fields are disabled. You can explore the guest demonstration.';
  });
}

let config;
try {
  config = publicConfig(rawConfig);
} catch {
  // Never echo configuration values, keys, tokens, or provider responses.
  unavailable();
}

if (config && bridge) {
  startAccounts(config).catch(() => {
    unavailable();
    document.querySelectorAll('#accountScreen input, #accountScreen button[type="submit"]')
      .forEach(node => { node.disabled = true; });
    if (byId('accountState')) byId('accountState').textContent = 'Member accounts are unavailable. Please try again later.';
  });
}

async function startAccounts({ url, key }) {
  let client;
  let user = null;
  let items = [];
  let tracked = [];
  let generation = 0;
  let loaded = false;
  let operationBusy = false;
  let signingOut = false;
  let editingId = null;
  const recoveryRequested = new URL(location.href).searchParams.get('account') === 'recovery';
  let recovery = false;
  let recoveryUserId = null;
  let callbackFailed = false;
  const arrivedWithCode = new URL(location.href).searchParams.has('code');
  const arrivedWithError = new URL(location.href).searchParams.has('error') ||
    new URLSearchParams(location.hash.slice(1)).has('error');
  const pendingForms = new Map();
  const pageUrl = new URL('.', location.href).href;
  const recoveryUrl = pageUrl + '?account=recovery';
  let currentSessionTask = Promise.resolve();

  // Block cloud-mode writes immediately, even while the SDK is loading.
  window.coinxchangeAccounts = Object.freeze({
    configured: true,
    get signedIn() { return Boolean(user); },
    addCoin,
    removeCoin,
    toggleWatch
  });

  buildAccountForms();
  buildMemberSection();
  const originalRenderCollection = window.renderCollection;
  window.renderCollection = () => {
    originalRenderCollection();
    if (!user || !loaded) return;
    byId('collectionList').querySelectorAll('.item').forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'textbtn';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', 'Edit ' + item.name);
      edit.onclick = () => {
        editingId = item.id;
        byId('collectionName').value = item.name;
        byId('collectionNotes').value = item.notes || '';
        byId('addCoin').textContent = 'Save changes';
        byId('cancelCoinEdit').hidden = false;
        window.go('collection');
        byId('collectionName').focus();
      };
      row.querySelector('[data-remove]').before(edit);
    });
  };

  restoreGuest();
  const { createClient } = await import('./vendor/supabase.js');
  client = createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: fetchWithTimeout }
  });
  attachForms();

  // Keep this listener synchronous. All provider calls happen after it returns.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      callbackFailed = false;
      recovery = true;
      recoveryUserId = session.user.id;
    }
    if (event === 'SIGNED_OUT') {
      recovery = false;
      recoveryUserId = null;
    }
    if (signingOut && session) return;
    if (session && user?.id === session.user.id && loaded &&
        !['PASSWORD_RECOVERY', 'USER_UPDATED'].includes(event)) return;
    const epoch = ++generation;
    clearPrivateView();
    if (!session) restoreGuest();
    currentSessionTask = new Promise(resolve => {
      setTimeout(() => resolve(acceptSession(session, epoch, event)), 0);
    });
  });

  // initialize() reuses the SDK's automatic initialization promise. A failed
  // callback may deliberately retain an earlier session: inspect that error.
  const initialization = await client.auth.initialize();
  callbackFailed = arrivedWithError || Boolean(initialization.error) ||
    (arrivedWithCode && new URL(location.href).searchParams.has('code'));
  if (callbackFailed) {
    recovery = false;
    recoveryUserId = null;
  }
  const { data, error } = await client.auth.getSession();
  if (error) showAuthError(error, byId('signInForm'), 'Could not restore your session. Please sign in again.');
  await currentSessionTask;
  if (data.session && !user && !signingOut && !error) {
    const epoch = ++generation;
    await acceptSession(data.session, epoch, 'INITIAL_SESSION');
  }
  enablePublicForms();
  if (recoveryRequested || recovery || callbackFailed || (arrivedWithCode && !user)) {
    if (recovery && user?.id === recoveryUserId && !callbackFailed) showRecovery();
    else {
      history.replaceState(null, '', pageUrl);
      window.go('forgot-password');
      status(byId('recoveryForm'), 'This account link is invalid, expired, or was opened in a different browser. Enter the code from your email, or request a new email.', true);
    }
  }

  function status(form, text, isError = false) {
    const node = form?.querySelector('.account-status');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('account-error', isError);
  }

  function showAuthError(error, form, fallback) {
    const code = String(error?.code || '');
    let message = fallback;
    if (error?.status === 429 || code.includes('rate_limit')) {
      message = 'Too many attempts. Please wait a few minutes and try again.';
    } else if (code === 'email_not_confirmed') {
      message = 'Please confirm your email using the message from COINXCHANGE, then sign in.';
    } else if (code === 'invalid_credentials' || error?.status === 400) {
      message = 'We could not complete this request. Check your details or request a new account link.';
    } else if (code === 'weak_password') {
      message = 'Choose a stronger password with at least 12 characters.';
    }
    status(form, message, true);
  }

  function clearPrivateView() {
    user = null;
    items = [];
    tracked = [];
    loaded = false;
    operationBusy = false;
    resetCoinEditor();
    bridge.showData([], []);
    byId('profileName').value = '';
    byId('memberEmail').textContent = '';
    byId('accountNav').textContent = 'Member sign in';
    byId('accountState').textContent = 'Checking account access…';
    byId('vaultStorageNotice').textContent = 'Sign in to view and save your account collection.';
    byId('homeStorageLabel').textContent = 'Account access required';
    byId('profileForm').querySelector('button').disabled = true;
    byId('resetPasswordForm').querySelectorAll('input, button[type="submit"]').forEach(node => { node.disabled = true; });
  }

  function restoreGuest() {
    bridge.showData(bridge.readGuestCollection(), bridge.readGuestWatch());
    byId('accountState').textContent = 'Browsing as a guest';
    byId('vaultStorageNotice').textContent = 'Any saved guest coins shown here remain on this device. Sign in to use your private account vault. Guest records are not uploaded automatically.';
    byId('homeStorageLabel').textContent = 'Saved on this device';
    byId('accountNav').textContent = 'Member sign in';
  }

  async function acceptSession(session, epoch, event) {
    if (!session || epoch !== generation) return;
    if (callbackFailed) {
      restoreGuest();
      return;
    }
    try {
      const { data, error } = await client.auth.getUser();
      if (epoch !== generation) return;
      if (error || !data.user || data.user.id !== session.user.id) {
        restoreGuest();
        status(byId('signInForm'), 'Your session could not be verified. Please sign in again.', true);
        if (arrivedWithCode || event === 'SIGNED_IN') window.go('sign-in');
        return;
      }
      user = data.user;
      byId('memberEmail').textContent = user.email || '';
      byId('accountNav').textContent = 'My Account';
      byId('accountState').textContent = 'Signed in · loading your saved coins';
      byId('vaultStorageNotice').textContent = 'Loading your private account collection…';
      if (recovery) showRecovery();
      await loadAccount(epoch);
      if (epoch !== generation) return;
      if (!recovery && ['SIGNED_IN', 'INITIAL_SESSION'].includes(event) &&
          (!byId('accountScreen').hidden || !byId('welcomeScreen').hidden)) {
        window.go('member');
      }
    } catch {
      if (epoch !== generation) return;
      byId('accountState').textContent = 'Could not load account data. Use Retry in My Account.';
      byId('vaultStorageNotice').textContent = 'Your saved coins could not be loaded. Nothing was changed. Retry from My Account.';
    }
  }

  async function loadAccount(epoch = generation) {
    if (!user) return;
    if (operationBusy || pendingForms.get('profileForm')?.generation === generation) {
      status(byId('profileForm'), 'Please wait for the current save to finish, then retry.');
      return;
    }
    const owner = user.id;
    loaded = false;
    byId('profileForm').querySelector('button').disabled = true;
    try {
      const [profile, collectionResult, watchResult] = await Promise.all([
        client.from('profiles').select('id,display_name').eq('id', owner).single(),
        allRows('collection_items', 'id,owner_id,name,notes,reference_id,created_at', owner),
        allRows('watchlist_items', 'owner_id,reference_id,created_at', owner)
      ]);
      if (epoch !== generation || user?.id !== owner) return;
      if (profile.error) throw profile.error;
      if (!profile.data || profile.data.id !== owner) throw new Error('Profile unavailable.');
      if (collectionResult.some(row => row.owner_id !== owner) || watchResult.some(row => row.owner_id !== owner)) {
        throw new Error('Unexpected owner in account response.');
      }
      items = collectionResult;
      tracked = watchResult.map(row => row.reference_id);
      byId('profileName').value = profile.data.display_name;
      byId('profileForm').querySelector('button').disabled = false;
      loaded = true;
      bridge.showData(items, tracked);
      byId('accountState').textContent = 'Signed in · private account storage';
      byId('vaultStorageNotice').textContent = 'Your private collection is saved to your account and available when you sign in on another device.';
      byId('homeStorageLabel').textContent = 'Saved to your account';
      status(byId('profileForm'), '');
    } catch {
      if (epoch !== generation || user?.id !== owner) return;
      loaded = false;
      items = [];
      tracked = [];
      bridge.showData([], []);
      byId('accountState').textContent = 'Signed in · account storage unavailable';
      byId('vaultStorageNotice').textContent = 'We could not load your account collection. Nothing was changed. Use Retry in My Account.';
      status(byId('profileForm'), 'Could not load your profile or saved coins. Please retry.', true);
    }
  }

  async function allRows(table, columns, owner) {
    const rows = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const result = await client.from(table).select(columns).eq('owner_id', owner)
        .order('created_at', { ascending: false })
        .order(table === 'collection_items' ? 'id' : 'reference_id', { ascending: false })
        .range(offset, offset + 499);
      if (result.error) throw result.error;
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
    throw new Error('Collection too large to load safely.');
  }

  function requireAccount() {
    if (!user) {
      window.go('sign-in');
      status(byId('signInForm'), 'Sign in to save coins and watchlists to your account.');
      return false;
    }
    if (!loaded) {
      window.go('member');
      status(byId('profileForm'), 'Your account data is still loading or unavailable. Please retry before making changes.', true);
      return false;
    }
    return true;
  }

  async function mutate(work, success) {
    if (!requireAccount() || operationBusy) return false;
    const owner = user.id;
    const epoch = generation;
    operationBusy = true;
    try {
      const result = await work(owner);
      if (epoch !== generation || user?.id !== owner) return false;
      if (result.error) throw result.error;
      success(result.data);
      bridge.showData(items, tracked);
      return true;
    } catch {
      if (epoch === generation && user?.id === owner) {
        bridge.toast('Could not save this account change. Nothing was saved to guest storage. Please retry.');
      }
      return false;
    } finally {
      if (epoch === generation) operationBusy = false;
    }
  }

  async function addCoin(coin, options = {}) {
    if (!requireAccount()) return false;
    const name = String(coin.name || '').trim();
    const notes = String(coin.notes || '').trim();
    if (!name || name.length > 160 || notes.length > 2000) {
      bridge.toast('Use a coin name of 1–160 characters and notes up to 2,000 characters.');
      return false;
    }
    const edit = options.fromForm ? editingId : null;
    const changes = { name, notes, reference_id: coin.referenceId || null };
    const ok = await mutate(owner => edit
      ? client.from('collection_items').update({ name, notes }).eq('owner_id', owner).eq('id', edit)
        .select('id,owner_id,name,notes,reference_id,created_at').single()
      : client.from('collection_items').insert({ ...changes, owner_id: owner })
        .select('id,owner_id,name,notes,reference_id,created_at').single(),
    row => {
      if (!row || row.owner_id !== user.id) throw new Error('Unexpected saved coin.');
      items = edit ? items.map(item => item.id === edit ? row : item) : [row, ...items];
    });
    if (ok) {
      if (options.fromForm) resetCoinEditor();
      bridge.toast(edit ? 'Account coin updated.' : 'Saved to your account vault.');
    }
    return ok;
  }

  async function removeCoin(id) {
    if (!requireAccount() || !id) return false;
    const ok = await mutate(owner => client.from('collection_items').delete()
      .eq('owner_id', owner).eq('id', id).select('id').single(),
    row => {
      if (!row || row.id !== id) throw new Error('Coin removal was not confirmed.');
      items = items.filter(item => item.id !== id);
      if (editingId === id) resetCoinEditor();
    });
    if (ok) bridge.toast('Removed from your account vault.');
    return ok;
  }

  async function toggleWatch(referenceId) {
    if (!requireAccount()) return false;
    const alreadyTracked = tracked.includes(referenceId);
    return mutate(owner => alreadyTracked
      ? client.from('watchlist_items').delete().eq('owner_id', owner).eq('reference_id', referenceId)
        .select('reference_id').single()
      : client.from('watchlist_items').insert({ owner_id: owner, reference_id: referenceId })
        .select('reference_id').single(),
    row => {
      if (!row || row.reference_id !== referenceId) throw new Error('Watchlist change was not confirmed.');
      tracked = alreadyTracked ? tracked.filter(id => id !== referenceId) : [...tracked, referenceId];
      bridge.toast('Account watchlist updated.');
    });
  }

  function resetCoinEditor() {
    editingId = null;
    byId('collectionName').value = '';
    byId('collectionNotes').value = '';
    byId('addCoin').textContent = 'Add to My Vault';
    if (byId('cancelCoinEdit')) byId('cancelCoinEdit').hidden = true;
  }

  function showRecovery() {
    window.go('reset-password');
    const form = byId('resetPasswordForm');
    const allowed = Boolean(user && recovery && user.id === recoveryUserId && !callbackFailed);
    form.querySelectorAll('input, button[type="submit"]').forEach(node => { node.disabled = !allowed; });
    byId('resetAccountEmail').textContent = allowed ? 'Account: ' + (user.email || '') : '';
    if (!allowed) status(form, 'Use a valid reset link to update your password.', true);
  }

  function enablePublicForms() {
    for (const id of ['signInForm', 'createAccountForm', 'recoveryForm', 'otpRecoveryForm']) {
      if (!pendingForms.has(id)) {
        byId(id).querySelectorAll('input, button[type="submit"]').forEach(node => { node.disabled = false; });
      }
    }
  }

  function submit(formId, action) {
    const form = byId(formId);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const pending = pendingForms.get(formId);
      if ((pending && (formId !== 'profileForm' || pending.generation === generation)) || !form.reportValidity()) return;
      if (signingOut) {
        status(form, 'Please wait for sign-out to finish, then try again.');
        return;
      }
      const ticket = { generation };
      pendingForms.set(formId, ticket);
      const controls = Array.from(form.querySelectorAll('input, button[type="submit"]'));
      controls.forEach(node => { node.disabled = true; });
      status(form, 'Working…');
      try {
        await action(form);
      } catch {
        status(form, 'The request could not be completed. Check your connection and try again.', true);
      } finally {
        if (pendingForms.get(formId) === ticket) {
          pendingForms.delete(formId);
          controls.forEach(node => {
            node.disabled = (formId === 'resetPasswordForm' && (!user || !recovery || user.id !== recoveryUserId || callbackFailed)) ||
              (formId === 'profileForm' && (!user || !loaded));
          });
        }
      }
    });
  }

  function attachForms() {
    submit('signInForm', async form => {
      recovery = false;
      recoveryUserId = null;
      callbackFailed = false;
      const email = byId('signInEmail').value.trim();
      const password = byId('signInPassword').value;
      const result = await client.auth.signInWithPassword({ email, password });
      byId('signInPassword').value = '';
      if (result.error) {
        showAuthError(result.error, form, 'Sign-in failed. Check your email and password, then try again.');
        return;
      }
      if (!result.data.session) {
        status(form, 'A sign-in session was not returned. Please try again.', true);
        return;
      }
      await currentSessionTask;
      if (user) {
        status(form, '');
        window.go('member');
      }
    });
    submit('createAccountForm', async form => {
      recovery = false;
      recoveryUserId = null;
      callbackFailed = false;
      const displayName = byId('createName').value.trim();
      const email = byId('createEmail').value.trim();
      const password = byId('createPassword').value;
      if (!displayName) {
        status(form, 'Enter a display name.', true);
        return;
      }
      const result = await client.auth.signUp({
        email, password,
        options: { data: { display_name: displayName }, emailRedirectTo: pageUrl }
      });
      byId('createPassword').value = '';
      if (result.error) {
        showAuthError(result.error, form, 'Account creation could not be completed. Please try again later.');
        return;
      }
      if (!result.data.session) {
        status(form, 'If this address can be registered, check your email to confirm your account. Open the link in this browser. If you already have an account, sign in or reset your password.');
        return;
      }
      await currentSessionTask;
      if (user) window.go('member');
    });
    submit('recoveryForm', async form => {
      const result = await client.auth.resetPasswordForEmail(byId('recoveryEmail').value.trim(), {
        redirectTo: recoveryUrl
      });
      if (result.error) {
        showAuthError(result.error, form, 'A reset email could not be requested. Please try again later.');
        return;
      }
      status(form, 'If an account exists for this address, a recovery email will arrive. Enter its code on any device, or open its link in this browser.');
    });
    // Six-digit recovery codes are verified by Supabase, never by client logic.
    // Requires the Supabase Recovery email template to include {{ .Token }}.
    submit('otpRecoveryForm', async form => {
      const email = byId('recoveryEmail').value.trim();
      const token = byId('recoveryCode').value.trim();
      if (!email || !/^[0-9]{6}$/.test(token)) {
        status(form, 'Enter your account email above and the six-digit code from your recovery email.', true);
        return;
      }
      const result = await client.auth.verifyOtp({ email, token, type: 'recovery' });
      byId('recoveryCode').value = '';
      if (result.error) {
        if (result.error.code === 'otp_expired') {
          status(form, 'That code is invalid or expired. Request a new recovery email.', true);
        } else {
          showAuthError(result.error, form, 'Could not verify the code. Try again.');
        }
        return;
      }
      // The SDK emits PASSWORD_RECOVERY. The shared listener verifies the
      // session with getUser before enabling the password form.
      await currentSessionTask;
      if (!result.data.session || !user || !recovery || user.id !== result.data.session.user.id) {
        status(form, 'Could not confirm the recovery session. Request another email.', true);
      }
    });
    submit('resetPasswordForm', async form => {
      if (!user || !recovery || user.id !== recoveryUserId || callbackFailed) {
        status(form, 'Your reset session has expired. Request a new reset link.', true);
        return;
      }
      const password = byId('newPassword').value;
      if (password !== byId('confirmNewPassword').value) {
        status(form, 'The passwords do not match.', true);
        return;
      }
      const owner = user.id;
      const result = await client.auth.updateUser({ password });
      byId('newPassword').value = '';
      byId('confirmNewPassword').value = '';
      if (result.error) {
        showAuthError(result.error, form, 'The password could not be updated. Request a new reset link and try again.');
        return;
      }
      await currentSessionTask;
      if (user?.id !== owner) return;
      recovery = false;
      recoveryUserId = null;
      history.replaceState(null, '', pageUrl);
      status(form, 'Password updated. You can continue to your account.');
      byId('continueToAccount').hidden = false;
    });
    submit('profileForm', async form => {
      if (!requireAccount()) return;
      const owner = user.id;
      const epoch = generation;
      const displayName = byId('profileName').value.trim();
      if (!displayName) {
        status(form, 'Enter a display name.', true);
        return;
      }
      const result = await client.from('profiles').update({ display_name: displayName })
        .eq('id', owner).select('id,display_name').single();
      if (epoch !== generation || user?.id !== owner) return;
      if (result.error || result.data?.id !== owner) {
        status(form, 'Your profile was not saved. Please retry.', true);
        return;
      }
      byId('profileName').value = result.data.display_name;
      status(form, 'Profile saved.');
    });
    byId('signOut').onclick = async () => {
      if (signingOut) return;
      signingOut = true;
      recovery = false;
      recoveryUserId = null;
      ++generation;
      clearPrivateView();
      restoreGuest();
      window.go('sign-in');
      status(byId('signInForm'), 'Signing out…');
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        status(byId('signInForm'), error
          ? 'Signed out on this device. The server could not confirm session revocation; please check your connection.'
          : 'You are signed out on this device.');
      } catch {
        status(byId('signInForm'), 'Sign-out could not be completed. Keep this device private and try again.', true);
      } finally {
        signingOut = false;
      }
    };
  }

  function buildAccountForms() {
    byId('accountScreen').setAttribute('aria-label', 'Member account');
    const forms = [
      ['signInPanel', 'signInForm',
        '<label for="signInEmail">Email address</label><input id="signInEmail" class="field" type="email" autocomplete="username" maxlength="254" required disabled>' +
        '<label for="signInPassword">Password</label><input id="signInPassword" class="field" type="password" autocomplete="current-password" maxlength="128" required disabled>',
        'Sign In', 'Sign in to access your private collection and watchlist.'],
      ['createAccountPanel', 'createAccountForm',
        '<label for="createName">Display name</label><input id="createName" class="field" autocomplete="nickname" minlength="1" maxlength="40" required disabled>' +
        '<label for="createEmail">Email address</label><input id="createEmail" class="field" type="email" autocomplete="username" maxlength="254" required disabled>' +
        '<label for="createPassword">Password</label><input id="createPassword" class="field" type="password" autocomplete="new-password" minlength="12" maxlength="128" required aria-describedby="passwordHelp" disabled><p id="passwordHelp" class="tiny">Use at least 12 characters. Confirmation links should be opened in this browser.</p>',
        'Create Account', 'Create an account for a private collection and watchlist. Community posts are still a local demonstration.'],
      ['forgotPasswordPanel', 'recoveryForm',
        '<label for="recoveryEmail">Email address</label><input id="recoveryEmail" class="field" type="email" autocomplete="email" maxlength="254" required disabled>',
        'Send recovery email', 'Request an email, or enter a code you already received.']
    ];
    forms.forEach(([panelId, formId, fields, label, copy]) => {
      const panel = byId(panelId);
      panel.querySelector('.phase-demo-notice').textContent = copy;
      panel.querySelectorAll(':scope > label, :scope > input, :scope > button:not(.phase-guest)').forEach(node => node.remove());
      const form = document.createElement('form');
      form.id = formId;
      form.innerHTML = fields + '<button class="btn" type="submit" disabled>' + label +
        '</button><p class="account-status tiny" role="status" aria-live="polite"></p>';
      panel.querySelector('.phase-account-links').before(form);
    });
    // This optional code form does not replace the existing reset-link flow.
    byId('recoveryForm').insertAdjacentHTML('afterend',
      '<form id="otpRecoveryForm"><p class="tiny">If your recovery email includes a six-digit code, enter it here. You can use the code on another device.</p>' +
      '<label for="recoveryCode">Six-digit email code</label>' +
      '<input id="recoveryCode" class="field" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required aria-describedby="recoveryCodeHelp" disabled>' +
      '<p id="recoveryCodeHelp" class="tiny">Use the email address entered above. Codes expire and can only be used once.</p>' +
      '<button class="btn secondary" type="submit" disabled>Verify code</button>' +
      '<p class="account-status tiny" role="status" aria-live="polite"></p></form>');
    byId('forgotPasswordPanel').querySelector(':scope > p:not(.phase-eyebrow)').textContent = 'We will help you recover access to your account.';
    const reset = document.createElement('section');
    reset.id = 'resetPasswordPanel';
    reset.className = 'phase-account-card';
    reset.hidden = true;
    reset.setAttribute('aria-labelledby', 'resetPasswordTitle');
    reset.innerHTML = '<p class="phase-eyebrow">ACCOUNT RECOVERY</p><h1 id="resetPasswordTitle" tabindex="-1">Choose a new password</h1>' +
      '<p id="resetAccountEmail" class="tiny"></p><form id="resetPasswordForm"><label for="newPassword">New password</label><input id="newPassword" class="field" type="password" autocomplete="new-password" minlength="12" maxlength="128" required disabled>' +
      '<label for="confirmNewPassword">Confirm new password</label><input id="confirmNewPassword" class="field" type="password" autocomplete="new-password" minlength="12" maxlength="128" required disabled>' +
      '<button class="btn" type="submit" disabled>Update password</button><p class="account-status tiny" role="status" aria-live="polite"></p></form>' +
      '<button id="continueToAccount" type="button" class="btn secondary" hidden>Continue to My Account</button>' +
      '<div class="phase-account-links"><button class="phase-link" type="button" id="requestAnotherReset">Request a new reset link</button></div>';
    byId('accountScreen').querySelector('.phase-account-shell').append(reset);
    bridge.addAccountPanel('reset-password', reset);
    byId('continueToAccount').onclick = () => window.go('member');
    byId('requestAnotherReset').onclick = () => window.go('forgot-password');
    byId('welcomeScreen').querySelector('.phase-demo-caption').textContent =
      'Browse the reference catalog freely. Sign in to save your private collection and watchlist.';
  }

  function buildMemberSection() {
    const style = document.createElement('style');
    style.textContent = '.account-status{min-height:1.5em;overflow-wrap:anywhere}.account-error{color:#ffbdad}.account-tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:18px}.account-tools p{margin:0}.account-profile{max-width:560px}#memberEmail{overflow-wrap:anywhere}.phase-account-card form .btn{margin-top:18px}#collectionList .item{flex-wrap:wrap}#collectionList .item>div:nth-child(2){min-width:100px;overflow-wrap:anywhere}[hidden]{display:none!important}';
    document.head.append(style);
    const controls = document.createElement('div');
    controls.className = 'account-tools';
    controls.innerHTML = '<button id="accountNav" class="btn secondary" type="button">Member sign in</button><p id="accountState" class="tiny" role="status" aria-live="polite">Checking account access…</p>';
    byId('mainContent').querySelector('.top').after(controls);
    byId('accountNav').onclick = () => window.go(user ? 'member' : 'sign-in');
    const member = document.createElement('section');
    member.id = 'member';
    member.className = 'section';
    member.innerHTML = '<span class="chip">MEMBER ACCOUNT</span><h1>My Account</h1><p id="memberEmail" class="muted"></p>' +
      '<div class="card account-profile"><h2>Your profile</h2><form id="profileForm"><label for="profileName">Display name</label><input class="field" id="profileName" autocomplete="nickname" minlength="1" maxlength="40" required>' +
      '<button class="btn" type="submit" disabled>Save profile</button><p class="account-status tiny" role="status" aria-live="polite"></p></form>' +
      '<div class="actions"><button id="retryAccount" class="btn secondary" type="button">Retry account data</button><button id="signOut" class="btn secondary" type="button">Sign Out</button></div></div>' +
      '<p class="tiny">Your profile, collection, and watchlist are private to your account. Community discussions remain a local demonstration on this device.</p>';
    byId('mainContent').querySelector('.foot').before(member);
    byId('retryAccount').onclick = async () => {
      if (!user) {
        window.go('sign-in');
        return;
      }
      byId('retryAccount').disabled = true;
      try { await loadAccount(); } finally { byId('retryAccount').disabled = false; }
    };
    byId('collection').querySelector(':scope > .muted').id = 'vaultStorageNotice';
    byId('homeCount').nextElementSibling.id = 'homeStorageLabel';
    byId('collectionName').maxLength = 160;
    byId('collectionNotes').maxLength = 2000;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'cancelCoinEdit';
    cancel.className = 'btn secondary';
    cancel.textContent = 'Cancel edit';
    cancel.hidden = true;
    cancel.onclick = resetCoinEditor;
    byId('addCoin').after(cancel);
  }
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(onAbort, 15000);
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}
