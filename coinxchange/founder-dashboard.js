// The database authorizes every read. Client visibility is only presentation;
// no signup field, browser flag, or user metadata can grant founder access.
export function createFounderDashboard(client) {
  const panel = document.createElement('section');
  panel.id = 'founderDashboard';
  panel.className = 'card';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'founderDashboardTitle');
  panel.style.marginTop = '24px';
  panel.innerHTML = `
    <h2 id="founderDashboardTitle">Founder dashboard</h2>
    <p class="muted">See how many collectors have joined. Registered members include accounts awaiting email confirmation.</p>
    <dl class="founder-counts">
      <div><dt>Registered members</dt><dd data-founder-count="total_members">—</dd></div>
      <div><dt>Email confirmed</dt><dd data-founder-count="confirmed_members">—</dd></div>
      <div><dt>Joined in the last 7 days</dt><dd data-founder-count="joined_last_7_days">—</dd></div>
      <div><dt>Joined in the last 30 days</dt><dd data-founder-count="joined_last_30_days">—</dd></div>
    </dl>
    <p id="founderCountsStatus" class="tiny" role="status" aria-live="polite"></p>
    <button id="refreshFounderCounts" class="btn secondary" type="button">Refresh member totals</button>
  `;
  const style = document.createElement('style');
  style.textContent = '.founder-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:20px 0}' +
    '.founder-counts div{border:1px solid var(--line);border-radius:12px;padding:14px}' +
    '.founder-counts dt{color:var(--muted);font-size:13px}.founder-counts dd{margin:6px 0 0;font-size:28px;font-weight:700;overflow-wrap:anywhere}' +
    '@media(max-width:420px){.founder-counts{grid-template-columns:1fr}}';
  document.head.append(style);
  document.getElementById('member').append(panel);
  const button = panel.querySelector('button');
  const status = panel.querySelector('[role="status"]');
  const values = [...panel.querySelectorAll('[data-founder-count]')];
  let generation = 0;

  function clear() {
    generation += 1;
    panel.hidden = true;
    status.textContent = '';
    button.disabled = false;
    values.forEach(node => { node.textContent = '—'; });
  }

  async function load() {
    clear();
    const epoch = generation;
    button.disabled = true;
    try {
      const { data, error } = await client.rpc('founder_signup_counts');
      if (epoch !== generation) return;
      if (error || !Array.isArray(data) || data.length !== 1) return;
      const result = data[0];
      if (!result || values.some(node => !Number.isSafeInteger(result[node.dataset.founderCount]) ||
        result[node.dataset.founderCount] < 0)) return;
      const asOf = new Date(result.as_of);
      if (typeof result.as_of !== 'string' || !Number.isFinite(asOf.getTime())) return;
      values.forEach(node => { node.textContent = result[node.dataset.founderCount].toLocaleString(); });
      status.textContent = 'Updated ' + asOf.toLocaleString() + '. These totals count member accounts, not page visits.';
      panel.hidden = false;
    } catch { /* Unauthorized or unavailable totals must never expose stale data. */ }
    finally { if (epoch === generation) button.disabled = false; }
  }

  button.addEventListener('click', () => { void load(); });
  return Object.freeze({ load, clear });
}
