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
  if (r.status === 401) { showAuth(); throw new Error('auth'); }
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-json */ }
  if (!r.ok) throw new Error((j && (j.error || j.msg)) || ('HTTP ' + r.status));
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

let myRole = 'admin';

function showAuth() {
  $('#app-view').classList.add('hidden');
  $('#auth-view').classList.remove('hidden');
  closeDrawer();
}
/* Masuk ke dashboard sesuai peran: admin = dashboard penuh, user = Key Saya. */
function enterApp(me) {
  myRole = me.role || 'admin';
  const isAdmin = myRole === 'admin';
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  document.querySelectorAll('.user-only').forEach(el => el.classList.toggle('hidden', isAdmin));
  if (isAdmin) {
    $('#foot-email').textContent = 'masuk sebagai ' + me.email + ' (admin)';
    switchView('keys');
    refreshAll();
  } else {
    $('#my-foot-email').textContent = 'masuk sebagai ' + me.email;
    switchView('mykeys');
    refreshMine();
  }
}

/* Fingerprint perangkat sederhana untuk batas 3 akun per device. */
function deviceFingerprint() {
  const s = [navigator.userAgent || '', (screen.width || 0) + 'x' + (screen.height || 0),
    (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', navigator.language || ''].join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'fp-' + h.toString(16);
}

/* ------------------------------- auth ----------------------------------- */
document.querySelectorAll('.auth-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const isLogin = t.dataset.tab === 'login';
    $('#login-form').classList.toggle('hidden', !isLogin);
    $('#register-form').classList.toggle('hidden', isLogin);
  });
});
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    const j = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
    });
    $('#login-password').value = '';
    enterApp(j);
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});
$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#reg-error');
  err.classList.add('hidden');
  try {
    const j = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#reg-email').value,
        password: $('#reg-password').value,
        fingerprint: deviceFingerprint()
      })
    });
    $('#reg-password').value = '';
    if (j.suspended) {
      err.textContent = 'Akun dibuat, tapi langsung di-suspend (batas 3 akun per perangkat). Hubungi admin.';
      err.classList.remove('hidden');
      return;
    }
    enterApp(j);
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  showAuth();
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
const VIEW_TITLES = { keys: 'Kunci API', providers: 'Provider', users: 'Pengguna', mykeys: 'Key Saya' };
function switchView(name) {
  document.querySelectorAll('.drawer-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $('.topbar-title').textContent = VIEW_TITLES[name] || '';
  closeDrawer();
  if (name === 'users') loadUsers();
}
document.querySelectorAll('.drawer-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
$('#refresh-btn').addEventListener('click', async () => { await refreshAll(); toast('Diperbarui.'); });
$('#my-refresh-btn').addEventListener('click', async () => { await refreshMine(); toast('Diperbarui.'); });
$('#users-refresh-btn').addEventListener('click', async () => { await loadUsers(); toast('Diperbarui.'); });

/* -------------------------------- stats ---------------------------------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-grid').innerHTML =
    statCard(ICON.key, 'rose', fmtNum(s.totalKeys), 'Total key') +
    statCard(ICON.check, 'green', fmtNum(s.activeKeys), 'Aktif') +
    statCard(ICON.bolt, 'purple', fmtNum(s.totalRequests), 'Request') +
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
async function openConnectModal(id, apiBase, name) {
  connectKeyId = id;
  const j = await api(apiBase + '/' + id + '/reveal');
  $('#connect-base').textContent = BRIDGE_BASE;
  $('#connect-key').textContent = j.token;
  $('#connect-key-name').textContent = name || '';
  let modelId = 'model-id';
  try {
    const mj = await (await fetch(BRIDGE_BASE + '/models', { headers: { 'Authorization': 'Bearer ' + j.token } })).json();
    if (mj && mj.data && mj.data.length && mj.data[0].id) modelId = mj.data[0].id;
  } catch (e) { /* pakai default */ }
  $('#connect-curl').textContent =
    'curl ' + BRIDGE_BASE + '/chat/completions \\\n' +
    '  -H "Authorization: Bearer ' + j.token + '" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"model":"' + modelId + '","messages":[{"role":"user","content":"Halo"}]}\'';
  $('#connect-modal').classList.remove('hidden');
}
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
      await openConnectModal(id, '/api/keys', k ? k.name : '');
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
$('#connect-curl-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-curl').textContent);
  toast('Perintah curl disalin.');
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

