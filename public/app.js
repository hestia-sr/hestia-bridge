'use strict';
/* Hestia Bridge frontend — vanilla JS, no build step. */

const $ = s => document.querySelector(s);

const ICON = {
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M8 3h11a1 1 0 0 1 1 1v14h-2V5H8V3zM5 5h2v2H5v12h12v-2h2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>',
  ban: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c2.1 0 4 0.8 5.4 2.1L6.1 17.4A8 8 0 0 1 12 4zm0 16c-2.1 0-4-0.8-5.4-2.1l11.3-11.3A8 8 0 0 1 12 20z" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 5V1L6 7l6 6V9a8 8 0 1 1-8 8H2a10 10 0 1 0 10-12z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2 18.6 6.8 9 16.2z" fill="currentColor"/></svg>'
};

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (r.status === 401) { showLogin(); throw new Error('auth'); }
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-json */ }
  if (!r.ok) throw new Error((j && (j.error || j.detail)) || ('HTTP ' + r.status));
  return j;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('id-ID');
}

function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

/* ------------------------------- login ---------------------------------- */
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
    });
    $('#login-password').value = '';
    showApp();
    await refreshAll();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = ex.message === 'admin_not_configured'
      ? 'Admin belum dikonfigurasi di server (ADMIN_EMAIL / ADMIN_PASSWORD_HASH).'
      : 'Email atau password salah.';
    err.classList.remove('hidden');
  }
});
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  showLogin();
});

/* ------------------------------ navigation ------------------------------- */
$('#main-nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + btn.dataset.view).classList.remove('hidden');
});

/* -------------------------------- stats ---------------------------------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-grid').innerHTML =
    statCard(fmtNum(s.activeKeys) + ' / ' + fmtNum(s.totalKeys), 'Key aktif / total') +
    statCard(fmtNum(s.totalProviders), 'Provider') +
    statCard(fmtNum(s.requests24h), 'Request 24 jam') +
    statCard(fmtNum(s.tokens24h), 'Token 24 jam');
}
function statCard(num, lbl) {
  return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
}

/* -------------------------------- keys ----------------------------------- */
let keysCache = [];
async function loadKeys() {
  const j = await api('/api/keys');
  keysCache = j.keys;
  const tb = $('#keys-tbody');
  if (!keysCache.length) {
    tb.innerHTML = '<tr><td colspan="9" class="muted">Belum ada key. Buat key pertama lewat tombol "Buat Key".</td></tr>';
  } else {
    tb.innerHTML = keysCache.map(k =>
      '<tr>' +
      '<td><strong>' + esc(k.name) + '</strong></td>' +
      '<td>' + esc(k.providerName) + '</td>' +
      '<td><code>' + esc(k.masked) + '</code></td>' +
      '<td>' + fmtDate(k.createdAt) + '</td>' +
      '<td>' + fmtDate(k.lastUsedAt) + '</td>' +
      '<td>' + fmtNum(k.stats.requests) + '</td>' +
      '<td>' + fmtNum(k.stats.totalTokens) + '</td>' +
      '<td>' + (k.revoked
        ? '<span class="badge off">Revoked</span>'
        : '<span class="badge on">Aktif</span>') + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn-sm" data-act="copy" data-id="' + k.id + '" title="Salin key">' + ICON.copy + '</button>' +
        (k.revoked
          ? '<button class="btn btn-sm" data-act="restore" data-id="' + k.id + '" title="Aktifkan lagi">' + ICON.undo + '</button>'
          : '<button class="btn btn-sm btn-danger" data-act="revoke" data-id="' + k.id + '" title="Cabut key">' + ICON.ban + '</button>') +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '" title="Hapus permanen">' + ICON.trash + '</button>' +
      '</div></td></tr>'
    ).join('');
  }
  // usage filter options
  const sel = $('#usage-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua key</option>' +
    keysCache.map(k => '<option value="' + k.id + '">' + esc(k.name) + '</option>').join('');
  sel.value = cur;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('#keys-tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  try {
    if (act === 'copy') {
      const j = await api('/api/keys/' + id + '/reveal');
      await navigator.clipboard.writeText(j.token);
      toast('Key disalin.');
    } else if (act === 'revoke') {
      if (!confirm('Cabut key ini? Key tidak bisa dipakai lagi sampai diaktifkan ulang.')) return;
      await api('/api/keys/' + id + '/revoke', { method: 'POST' });
      toast('Key dicabut.');
      await refreshAll();
    } else if (act === 'restore') {
      await api('/api/keys/' + id + '/restore', { method: 'POST' });
      toast('Key aktif lagi.');
      await refreshAll();
    } else if (act === 'del') {
      if (!confirm('Hapus key ini permanen? Riwayat usage tetap tersimpan.')) return;
      await api('/api/keys/' + id, { method: 'DELETE' });
      toast('Key dihapus.');
      await refreshAll();
    }
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});

/* new key modal */
$('#new-key-btn').addEventListener('click', async () => {
  $('#key-form').classList.remove('hidden');
  $('#key-result').classList.add('hidden');
  $('#key-error').classList.add('hidden');
  try {
    const j = await api('/api/providers');
    if (!j.providers.length) { toast('Tambah provider dulu sebelum buat key.'); return; }
    $('#key-provider').innerHTML = j.providers.map(p =>
      '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.modelCount + ' model)</option>').join('');
    $('#key-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});
$('#key-modal-close').addEventListener('click', () => $('#key-modal').classList.add('hidden'));
$('#key-done').addEventListener('click', () => { $('#key-modal').classList.add('hidden'); refreshAll(); });
$('#key-modal').addEventListener('click', e => {
  if (e.target.id === 'key-modal') $('#key-modal').classList.add('hidden');
});
$('#key-once-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#key-once-value').textContent);
  toast('Key disalin.');
});
$('#key-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#key-error');
  err.classList.add('hidden');
  try {
    const j = await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: $('#key-name').value, providerId: $('#key-provider').value })
    });
    $('#key-once-value').textContent = j.token;
    $('#key-form').classList.add('hidden');
    $('#key-result').classList.remove('hidden');
    $('#key-name').value = '';
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});

