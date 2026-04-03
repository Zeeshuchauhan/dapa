'use strict';

// These point to our own Vercel serverless functions — no CORS issues
const PROXY_CHECK   = '/api/check';
const PROXY_CREDITS = '/api/credits';

const STORE_KEY = 'dapa_db';
const KEY_STORE = 'dapa_key';

let db = [];

/* ── Init ── */
function init() {
  try { db = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { db = []; }
  const saved = localStorage.getItem(KEY_STORE) || '';
  if (saved) {
    document.getElementById('apiKeyInput').value = saved;
    fetchCredits(saved);
    collapsePanel('settingsPanel');
  }
  render();
}

function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }

/* ── API Key ── */
async function saveAndVerify() {
  const key = document.getElementById('apiKeyInput').value.trim();
  const status = document.getElementById('verifyStatus');
  if (!key) { status.innerHTML = '<span class="verify-err">Please enter your API key.</span>'; return; }
  status.innerHTML = '<span style="color:var(--text3)">Verifying...</span>';
  try {
    const r = await fetch(PROXY_CREDITS, { headers: { 'X-API-Key': key } });
    const d = await r.json();
    if (d.success) {
      localStorage.setItem(KEY_STORE, key);
      status.innerHTML = `<span class="verify-ok">✓ Key saved. ${Number(d.remaining_credits).toLocaleString()} credits available.</span>`;
      showCredits(d.remaining_credits);
      collapsePanel('settingsPanel');
    } else {
      status.innerHTML = `<span class="verify-err">✗ ${d.message || 'Invalid key. Check and try again.'}</span>`;
    }
  } catch (e) {
    status.innerHTML = `<span class="verify-err">✗ Error: ${e.message}</span>`;
  }
}

async function fetchCredits(key) {
  key = key || localStorage.getItem(KEY_STORE);
  if (!key) return;
  try {
    const r = await fetch(PROXY_CREDITS, { headers: { 'X-API-Key': key } });
    const d = await r.json();
    if (d.success) showCredits(d.remaining_credits);
  } catch {}
}

function showCredits(n) {
  const box = document.getElementById('creditsBox');
  box.style.display = 'flex';
  document.getElementById('creditsVal').textContent = Number(n).toLocaleString();
}

function openSettings() {
  const body = document.getElementById('settingsPanelBody');
  body.style.display = 'block';
  document.getElementById('settingsArrow').textContent = '▲';
  document.getElementById('apiKeyInput').focus();
}

/* ── URL input ── */
function getUrls() {
  return [...new Set(
    document.getElementById('urlInput').value
      .split('\n').map(u => u.trim()).filter(Boolean)
  )];
}

function updateCount() {
  const all = document.getElementById('urlInput').value.split('\n').map(u => u.trim()).filter(Boolean);
  const unique = [...new Set(all)];
  const badge  = document.getElementById('urlCountBadge');
  const meta   = document.getElementById('urlMeta');
  const dup    = document.getElementById('dupNote');
  if (!all.length) {
    badge.style.display = 'none';
    meta.textContent = 'Paste URLs above. Batched automatically — 1 credit per URL.';
    dup.textContent = '';
    return;
  }
  badge.style.display = 'inline-block';
  badge.textContent = `${unique.length} URL${unique.length !== 1 ? 's' : ''}`;
  const batches = Math.ceil(unique.length / 50);
  meta.textContent = `${unique.length} unique · ${batches} batch${batches !== 1 ? 'es' : ''} · ${unique.length} credit${unique.length !== 1 ? 's' : ''} needed`;
  const dups = all.length - unique.length;
  dup.textContent = dups > 0 ? `${dups} duplicate${dups !== 1 ? 's' : ''} removed` : '';
}

function clearInput() {
  document.getElementById('urlInput').value = '';
  updateCount();
}