/* ------------------------- my keys (pengguna) ---------------------------- */
let myKeysCache = [];
async function loadMyKeys() {
  const j = await api('/api/my-keys');
  myKeysCache = j.keys;
  const box = $('#mykey-list');
  if (!myKeysCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">Belum ada key.<br>Klik <strong>Buat Key</strong> untuk membuat yang pertama.</div></div>';
    return;
  }
  const maxReq = Math.max(1, ...myKeysCache.map(k => k.stats.requests));
  box.innerHTML = myKeysCache.map(k => myKeyCard(k, maxReq)).join('');
}
function myKeyCard(k, maxReq) {
  const pct = Math.min(100, Math.round((k.stats.requests / maxReq) * 100));
  const via = k.mode === 'worker' ? esc(k.workerName || '-') : esc(k.providerName);
  return '<div class="key-card">' +
    '<div class="key-top">' +
      '<span class="key-dot' + (k.revoked ? ' off' : '') + '"></span>' +
      '<span class="key-name">' + esc(k.name) + '</span>' +
      '<span class="badge ' + (k.mode === 'worker' ? 'on' : 'off') + '">' + (k.mode === 'worker' ? 'WORKER' : 'PROVIDER') + '</span>' +
    '</div>' +
    '<div><span class="key-masked">' + esc(k.masked) + '</span></div>' +
    '<div class="key-info">' +
      '<div class="row"><span class="k">' + (k.mode === 'worker' ? 'Worker' : 'Provider') + '</span><span class="v">' + via + '</span></div>' +
      (k.mode === 'worker' ? '<div class="row"><span class="k">Status worker</span><span class="v">' + (k.workerOnline ? 'online' : 'offline') + '</span></div>' : '') +
      '<div class="row"><span class="k">Request</span><span class="v">' + fmtNum(k.stats.requests) + '</span></div>' +
      '<div class="row"><span class="k">Token</span><span class="v">' + fmtNum(k.stats.totalTokens) + '</span></div>' +
      '<div class="usage-bar"><i style="width:' + pct + '%"></i></div>' +
    '</div>' +
    '<div class="key-actions">' +
      '<button class="btn btn-sm btn-primary" data-act="connect" data-id="' + k.id + '">Cara sambung</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '">hapus</button>' +
    '</div>' +
    '<div class="key-meta">dibuat ' + fmtDate(k.createdAt) + ' · terakhir dipakai ' + timeAgo(k.lastUsedAt) + '</div>' +
  '</div>';
}
$('#mykey-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  const k = myKeysCache.find(x => x.id === id);
  try {
    if (act === 'del') {
      if (!confirm('Hapus key "' + (k ? k.name : id) + '" permanen?')) return;
      await api('/api/my-keys/' + id, { method: 'DELETE' });
      toast('Key dihapus.');
      await loadMyKeys();
    } else if (act === 'connect') {
      await openConnectModal(id, '/api/my-keys', k ? k.name : '');
    }
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});

