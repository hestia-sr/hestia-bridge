'use strict';
/* Hestia Bridge frontend — vanilla JS, no build step. */

const $ = s => document.querySelector(s);
const BRIDGE_BASE = location.origin + '/v1';

const ICON = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 3h11a1 1 0 0 1 1 1v14h-2V5H8V3zM5 5h2v2H5v12h12v-2h2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="currentColor"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14 3a7 7 0 0 0-6.9 8.2L3 15.3V21h5.7l4.1-4.1A7 7 0 1 0 14 3zm1.4 4.6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2 18.6 6.8 9 16.2z" fill="currentColor"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z" fill="currentColor"/></svg>'
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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('id-ID');
}
function timeAgo(iso) {
  if (!iso) return 'belum pernah';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + ' dtk lalu';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  closeDrawer();
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

/* ------------------------------ drawer ---------------------------------- */
function openDrawer() {
  $('#drawer').classList.add('open');
  $('#drawer-backdrop').classList.remove('hidden');
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer-backdrop').classList.add('hidden');
}
$('#drawer-btn').addEventListener('click', openDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.querySelectorAll('.drawer-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.drawer-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $('#view-' + btn.dataset.view).classList.remove('hidden');
    $('.topbar-title').textContent = btn.dataset.view === 'keys' ? 'Kunci API' : 'Provider';
    closeDrawer();
  });
});
$('#refresh-btn').addEventListener('click', async () => { await refreshAll(); toast('Diperbarui.'); });

/* -------------------------------- stats ---------------------------------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-grid').innerHTML =
    statCard(ICON.key, 'orange', fmtNum(s.totalKeys), 'Total key') +
    statCard(ICON.check, 'green', fmtNum(s.activeKeys), 'Aktif') +
    statCard(ICON.bolt, 'blue', fmtNum(s.totalRequests), 'Request') +
    statCard(ICON.warn, 'red', fmtNum(s.limitedKeysToday || 0), 'Limit habis');
}
function statCard(icon, tint, num, lbl) {
  return '<div class="stat"><div class="stat-ico ' + tint + '">' + icon + '</div>' +
    '<div><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div></div>';
}

/* -------------------------------- keys ----------------------------------- */
let keysCache = [];
async function loadKeys() {
  const j = await api('/api/keys');
  keysCache = j.keys;
  $('#key-count').textContent = keysCache.length + ' key';
  const box = $('#key-list');
  if (!keysCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">Belum ada key.<br>Klik <strong>+ Tambah key</strong> untuk membuat yang pertama.</div></div>';
    return;
  }
  const maxReq = Math.max(1, ...keysCache.map(k => k.stats.requests));
  box.innerHTML = keysCache.map(k => keyCard(k, maxReq)).join('');
}
function keyCard(k, maxReq) {
  const pct = Math.min(100, Math.round((k.stats.requests / maxReq) * 100));
  return '<div class="key-card">' +
    '<div class="key-top">' +
      '<span class="key-dot' + (k.revoked ? ' off' : '') + '"></span>' +
      '<span class="key-name">' + esc(k.name) + '</span>' +
      (k.revoked ? '<span class="badge off">NONAKTIF</span>' : '<span class="badge on">AKTIF</span>') +
    '</div>' +
    '<div><span class="key-masked">' + esc(k.masked) + '</span></div>' +
    '<div class="key-info">' +
      '<div class="row"><span class="k">Provider</span><span class="v">' + esc(k.providerName) + '</span></div>' +
      '<div class="row"><span class="k">Request</span><span class="v">' + fmtNum(k.stats.requests) + '</span></div>' +
      '<div class="row"><span class="k">Token</span><span class="v">' + fmtNum(k.stats.totalTokens) + '</span></div>' +
      '<div class="usage-bar"><i style="width:' + pct + '%"></i></div>' +
    '</div>' +
    '<div class="key-actions">' +
      (k.revoked
        ? '<button class="btn btn-sm" data-act="restore" data-id="' + k.id + '">aktifkan</button>'
        : '<button class="btn btn-sm" data-act="revoke" data-id="' + k.id + '">nonaktifkan</button>') +
      '<button class="btn btn-sm btn-primary" data-act="connect" data-id="' + k.id + '">Cara sambung</button>' +
      '<button class="btn btn-sm" data-act="edit" data-id="' + k.id + '">edit</button>' +
      '<button class="btn btn-sm" data-act="rotate" data-id="' + k.id + '">rotate</button>' +
      '<button class="btn btn-sm" data-act="reset" data-id="' + k.id + '">reset pakai</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '">hapus</button>' +
    '</div>' +
    '<div class="key-meta">dibuat ' + fmtDate(k.createdAt) + ' · terakhir dipakai ' + timeAgo(k.lastUsedAt) + '</div>' +
  '</div>';
}