/* ── Main check ── */
async function runCheck() {
  const key = localStorage.getItem(KEY_STORE);
  if (!key) { showErr('No API key saved. Open Settings and add your key first.'); return; }
  const urls = getUrls();
  if (!urls.length) { showErr('No URLs found. Paste at least one URL.'); return; }

  hideErr(); hideOk();
  const btn = document.getElementById('checkBtn');
  btn.disabled = true;

  const batches = [];
  for (let i = 0; i < urls.length; i += 50) batches.push(urls.slice(i, i + 50));

  const prog  = document.getElementById('progressWrap');
  const fill  = document.getElementById('progressFill');
  const label = document.getElementById('progressLabel');
  prog.style.display = 'flex';
  fill.style.width = '0%';
  label.textContent = '0%';

  let done = 0, failed = 0;

  for (let b = 0; b < batches.length; b++) {
    const pct = Math.round((b / batches.length) * 100);
    fill.style.width = pct + '%';
    label.textContent = pct + '%';

    try {
      const r = await fetch(PROXY_CHECK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ urls: batches[b], same_url: true, same_domain: false })
      });
      const d = await r.json();
      if (d.success && d.data) {
        d.data.forEach(item => {
          const m   = item.metrics || {};
          const idx = db.findIndex(x => x.url === item.original_url);
          const rec = {
            url:  item.original_url,
            da:   m.domain_authority ?? null,
            pa:   m.page_authority   ?? null,
            spam: m.spam_score       ?? null,
            ts:   Date.now()
          };
          if (idx >= 0) db[idx] = rec; else db.unshift(rec);
          done++;
        });
        if (d.remaining_credits !== undefined) showCredits(d.remaining_credits);
      } else {
        failed += batches[b].length;
        showErr(`Batch ${b + 1} error: ${d.message || d.error || 'Unknown error'}`);
      }
    } catch (e) {
      failed += batches[b].length;
      showErr(`Batch ${b + 1} failed: ${e.message}`);
    }

    persist();
    render();
    if (b < batches.length - 1) await sleep(600);
  }

  fill.style.width = '100%';
  label.textContent = '100%';
  setTimeout(() => { prog.style.display = 'none'; }, 1500);

  if (done > 0) {
    showOk(`Done — ${done} URL${done !== 1 ? 's' : ''} checked${failed ? `, ${failed} failed` : ''}. Results saved below.`);
    document.getElementById('urlInput').value = '';
    updateCount();
  }
  btn.disabled = false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Render ── */
function render() { renderSummary(); renderTable(); }

function renderSummary() {
  const has = db.length > 0;
  document.getElementById('summaryGrid').style.display  = has ? 'grid'  : 'none';
  document.getElementById('filtersRow').style.display   = has ? 'flex'  : 'none';
  document.getElementById('tblWrap').style.display      = has ? 'block' : 'none';
  document.getElementById('emptyState').style.display   = has ? 'none'  : 'block';
  document.getElementById('recordCount').textContent    = has ? `(${db.length})` : '';
  if (!has) return;

  const das = db.filter(r => r.da   !== null).map(r => r.da);
  const pas = db.filter(r => r.pa   !== null).map(r => r.pa);
  document.getElementById('sTot').textContent   = db.length;
  document.getElementById('sDA').textContent    = das.length ? Math.round(das.reduce((a,b)=>a+b,0)/das.length) : '—';
  document.getElementById('sPA').textContent    = pas.length ? Math.round(pas.reduce((a,b)=>a+b,0)/pas.length) : '—';
  document.getElementById('sHigh').textContent  = db.filter(r => r.da !== null && r.da >= 50).length;
  document.getElementById('sClean').textContent = db.filter(r => r.spam !== null && r.spam <= 2).length;
}

function renderTable() {
  const q         = (document.getElementById('searchQ')?.value    || '').toLowerCase();
  const sort      =  document.getElementById('sortBy')?.value      || 'ts_desc';
  const filterDA  =  document.getElementById('filterDA')?.value    || '';
  const filterSp  =  document.getElementById('filterSpam')?.value  || '';

  let rows = [...db];
  if (q)              rows = rows.filter(r => r.url.toLowerCase().includes(q));
  if (filterDA==='high') rows = rows.filter(r => r.da !== null && r.da >= 50);
  else if (filterDA==='mid')  rows = rows.filter(r => r.da !== null && r.da >= 25 && r.da < 50);
  else if (filterDA==='low')  rows = rows.filter(r => r.da !== null && r.da < 25);
  if (filterSp==='ok')   rows = rows.filter(r => r.spam !== null && r.spam <= 2);
  else if (filterSp==='warn') rows = rows.filter(r => r.spam !== null && r.spam >= 3 && r.spam <= 5);
  else if (filterSp==='bad')  rows = rows.filter(r => r.spam !== null && r.spam >= 6);

  if      (sort==='ts_desc')  rows.sort((a,b) => b.ts   - a.ts);
  else if (sort==='ts_asc')   rows.sort((a,b) => a.ts   - b.ts);
  else if (sort==='da_desc')  rows.sort((a,b) => (b.da  ||0)-(a.da  ||0));
  else if (sort==='da_asc')   rows.sort((a,b) => (a.da  ||0)-(b.da  ||0));
  else if (sort==='pa_desc')  rows.sort((a,b) => (b.pa  ||0)-(a.pa  ||0));
  else if (sort==='spam_asc') rows.sort((a,b) => (a.spam??99)-(b.spam??99));

  document.getElementById('tblBody').innerHTML = rows.length
    ? rows.map((r,i) => rowHtml(r, i)).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3);font-size:13px">No results match filters.</td></tr>`;
}