/* my key modal */
$('#my-new-key-btn').addEventListener('click', async () => {
  $('#mykey-form').classList.remove('hidden');
  $('#mykey-result').classList.add('hidden');
  $('#mykey-error').classList.add('hidden');
  try {
    const [p, w] = await Promise.all([api('/api/my-providers'), api('/api/my-workers/available')]);
    $('#mykey-provider').innerHTML = p.providers.length
      ? p.providers.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('')
      : '<option value="">(belum ada provider)</option>';
    const wonline = w.workers.filter(x => x.online);
    $('#mykey-worker').innerHTML = wonline.length
      ? wonline.map(x => '<option value="' + x.id + '">' + esc(x.name) + ' (online)</option>').join('')
      : '<option value="">(tidak ada worker online)</option>';
    $('#mykey-mode').value = 'provider';
    $('#mykey-provider-wrap').classList.remove('hidden');
    $('#mykey-worker-wrap').classList.add('hidden');
    $('#mykey-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});
$('#mykey-mode').addEventListener('change', () => {
  const isWorker = $('#mykey-mode').value === 'worker';
  $('#mykey-provider-wrap').classList.toggle('hidden', isWorker);
  $('#mykey-worker-wrap').classList.toggle('hidden', !isWorker);
});
$('#mykey-modal-close').addEventListener('click', () => $('#mykey-modal').classList.add('hidden'));
$('#mykey-done').addEventListener('click', () => { $('#mykey-modal').classList.add('hidden'); loadMyKeys(); });
$('#mykey-modal').addEventListener('click', e => {
  if (e.target.id === 'mykey-modal') $('#mykey-modal').classList.add('hidden');
});
$('#mykey-once-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#mykey-once-value').textContent);
  toast('Key disalin.');
});
$('#mykey-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#mykey-error');
  err.classList.add('hidden');
  try {
    const mode = $('#mykey-mode').value;
    const body = { name: $('#mykey-name').value, mode };
    if (mode === 'worker') body.workerId = $('#mykey-worker').value;
    else body.providerId = $('#mykey-provider').value;
    const j = await api('/api/my-keys', { method: 'POST', body: JSON.stringify(body) });
    $('#mykey-once-value').textContent = j.token;
    $('#mykey-form').classList.add('hidden');
    $('#mykey-result').classList.remove('hidden');
    $('#mykey-name').value = '';
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});

/* ------------------------ my workers (pengguna) -------------------------- */
let myWorkersCache = [];
async function loadMyWorkers() {
  const j = await api('/api/my-workers');
  myWorkersCache = j.workers;
  $('#myworker-count').textContent = myWorkersCache.length + ' worker';
  const box = $('#myworker-list');
  if (!myWorkersCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">Belum ada worker.<br>Klik <strong>Buat Worker</strong> untuk mendaftarkan worker dari akun AI milikmu.</div></div>';
    return;
  }
  box.innerHTML = myWorkersCache.map(w =>
    '<div class="key-card">' +
      '<div class="key-top">' +
        '<span class="key-dot' + (w.online ? '' : ' off') + '"></span>' +
        '<span class="key-name">' + esc(w.name) + '</span>' +
        (w.online ? '<span class="badge on">ONLINE</span>' : '<span class="badge off">OFFLINE</span>') +
      '</div>' +
      '<div class="key-info">' +
        '<div class="row"><span class="k">Heartbeat terakhir</span><span class="v">' + timeAgo(w.lastHeartbeat) + '</span></div>' +
        '<div class="row"><span class="k">Dibuat</span><span class="v">' + fmtDate(w.createdAt) + '</span></div>' +
      '</div>' +
      '<div class="key-actions">' +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + w.id + '">hapus</button>' +
      '</div>' +
    '</div>'
  ).join('');
}
$('#myworker-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const w = myWorkersCache.find(x => x.id === id);
  if (!confirm('Hapus worker "' + (w ? w.name : id) + '"? Key yang terikat akan dilepas.')) return;
  try {
    await api('/api/my-workers/' + id, { method: 'DELETE' });
    toast('Worker dihapus.');
    await loadMyWorkers();
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
});
$('#my-new-worker-btn').addEventListener('click', () => {
  $('#myworker-form').classList.remove('hidden');
  $('#myworker-result').classList.add('hidden');
  $('#myworker-error').classList.add('hidden');
  $('#myworker-name').value = '';
  $('#myworker-modal').classList.remove('hidden');
});
$('#myworker-modal-close').addEventListener('click', () => $('#myworker-modal').classList.add('hidden'));
$('#myworker-done').addEventListener('click', () => { $('#myworker-modal').classList.add('hidden'); loadMyWorkers(); loadMyKeys(); });
$('#myworker-modal').addEventListener('click', e => {
  if (e.target.id === 'myworker-modal') $('#myworker-modal').classList.add('hidden');
});
$('#myworker-once-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#myworker-once-value').textContent);
  toast('Token disalin.');
});
$('#myworker-instructions-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#myworker-instructions').textContent);
  toast('Instruksi disalin.');
});
$('#myworker-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#myworker-error');
  err.classList.add('hidden');
  try {
    const j = await api('/api/my-workers', {
      method: 'POST',
      body: JSON.stringify({ name: $('#myworker-name').value })
    });
    $('#myworker-once-value').textContent = j.token;
    $('#myworker-instructions').textContent =
      'Kamu adalah worker Hestia Bridge. Ulangi tiap 30 detik, jangan berhenti:\n' +
      '\n' +
      '1. Tanda online — POST ke ' + BRIDGE_BASE.replace(/\/v1$/, '') + '/v1/worker/heartbeat\n' +
      '   Header: Authorization: Bearer ' + j.token + '\n' +
      '\n' +
      '2. Cek antrean — GET ke ' + BRIDGE_BASE.replace(/\/v1$/, '') + '/v1/worker/pending\n' +
      '   (header sama seperti di atas)\n' +
      '\n' +
      '3. Kalau ada chat masuk — untuk tiap id:\n' +
      '   a. POST ke .../v1/worker/claim dengan {"id": "..."} untuk ambil pesannya\n' +
      '   b. Jawab pesannya dengan kemampuanmu\n' +
      '   c. POST ke .../v1/worker/done dengan {"id": "...", "content": "jawabanmu"}\n' +
      '\n' +
      '4. Kalau antrean kosong — santai saja, ulangi lagi 30 detik kemudian.';
    $('#myworker-form').classList.add('hidden');
    $('#myworker-result').classList.remove('hidden');
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = 'Gagal: ' + ex.message;
    err.classList.remove('hidden');
  }
});