let connectKeyId = null;
$('#key-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  const k = keysCache.find(x => x.id === id);
  try {
    if (act === 'revoke') {
      if (!confirm('Nonaktifkan key "' + (k ? k.name : id) + '"? Key tidak bisa dipakai sampai diaktifkan lagi.')) return;
      await api('/api/keys/' + id + '/revoke', { method: 'POST' });
      toast('Key dinonaktifkan.');
      await refreshAll();
    } else if (act === 'restore') {
      await api('/api/keys/' + id + '/restore', { method: 'POST' });
      toast('Key aktif lagi.');
      await refreshAll();
    } else if (act === 'del') {
      if (!confirm('Hapus key "' + (k ? k.name : id) + '" permanen?')) return;
      await api('/api/keys/' + id, { method: 'DELETE' });
      toast('Key dihapus.');
      await refreshAll();
    } else if (act === 'edit') {
      $('#rename-name').value = k ? k.name : '';
      $('#rename-error').classList.add('hidden');
      $('#rename-modal').dataset.id = id;
      $('#rename-modal').classList.remove('hidden');
    } else if (act === 'rotate') {
      if (!confirm('Buat ulang key ini? Key lama langsung tidak berlaku.')) return;
      const j = await api('/api/keys/' + id + '/rotate', { method: 'POST' });
      $('#key-once-value').textContent = j.token;
      $('#key-form').classList.add('hidden');
      $('#key-result').classList.remove('hidden');
      $('#key-modal').classList.remove('hidden');
      toast('Key baru dibuat — salin sekarang.');
      await refreshAll();
    } else if (act === 'reset') {
      if (!confirm('Nolkan statistik pemakaian key ini?')) return;
      await api('/api/keys/' + id + '/reset-usage', { method: 'POST' });
      toast('Statistik direset.');
      await refreshAll();
    } else if (act === 'connect') {
      connectKeyId = id;
      const j = await api('/api/keys/' + id + '/reveal');
      $('#connect-base').textContent = BRIDGE_BASE;
      $('#connect-key').textContent = j.token;
      $('#connect-key-name').textContent = k ? k.name : '';
      $('#connect-curl').textContent =
        'curl ' + BRIDGE_BASE + '/chat/completions \\\n' +
        '  -H "Authorization: Bearer ' + j.token + '" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d \'{"model":"model-id","messages":[{"role":"user","content":"Halo"}]}\'';
      $('#connect-modal').classList.remove('hidden');
    }
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});
$('#connect-modal-close').addEventListener('click', () => $('#connect-modal').classList.add('hidden'));
$('#connect-modal').addEventListener('click', e => {
  if (e.target.id === 'connect-modal') $('#connect-modal').classList.add('hidden');
});
$('#connect-base-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-base').textContent);
  toast('Base URL disalin.');
});
$('#connect-key-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-key').textContent);
  toast('API key disalin.');
});

/* rename modal */
$('#rename-modal-close').addEventListener('click', () => $('#rename-modal').classList.add('hidden'));
$('#rename-modal').addEventListener('click', e => {
  if (e.target.id === 'rename-modal') $('#rename-modal').classList.add('hidden');
});
$('#rename-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#rename-modal').dataset.id;
  const err = $('#rename-error');
  err.classList.add('hidden');
  try {
    await api('/api/keys/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ name: $('#rename-name').value })
    });
    $('#rename-modal').classList.add('hidden');
    toast('Nama diubah.');
    await refreshAll();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});

/* new key modal */
$('#new-key-btn').addEventListener('click', async () => {
  $('#key-form').classList.remove('hidden');
  $('#key-result').classList.add('hidden');
  $('#key-error').classList.add('hidden');
  try {
    const j = await api('/api/providers');
    if (!j.providers.length) { toast('Tambah provider dulu di halaman Provider.'); return; }
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
  const box = $('#prov-list');
  if (!j.providers.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">Belum ada provider.</div></div>';
    return;
  }
  box.innerHTML = j.providers.map(p =>
    '<div class="key-card">' +
      '<div class="key-top">' +
        '<span class="key-dot"></span>' +
        '<span class="key-name">' + esc(p.name) + '</span>' +
      '</div>' +
      '<div><span class="key-masked">' + esc(maskBase(p.baseUrl)) + '</span></div>' +
      '<div class="key-info">' +
        '<div class="row"><span class="k">Model</span><span class="v">' + p.modelCount + ' model</span></div>' +
        '<div class="row"><span class="k">Ditambah</span><span class="v">' + fmtDate(p.createdAt) + '</span></div>' +
      '</div>' +
      '<div class="key-actions">' +
        '<button class="btn btn-sm" data-act="test" data-id="' + p.id + '">Test</button>' +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + p.id + '">hapus</button>' +
      '</div>' +
    '</div>'
  ).join('');
}
function maskBase(u) {
  try {
    const url = new URL(u);
    return url.host + (url.pathname.length > 1 ? '/...' : '');
  } catch (e) { return String(u).slice(0, 28) + '...'; }
}
$('#prov-list').addEventListener('click', async e => {
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

/* --------------------------- export CSV ---------------------------------- */
$('#export-btn').addEventListener('click', async () => {
  try {
    const j = await api('/api/usage?days=30');
    const nameOf = id => {
      const k = keysCache.find(x => x.id === id);
      return k ? k.name : id;
    };
    const rows = [['waktu', 'key', 'model', 'token_masuk', 'token_keluar', 'stream']]
      .concat(j.rows.map(u => [u.ts, nameOf(u.keyId), u.model, u.promptTokens, u.completionTokens, u.streamed ? 'ya' : 'tidak']));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'hestia-bridge-usage.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Data pemakaian diunduh.');
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});

/* --------------------------------- boot ----------------------------------- */
async function refreshAll() {
  await loadStats();
  await loadKeys();
  await loadProviders();
}
(function boot() {
  $('#guide-base-url').textContent = BRIDGE_BASE;
  $('#login-curl').textContent =
    'curl ' + BRIDGE_BASE + '/chat/completions \\\n' +
    '  -H "Authorization: Bearer hb-xxxx" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"model":"model-id","messages":[{"role":"user","content":"Halo"}]}\'';
  api('/api/auth/me').then(me => {
    $('#foot-email').textContent = 'masuk sebagai ' + me.email;
    showApp();
    refreshAll();
  }).catch(() => showLogin());
})();
