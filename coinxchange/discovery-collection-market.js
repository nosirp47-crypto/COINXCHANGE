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
    watch = watch.includes(coin.id)
      ? watch.filter(id => id !== coin.id)
      : [...watch, coin.id];
    save('cx_watch', watch);
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
    collection.unshift({
      name: coin.name,
      notes: 'Added from the Market Exchange demo catalog; not a valuation.'
    });
    save('cx_collection', collection);
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
  collection.unshift({
    name: chosen.name,
    notes: `Added from the discovery guide · identification unverified. ${chosen.details}`
  });
  save('cx_collection', collection);
  renderCollection();
  toast('Saved to your local vault');
};

renderMarket();
})();