/* --------------------------- users (admin) ------------------------------- */
async function loadUsers() {
  const j = await api('/api/users');
  const box = $('#users-list');
  if (!j.users.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">Belum ada pengguna terdaftar.</div></div>';
    return;
  }
  box.innerHTML = j.users.map(u =>
    '<div class="key-card">' +
      '<div class="key-top">' +
        '<span class="key-dot' + (u.suspended ? ' off' : '') + '"></span>' +
        '<span class="key-name">' + esc(u.email) + '</span>' +
        (u.role === 'admin'
          ? '<span class="badge on">ADMIN</span>'
          : (u.suspended ? '<span class="badge off">SUSPENDED</span>' : '<span class="badge on">AKTIF</span>')) +
      '</div>' +
      '<div class="key-info">' +
        '<div class="row"><span class="k">Key</span><span class="v">' + u.keyCount + '</span></div>' +
        '<div class="row"><span class="k">Daftar</span><span class="v">' + fmtDate(u.createdAt) + '</span></div>' +
      '</div>' +
      (u.role === 'admin' ? '' :
        '<div class="key-actions">' +
          (u.suspended
            ? '<button class="btn btn-sm" data-act="unsuspend" data-id="' + u.id + '">buka suspend</button>'
            : '<button class="btn btn-sm" data-act="suspend" data-id="' + u.id + '">suspend</button>') +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + u.id + '">hapus</button>' +
        '</div>') +
    '</div>'
  ).join('');
}
$('#users-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  try {
    if (act === 'suspend') {
      if (!confirm('Suspend pengguna ini? Key miliknya ikut ditolak.')) return;
      await api('/api/users/' + id + '/suspend', { method: 'POST' });
      toast('Pengguna di-suspend.');
    } else if (act === 'unsuspend') {
      await api('/api/users/' + id + '/unsuspend', { method: 'POST' });
      toast('Suspend dibuka.');
    } else if (act === 'del') {
      if (!confirm('Hapus pengguna ini permanen? Semua key miliknya ikut terhapus.')) return;
      await api('/api/users/' + id, { method: 'DELETE' });
      toast('Pengguna dihapus.');
    }
    await loadUsers();
  } catch (ex) { if (ex.message !== 'auth') toast('Gagal: ' + ex.message); }
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
async function refreshMine() {
  await loadMyKeys();
  await loadMyWorkers();
}
(function boot() {
  $('#guide-base-url').textContent = BRIDGE_BASE;
  const guideEl = $('#my-guide-base-url');
  if (guideEl) guideEl.textContent = BRIDGE_BASE;
  $('#login-curl').textContent =
    'curl ' + BRIDGE_BASE + '/chat/completions \\\n' +
    '  -H "Authorization: Bearer hb-xxxx" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"model":"model-id","messages":[{"role":"user","content":"Halo"}]}\'';
  api('/api/auth/me').then(enterApp).catch(() => showAuth());
})();