/* ------------------------------ providers -------------------------------- */
async function loadProviders() {
  const j = await api('/api/providers');
  const tb = $('#prov-tbody');
  if (!j.providers.length) {
    tb.innerHTML = '<tr><td colspan="5" class="muted">Belum ada provider.</td></tr>';
    return;
  }
  tb.innerHTML = j.providers.map(p =>
    '<tr>' +
    '<td><strong>' + esc(p.name) + '</strong></td>' +
    '<td><code>' + esc(p.baseUrl) + '</code></td>' +
    '<td>' + p.modelCount + ' model</td>' +
    '<td>' + fmtDate(p.createdAt) + '</td>' +
    '<td><div class="row-actions">' +
      '<button class="btn btn-sm" data-act="test" data-id="' + p.id + '" title="Test koneksi">' + ICON.check + ' Test</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + p.id + '" title="Hapus">' + ICON.trash + '</button>' +
    '</div></td></tr>'
  ).join('');
}
$('#prov-tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  try {
    if (btn.dataset.act === 'test') {
      btn.disabled = true;
      const j = await api('/api/providers/' + id + '/test', { method: 'POST' });
      btn.disabled = false;
      toast(j.ok ? ('Koneksi OK — ' + j.modelCount + ' model.') : ('Gagal: ' + j.error));
      await loadProviders();
    } else if (btn.dataset.act === 'del') {
      if (!confirm('Hapus provider ini? Key yang terikat akan di-revoke.')) return;
      await api('/api/providers/' + id, { method: 'DELETE' });
      toast('Provider dihapus.');
      await refreshAll();
    }
  } catch (ex) { btn.disabled = false; if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});
$('#provider-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#prov-error');
  err.classList.add('hidden');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Memvalidasi...';
  try {
    await api('/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#prov-name').value,
        baseUrl: $('#prov-base').value,
        apiKey: $('#prov-key').value
      })
    });
    $('#prov-name').value = ''; $('#prov-base').value = ''; $('#prov-key').value = '';
    toast('Provider tersimpan dan tervalidasi.');
    await refreshAll();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan & Validasi';
  }
});

/* -------------------------------- usage ---------------------------------- */
async function loadUsage() {
  const keyId = $('#usage-filter').value;
  const j = await api('/api/usage?days=30' + (keyId ? '&keyId=' + encodeURIComponent(keyId) : ''));
  const nameOf = id => {
    const k = keysCache.find(x => x.id === id);
    return k ? k.name : id.slice(0, 12);
  };
  const tb = $('#usage-tbody');
  if (!j.rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Belum ada data pemakaian.</td></tr>';
    return;
  }
  tb.innerHTML = j.rows.map(u =>
    '<tr><td>' + fmtDate(u.ts) + '</td><td>' + esc(nameOf(u.keyId)) + '</td>' +
    '<td><code>' + esc(u.model) + '</code></td>' +
    '<td>' + fmtNum(u.promptTokens) + '</td><td>' + fmtNum(u.completionTokens) + '</td>' +
    '<td>' + (u.streamed ? 'Ya' : 'Tidak') + '</td></tr>'
  ).join('');
}
$('#usage-filter').addEventListener('change', loadUsage);

/* --------------------------------- boot ----------------------------------- */
async function refreshAll() {
  await loadStats();
  await loadKeys();
  await loadProviders();
  await loadUsage();
}
(function boot() {
  $('#base-url-example').textContent = location.origin + '/v1';
  $('#curl-example').textContent =
    'curl ' + location.origin + '/v1/chat/completions \\\n' +
    '  -H "Authorization: Bearer hb-xxxx" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"model":"model-id","messages":[{"role":"user","content":"Halo"}]}\'';
  api('/api/auth/me').then(() => { showApp(); refreshAll(); }).catch(() => showLogin());
})();
