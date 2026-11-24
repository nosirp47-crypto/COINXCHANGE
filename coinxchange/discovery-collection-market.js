(function () {
const marketSection = document.getElementById('market');
const marketRows = document.getElementById('marketRows');
const marketTypes = [...new Set(catalog.map(coin => coin.type))];
let marketFilter = 'all';
let marketCategory = 'all';
let previewUrl = null;

const enhancementStyles = document.createElement('style');
enhancementStyles.textContent = `
  .market-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
  .market-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}
  .market-actions .btn,.market-actions .textbtn{white-space:nowrap}
  .market-actions .btn{padding:8px 10px;font-size:12px}
  .markettable td:last-child{text-align:right}
  .market-status{min-height:1.5em;margin:4px 0 0}
  .guide-checklist{padding-left:20px;color:var(--muted)}
  .guide-checklist li{margin:6px 0}
  @media(max-width:650px){.market-tools{grid-template-columns:1fr}.market-actions{justify-content:flex-start}}
`;
document.head.append(enhancementStyles);

const marketTools = document.createElement('div');
marketTools.className = 'market-tools';
marketTools.innerHTML = `
  <label class="tiny" for="marketCategory">Coin category
    <select id="marketCategory" class="field">
      <option value="all">All categories</option>
      ${marketTypes.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}
    </select>
  </label>
  <label class="tiny" for="marketScope">Catalog view
    <select id="marketScope" class="field">
      <option value="all">All reference coins</option>
      <option value="watchlist">My watchlist</option>
    </select>
  </label>
  <p class="tiny market-status" id="marketStatus" role="status" aria-live="polite"></p>
`;
marketSection.querySelector('h1').after(marketTools);
marketRows.closest('table').querySelector('thead tr').insertAdjacentHTML(
  'beforeend',
  '<th scope="col">Actions</th>'
);

const marketCategorySelect = document.getElementById('marketCategory');
const marketScopeSelect = document.getElementById('marketScope');
const marketStatus = document.getElementById('marketStatus');

function renderMarket() {
  const visibleCoins = catalog.filter(coin =>
    (marketCategory === 'all' || coin.type === marketCategory) &&
    (marketFilter === 'all' || watch.includes(coin.id))
  );
  const trackedCount = catalog.filter(coin => watch.includes(coin.id)).length;

  marketRows.innerHTML = visibleCoins.length
    ? visibleCoins.map(coin => `
      <tr>
        <td><strong>${esc(coin.name)}</strong></td>
        <td>${esc(coin.type)}</td>
        <td>${esc(coin.priority)}</td>
        <td>
          <div class="market-actions">
            <button type="button" class="textbtn" data-market-action="watch" data-coin-id="${esc(coin.id)}" aria-pressed="${watch.includes(coin.id)}">
              ${watch.includes(coin.id) ? '★ Watching' : '☆ Watch'}
            </button>
            <button type="button" class="btn secondary" data-market-action="explore" data-coin-id="${esc(coin.id)}">Explore</button>
            <button type="button" class="btn secondary" data-market-action="collect" data-coin-id="${esc(coin.id)}">Save to vault</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty">No coins match this view. Try another category or add a coin to your watchlist.</td></tr>';

  document.getElementById('watchCount').textContent = trackedCount;
  marketStatus.textContent = `${visibleCoins.length} of ${catalog.length} reference coins shown · demo catalog only`;
}

window.renderMarket = renderMarket;

document.getElementById('globalSearch').onkeydown = event => {
  if (event.key !== 'Enter') return;
  const query = event.target.value.toLowerCase().trim();
  if (!query) return;

  const coin = catalog.find(item =>
    item.name.toLowerCase().includes(query) ||
    item.type.toLowerCase().includes(query)
  );
  if (coin) {
    go('discover');
    document.getElementById('coinSelect').value = coin.id;
    document.getElementById('identify').click();
    return;
  }

  const post = [...posts, ...samplePosts].find(item =>
    `${item.name} ${item.text}`.toLowerCase().includes(query)
  );
  if (post) {
    openDiscussion(post.id);
    return;
  }

  toast('No catalog or discussion match. Try a coin name, type, or post keyword.');
};

marketCategorySelect.addEventListener('change', () => {
  marketCategory = marketCategorySelect.value;
  renderMarket();
});
marketScopeSelect.addEventListener('change', () => {
  marketFilter = marketScopeSelect.value;
  renderMarket();
});
marketRows.addEventListener('click', event => {
  const button = event.target.closest('button[data-market-action]');
  if (!button) return;

  const coin = catalog.find(item => item.id === button.dataset.coinId);
  if (!coin) return;

  if (button.dataset.marketAction === 'watch') {
    if (window.coinxchangeAccounts?.configured) {
      void window.coinxchangeAccounts.toggleWatch(coin.id);
      return;
    }
    const nextWatch = watch.includes(coin.id)
      ? watch.filter(id => id !== coin.id)
      : [...watch, coin.id];
    if (!save('cx_watch', nextWatch)) return;
    watch = nextWatch;
    renderMarket();
    return;
  }

  if (button.dataset.marketAction === 'explore') {
    go('discover');
    document.getElementById('coinSelect').value = coin.id;
    document.getElementById('identify').click();
    return;
  }

  if (button.dataset.marketAction === 'collect') {
    if (window.coinxchangeAccounts?.configured) {
      void window.coinxchangeAccounts.addCoin({
        name: coin.name,
        notes: 'Added from the reference catalog; not a valuation.',
        referenceId: coin.id
      });
      return;
    }
    const nextCollection = [{
      name: coin.name,
      notes: 'Added from the Market Exchange demo catalog; not a valuation.'
    }, ...collection];
    if (!save('cx_collection', nextCollection)) return;
    collection = nextCollection;
    renderCollection();
    toast('Added to your local vault');
  }
});

const photoInput = document.getElementById('photo');
const photoPreview = document.getElementById('preview');
const photoStatus = document.createElement('p');
photoStatus.className = 'tiny';
photoStatus.id = 'photoStatus';
photoStatus.setAttribute('role', 'status');
photoStatus.setAttribute('aria-live', 'polite');
photoPreview.after(photoStatus);

photoInput.onchange = event => {
  const file = event.target.files[0];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  photoPreview.removeAttribute('src');
  photoPreview.style.display = 'none';
  photoStatus.textContent = '';

  if (!file) return;
  if (!file.type.startsWith('image/')) {
    photoInput.value = '';
    photoStatus.textContent = 'Choose an image file to preview.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    photoInput.value = '';
    photoStatus.textContent = 'Choose an image smaller than 10 MB.';
    return;
  }

  previewUrl = URL.createObjectURL(file);
  photoPreview.onload = () => {
    photoPreview.style.display = 'block';
    photoStatus.textContent = 'Preview shown locally. This image is not analyzed or uploaded.';
  };
  photoPreview.onerror = () => {
    photoPreview.style.display = 'none';
    photoStatus.textContent = 'This image could not be previewed. Try another file.';
  };
  photoPreview.src = previewUrl;
};

const reportDetails = document.getElementById('reportDetails');
const checklist = document.createElement('div');
checklist.className = 'guide-checklist';
checklist.innerHTML = `
  <h3>Research checklist</h3>
  <ul>
    <li>Compare the date, mintmark, and design with a trusted reference.</li>
    <li>Check variety diagnostics against clear photos from a reputable source.</li>
    <li>Do not clean the coin; seek professional review for potentially valuable finds.</li>
  </ul>
`;
reportDetails.after(checklist);

document.getElementById('identify').onclick = () => {
  chosen = catalog.find(coin => coin.id === document.getElementById('coinSelect').value);
  if (!chosen) return toast('Select a reference example first');

  document.getElementById('discoveryPlaceholder').style.display = 'none';
  document.getElementById('discoveryResult').style.display = 'block';
  document.getElementById('reportIcon').textContent = chosen.symbol;
  document.getElementById('reportTitle').textContent = chosen.name;
  reportDetails.textContent = chosen.details;
};

document.getElementById('saveDiscovered').onclick = () => {
  if (!chosen) return;
  if (window.coinxchangeAccounts?.configured) {
    void window.coinxchangeAccounts.addCoin({
      name: chosen.name,
      notes: 'Added from the discovery guide; identification unverified. ' + chosen.details,
      referenceId: chosen.id
    });
    return;
  }
  const nextCollection = [{
    name: chosen.name,
    notes: `Added from the discovery guide · identification unverified. ${chosen.details}`
  }, ...collection];
  if (!save('cx_collection', nextCollection)) return;
  collection = nextCollection;
  renderCollection();
  toast('Saved to your local vault');
};


/* Founder Edition beta enhancements: free-text research, a clear save path,
   native sharing, and a neutral advertising placement. No third-party scripts. */
const discoveryCard = document.getElementById('coinSelect').closest('.card');
const researchPanel = document.createElement('div');
researchPanel.className = 'coin-research-panel';
researchPanel.innerHTML = `
  <h3>Can't find your coin in the examples?</h3>
  <label for="customCoinName">Enter any coin name, year, mintmark, or country</label>
  <input id="customCoinName" class="field" type="search" maxlength="160"
    placeholder="e.g. 1896-O Morgan silver dollar" autocomplete="off">
  <div class="actions">
    <button class="btn secondary" id="researchCoin" type="button">Research this coin</button>
    <button class="btn secondary" id="saveCustomCoin" type="button">Save to my vault</button>
  </div>
  <p id="customCoinStatus" class="tiny" role="status" aria-live="polite"></p>
  <div id="coinReferenceLinks" class="coin-reference-links" hidden>
    <a id="pcgsResearch" href="#" target="_blank" rel="noopener noreferrer">Search PCGS CoinFacts</a>
    <a id="ngcResearch" href="#" target="_blank" rel="noopener noreferrer">Search NGC</a>
    <a id="numistaResearch" href="#" target="_blank" rel="noopener noreferrer">Search Numista</a>
  </div>
  <p class="tiny">External research searches are not AI photo identification, certified appraisals,
  or verified coin matches. Check the date, mintmark, denomination and variety.</p>
`;
discoveryCard.append(researchPanel);
const customName = document.getElementById('customCoinName');
const customStatus = document.getElementById('customCoinStatus');
const linkPanel = document.getElementById('coinReferenceLinks');
const researchTerms = name => encodeURIComponent(name + ' coin identification');
document.getElementById('researchCoin').addEventListener('click', () => {
  const name = customName.value.trim();
  if (!name) { customStatus.textContent = 'Enter a coin description first.'; return; }
  document.getElementById('pcgsResearch').href = 'https://www.google.com/search?q=' +
    researchTerms('site:pcgs.com/coinfacts ' + name);
  document.getElementById('ngcResearch').href = 'https://www.google.com/search?q=' +
    researchTerms('site:ngccoin.com ' + name);
  document.getElementById('numistaResearch').href = 'https://www.google.com/search?q=' +
    researchTerms('site:en.numista.com ' + name);
  linkPanel.hidden = false;
  customStatus.textContent = 'Choose a reference source to review possible matches; no identification has been confirmed.';
});
document.getElementById('saveCustomCoin').addEventListener('click', async () => {
  const name = customName.value.trim();
  if (!name) { customStatus.textContent = 'Enter a coin name before saving.'; return; }
  if (window.coinxchangeAccounts?.configured) {
    const saved = await window.coinxchangeAccounts.addCoin({
      name, notes: 'User-entered coin; identity and condition not verified.'
    });
    if (saved) { customStatus.textContent = 'Saved to your account vault.'; go('collection'); }
    else customStatus.textContent = 'Not saved. Sign in and ensure your account storage is available.';
    return;
  }
  const next = [{ name, notes: 'User-entered coin; identification not verified.' }, ...collection];
  if (!save('cx_collection', next)) { customStatus.textContent = 'Could not save on this device.'; return; }
  collection = next;
  renderCollection();
  customStatus.textContent = 'Saved locally to My Coin Collection.';
  go('collection');
});

// An image preview is not a cloud upload. Offer an explicit path to save its
// description rather than implying the image itself has been stored.
const imageSaveHelp = document.createElement('div');
imageSaveHelp.className = 'coin-photo-save';
imageSaveHelp.innerHTML = `
  <h3>Save the coin you photographed</h3>
  <label for="photoCoinName">Coin name or description</label>
  <input id="photoCoinName" class="field" maxlength="160" placeholder="e.g. 1979-D Lincoln cent">
  <button id="savePhotoDescription" class="btn secondary" type="button">Save coin details to My Collection</button>
  <p id="photoSaveStatus" class="tiny" role="status" aria-live="polite"></p>
  <p class="tiny">This saves the coin description, not the photograph.
  Permanent photo uploads are not enabled yet.</p>
`;
photoInput.closest('.upload').after(imageSaveHelp);
document.getElementById('savePhotoDescription').addEventListener('click', async () => {
  const name = document.getElementById('photoCoinName').value.trim();
  const state = document.getElementById('photoSaveStatus');
  if (!name) { state.textContent = 'Enter a coin description to save.'; return; }
  const notes = 'Added from photo-preview screen. Photo not uploaded; identity unverified.';
  if (window.coinxchangeAccounts?.configured) {
    const saved = await window.coinxchangeAccounts.addCoin({ name, notes });
    if (saved) { state.textContent = 'Saved to your account collection.'; go('collection'); }
    else state.textContent = 'Not saved. Sign in and check account storage.';
    return;
  }
  if (!save('cx_collection', [{ name, notes }, ...collection])) {
    state.textContent = 'Could not save on this device.'; return;
  }
  collection = [{ name, notes }, ...collection];
  renderCollection();
  state.textContent = 'Saved locally.';
  go('collection');
});

async function shareCoinxchange(title, text) {
  const url = new URL(location.pathname, location.origin).href;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  const message = title + '\\n' + text + '\\n' + url;
  try {
    await navigator.clipboard.writeText(message);
    toast('Share text copied. Paste it where you like.');
  } catch {
    toast('Sharing is unavailable in this browser.');
  }
}
const shareControls = document.createElement('div');
shareControls.className = 'actions';
shareControls.innerHTML = '<button class="btn secondary" id="shareDiscovery" type="button">Share coin</button>' +
  '<button class="btn secondary" id="tagDiscovery" type="button">Add hashtags</button>';
document.getElementById('saveDiscovered').after(shareControls);
document.getElementById('shareDiscovery').addEventListener('click', () => {
  if (!chosen) return toast('Select a coin to share first.');
  void shareCoinxchange('COINXCHANGE coin research', chosen.name + ' — identification is unverified.');
});
document.getElementById('tagDiscovery').addEventListener('click', () => {
  if (!chosen) return toast('Select a coin first.');
  const tags = '#CoinCollecting #Numismatics #' + chosen.name.replace(/[^a-zA-Z0-9]/g, '').slice(0,45);
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(tags).then(() => toast('Coin hashtags copied.'))
      .catch(() => toast('Could not copy hashtags on this device.'));
  } else toast(tags);
});
const socialArea = document.getElementById('social');
const tagPost = document.createElement('button');
tagPost.type = 'button';
tagPost.className = 'btn secondary';
tagPost.textContent = 'Insert #CoinCollecting';
document.getElementById('publish').after(tagPost);
tagPost.onclick = () => {
  const field = document.getElementById('postText');
  const addition = (field.value.trim() ? ' ' : '') + '#CoinCollecting';
  if (field.value.length + addition.length <= field.maxLength) field.value += addition;
  field.focus();
};
for (const feedId of ['socialFeed', 'homeFeed']) {
  document.getElementById(feedId).addEventListener('click', event => {
    const post = event.target.closest('.feedpost');
    if (!post || !event.target.matches('[data-cx-share]')) return;
    const body = post.querySelector('.postbody')?.textContent || '';
    void shareCoinxchange('COINXCHANGE collector discussion', body);
  });
}
const sharePostButton = document.createElement('button');
sharePostButton.type = 'button';
sharePostButton.dataset.cxShare = 'true';
sharePostButton.textContent = 'Share';
const originalFeed = window.renderAll;
const shareObserver = new MutationObserver(() => {
  for (const feedId of ['socialFeed','homeFeed']) {
    const feed = document.getElementById(feedId);
    feed.querySelectorAll('.feedpost .postactions').forEach(actions => {
      if (!actions.querySelector('[data-cx-share]')) actions.append(sharePostButton.cloneNode(true));
    });
  }
});
shareObserver.observe(document.getElementById('socialFeed'), { childList: true });
shareObserver.observe(document.getElementById('homeFeed'), { childList: true });
// Populate share buttons on the initial feed as well.
for (const feedId of ['socialFeed','homeFeed']) {
  document.getElementById(feedId).querySelectorAll('.feedpost .postactions')
    .forEach(actions => actions.append(sharePostButton.cloneNode(true)));
}

const adSlot = document.createElement('aside');
adSlot.id = 'coinxchangeAdSlot';
adSlot.setAttribute('aria-label', 'Advertisement placement');
adSlot.innerHTML = '<span class="tiny">ADVERTISEMENT SPACE</span>' +
  '<p>Collector-friendly sponsors and promotions may appear here in a future release.</p>' +
  '<span class="tiny">No paid ads or tracking are active.</span>';
document.getElementById('home').querySelector('.hero').after(adSlot);
const styles = document.createElement('style');
styles.textContent = '.coin-research-panel,.coin-photo-save{margin-top:20px;padding-top:14px;border-top:1px solid var(--line)}' +
 '.coin-research-panel label,.coin-photo-save label{display:block;margin:8px 0}' +
 '.coin-reference-links{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0}' +
 '#coinxchangeAdSlot{border:1px dashed var(--line);border-radius:14px;margin:18px 0;padding:14px 20px;text-align:center;background:var(--panel)}' +
 '#coinxchangeAdSlot p{margin:6px 0}';
document.head.append(styles);

renderMarket();
})();