function scoreClass(n) { return n >= 50 ? 'high' : n >= 25 ? 'mid' : 'low'; }
function spamClass(n)  { return n <= 2  ? 'ok'   : n <= 5  ? 'warn' : 'bad'; }

function rowHtml(r, i) {
  const daC = scoreClass(r.da   || 0);
  const paC = scoreClass(r.pa   || 0);
  const spC = spamClass (r.spam ?? 99);
  const d   = new Date(r.ts);
  const ts  = d.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'2-digit'})
             + ' ' + d.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
  let domain = '';
  try { domain = new URL(r.url.startsWith('http') ? r.url : 'https://'+r.url).hostname; } catch {}
  const esc = r.url.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return `<tr>
    <td class="td-num">${i+1}</td>
    <td class="td-url">
      <a href="${r.url.startsWith('http')?r.url:'https://'+r.url}" target="_blank" rel="noopener">${r.url}</a>
      ${domain && domain!==r.url ? `<div class="url-domain">${domain}</div>` : ''}
    </td>
    <td><div class="score-cell">
      <span class="score-num c-${daC}">${r.da??'—'}</span>
      ${r.da!==null?`<div class="score-bar"><div class="score-fill fill-${daC}" style="width:${r.da}%"></div></div>`:''}
    </div></td>
    <td><div class="score-cell">
      <span class="score-num c-${paC}">${r.pa??'—'}</span>
      ${r.pa!==null?`<div class="score-bar"><div class="score-fill fill-${paC}" style="width:${r.pa}%"></div></div>`:''}
    </div></td>
    <td><span class="spam-pill spam-${spC}">${r.spam??'—'}</span></td>
    <td class="td-ts">${ts}</td>
    <td><button class="del-btn" onclick="deleteRow('${esc}')" title="Remove">×</button></td>
  </tr>`;
}

/* ── Actions ── */
function deleteRow(url) {
  if (!confirm(`Remove "${url}"?`)) return;
  db = db.filter(r => r.url !== url);
  persist(); render();
}

function clearAll() {
  if (!confirm(`Clear all ${db.length} stored results? This cannot be undone.`)) return;
  db = []; persist(); render();
  showOk('All results cleared.');
}

function exportCSV() {
  if (!db.length) { showErr('Nothing to export yet.'); return; }
  const hdr   = 'URL,Domain Authority,Page Authority,Spam Score,Checked At';
  const lines = db.map(r =>
    `"${r.url}",${r.da??''},${r.pa??''},${r.spam??''},"${new Date(r.ts).toISOString()}"`
  );
  const blob = new Blob([[hdr,...lines].join('\n')], {type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `dapa_results_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ── Panel helpers ── */
function togglePanel(id) {
  const body  = document.getElementById(id+'Body');
  const arrow = document.getElementById(id.replace('Panel','')+'Arrow');
  const open  = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}
function collapsePanel(id) {
  const body  = document.getElementById(id+'Body');
  const arrow = document.getElementById(id.replace('Panel','')+'Arrow');
  body.style.display = 'none';
  if (arrow) arrow.textContent = '▼';
}

/* ── Alert helpers ── */
function showErr(msg) { const el=document.getElementById('errAlert'); el.textContent=msg; el.style.display='block'; }
function hideErr()    { document.getElementById('errAlert').style.display='none'; }
function showOk(msg)  { const el=document.getElementById('okAlert');  el.textContent=msg; el.style.display='block'; setTimeout(()=>{el.style.display='none';},7000); }
function hideOk()     { document.getElementById('okAlert').style.display='none'; }

init();
