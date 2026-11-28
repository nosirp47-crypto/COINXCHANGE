(function () {
const marketSection = document.getElementById('market');
const marketRows = document.getElementById('marketRows');
const marketTypes = [...new Set(catalog.map(coin => coin.type))];
let marketFilter = 'all';
let marketCategory = 'all';
let previewUrl = null;
let photoDataUrl = null;
let photoVersion = 0;
let photoPreparing = false;
let photoSaving = false;
const maxPhotoBytes = 500 * 1024;

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
photoInput.closest('.upload').querySelector('p').textContent =
  'Preview your photo, then save it with a description. No automatic coin identification.';
document.querySelector('label[for="photo"]').textContent = 'Select your coin photo';

// The preview is a bounded JPEG that can be saved, not a temporary file URL.
// Re-encoding also removes the original photo's location/EXIF metadata.
photoInput.accept = 'image/jpeg,image/png,image/webp';
photoInput.onchange = async event => {
  const version = ++photoVersion;
  const file = event.target.files[0];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  photoDataUrl = null;
  photoPreparing = false;
  photoPreview.removeAttribute('src');
  photoPreview.style.display = 'none';
  photoStatus.textContent = '';
  const saveStatus = document.getElementById('photoSaveStatus');
  if (saveStatus) saveStatus.textContent = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    photoInput.value = '';
    photoStatus.textContent = 'Choose a JPEG, PNG, or WebP photo. Export HEIC photos as JPEG first.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    photoInput.value = '';
    photoStatus.textContent = 'Choose a photo smaller than 10 MB.';
    return;
  }
  photoPreparing = true;
  photoStatus.textContent = 'Preparing your coin photo…';
  const objectUrl = URL.createObjectURL(file);
  previewUrl = objectUrl;
  try {
    const decoded = new Image();
    await new Promise((resolve, reject) => {
      decoded.onload = resolve;
      decoded.onerror = reject;
      decoded.src = objectUrl;
    });
    if (version !== photoVersion) return;
    if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error('Invalid photo');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(decoded.naturalWidth, decoded.naturalHeight));
    canvas.width = Math.max(1, Math.round(decoded.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(decoded.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    let encoded;
    for (const quality of [0.84, 0.72, 0.58, 0.42]) {
      encoded = canvas.toDataURL('image/jpeg', quality);
      if ((encoded.length - 23) * 3 / 4 <= maxPhotoBytes) break;
    }
    if (!encoded?.startsWith('data:image/jpeg;base64,') ||
        (encoded.length - 23) * 3 / 4 > maxPhotoBytes) throw new Error('Photo too large');
    photoDataUrl = encoded;
    photoPreview.src = encoded;
    photoPreview.style.display = 'block';
    photoStatus.textContent = 'Photo ready. Add a description and save it to your collection.';
  } catch {
    if (version !== photoVersion) return;
    photoInput.value = '';
    photoStatus.textContent = 'This photo could not be prepared. Try a smaller JPEG or PNG photo.';
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (version === photoVersion) { previewUrl = null; photoPreparing = false; }
  }
};

function clearSavedPhoto() {
  ++photoVersion;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  photoInput.value = '';
  photoDataUrl = null;
  photoPreparing = false;
  photoPreview.removeAttribute('src');
  photoPreview.style.display = 'none';
  photoStatus.textContent = '';
}

window.coinxchangeClearPhotoDraft = () => {
  clearSavedPhoto();
  for (const id of ['photoCoinName', 'customCoinName']) {
    const input = document.getElementById(id);
    if (input) input.value = '';
  }
  for (const id of ['photoSaveStatus', 'customCoinStatus']) {
    const node = document.getElementById(id);
    if (node) node.textContent = '';
  }
};

async function saveDescribedCoin(coin, { requirePhoto = false } = {}) {
  if (photoPreparing || photoSaving) {
    toast('Please wait while your photo is prepared or saved.');
    return false;
  }
  if (requirePhoto && !photoDataUrl) {
    toast('Choose a coin photo before saving.');
    return false;
  }
  photoSaving = true;
  const savedVersion = photoVersion;
  const snapshot = photoDataUrl;
  try {
    if (window.coinxchangeAccounts?.configured) {
      const saved = await window.coinxchangeAccounts.addCoin({ ...coin, photoDataUrl: snapshot });
      if (saved && snapshot && savedVersion === photoVersion) clearSavedPhoto();
      return saved;
    }
    const entry = { name: coin.name, notes: coin.notes };
    if (coin.referenceId) entry.referenceId = coin.referenceId;
    if (snapshot) entry.photoDataUrl = snapshot;
    const next = [entry, ...collection];
    if (!save('cx_collection', next)) return false;
    collection = next;
    renderCollection();
    if (snapshot && savedVersion === photoVersion) clearSavedPhoto();
    toast(snapshot ? 'Coin and photo saved on this device.' : 'Saved to your local vault.');
    return true;
  } finally { photoSaving = false; }
}

// Extend the established renderer so account edit/remove behavior stays intact.
const renderCollectionWithoutPhotos = window.renderCollection;
window.renderCollection = function () {
  renderCollectionWithoutPhotos();
  document.querySelectorAll('#collectionList .item').forEach((row, index) => {
    const item = collection[index];
    if (!item) return;
    let source = null;
    if (typeof item.photoDataUrl === 'string' && item.photoDataUrl.length <= 700000 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.photoDataUrl)) {
      source = item.photoDataUrl;
    } else if (typeof item.photoUrl === 'string' && item.photoUrl.startsWith('blob:' + location.origin + '/')) {
      source = item.photoUrl;
    }
    const icon = row.querySelector('.coin');
    if (source) {
      const img = document.createElement('img');
      img.className = 'saved-coin-photo';
      img.src = source;
      img.alt = 'Your photo of ' + item.name;
      img.width = 76;
      img.height = 76;
      img.onerror = () => {
        icon.textContent = 'Photo unavailable';
        icon.classList.add('photo-unavailable');
      };
      icon.replaceChildren(img);
      icon.classList.add('coin-with-photo');
    } else if (item.photoUnavailable || item.photo_path || item.photoDataUrl) {
      icon.textContent = 'Photo unavailable';
      icon.classList.add('photo-unavailable');
    }
  });
};
const photoStyles = document.createElement('style');
photoStyles.textContent = '#collectionList .coin-with-photo{width:76px;height:76px;min-width:76px;border-radius:12px;overflow:hidden;background:var(--panel2)}' +
  '.saved-coin-photo{display:block;width:76px;height:76px;object-fit:contain}' +
  '#collectionList .photo-unavailable{font:11px/1.3 system-ui;width:76px;min-width:76px;text-align:center;color:var(--muted);border-radius:12px}' +
  '#collectionList .item{flex-wrap:wrap}#collectionList .item>div:nth-child(2){min-width:100px;overflow-wrap:anywhere}';
document.head.append(photoStyles);
renderCollection();

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

document.getElementById('saveDiscovered').onclick = async () => {
  if (!chosen) return;
  await saveDescribedCoin({
    name: chosen.name,
    notes: 'Added from the discovery guide; identification unverified. ' + chosen.details,
    referenceId: chosen.id
  });
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
  const saved = await saveDescribedCoin({
    name, notes: 'User-entered coin; identity and condition not verified.'
  });
  if (saved) {
    customStatus.textContent = window.coinxchangeAccounts?.configured
      ? 'Saved to your account vault.' : 'Saved on this device.';
    go('collection');
  } else customStatus.textContent = 'Not saved. Check the message and try again.';
});

const imageSaveHelp = document.createElement('div');
imageSaveHelp.className = 'coin-photo-save';
imageSaveHelp.innerHTML = `
  <h3>Save the coin you photographed</h3>
  <label for="photoCoinName">Coin name or description</label>
  <input id="photoCoinName" class="field" maxlength="160" placeholder="e.g. 1979-D Lincoln cent">
  <button id="savePhotoDescription" class="btn secondary" type="button">Save coin and photo to My Collection</button>
  <p id="photoSaveStatus" class="tiny" role="status" aria-live="polite"></p>
  <p class="tiny">Your photo is resized for your collection. Account photos are private;
  guest photos stay in this browser. Keep your original for close-up inspection.</p>
`;
photoInput.closest('.upload').after(imageSaveHelp);
document.getElementById('savePhotoDescription').addEventListener('click', async () => {
  const name = document.getElementById('photoCoinName').value.trim();
  const state = document.getElementById('photoSaveStatus');
  const button = document.getElementById('savePhotoDescription');
  if (!name) { state.textContent = 'Enter a coin description to save.'; return; }
  if (photoPreparing) { state.textContent = 'Please wait for your photo to finish preparing.'; return; }
  if (!photoDataUrl) { state.textContent = 'Choose a coin photo before saving.'; return; }
  button.disabled = true;
  state.textContent = 'Saving your coin and photo…';
  try {
    const saved = await saveDescribedCoin({
      name, notes: 'Saved with your coin photo. Identity and condition unverified.'
    }, { requirePhoto: true });
    if (saved) {
      state.textContent = window.coinxchangeAccounts?.configured
        ? 'Coin and photo saved to your private account collection.'
        : 'Coin and photo saved on this device.';
      go('collection');
    } else state.textContent = 'Could not confirm the save. Check account access or browser storage and retry.';
  } finally { button.disabled = false; }
});

async function shareCoinxchange(title, text) {
  const url = new URL(location.pathname, location.origin).href;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  const message = title + '\n' + text + '\n' + url;
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
