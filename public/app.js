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
  return d.toLocaleString(LANG === 'en' ? 'en-US' : 'id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString(LANG === 'en' ? 'en-US' : 'id-ID');
}
function timeAgo(iso) {
  if (!iso) return t('time.never');
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + t('time.sec');
  if (s < 3600) return Math.floor(s / 60) + t('time.min');
  if (s < 86400) return Math.floor(s / 3600) + t('time.hour');
  return Math.floor(s / 86400) + t('time.day');
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
  window.currentUser = me;
  const isAdmin = myRole === 'admin';
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  document.querySelectorAll('.user-only').forEach(el => el.classList.toggle('hidden', isAdmin));
  if (isAdmin) {
    $('#foot-email').textContent = t('foot.signedin') + ' ' + me.email + ' (' + t('foot.admin') + ')';
    switchView('home');
    refreshAll();
  } else {
    $('#my-foot-email').textContent = t('foot.signedin') + ' ' + me.email;
    switchView('home');
    refreshMine();
  }
  renderApps();
  $('#home-cta').onclick = () => switchView(isAdmin ? 'keys' : 'mykeys');
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
    err.textContent = t('toast.failed') + ex.message;
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
      err.textContent = t('auth.suspended');
      err.classList.remove('hidden');
      return;
    }
    enterApp(j);
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  }
});
async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  showAuth();
}
$('#logout-btn2').addEventListener('click', doLogout);

/* --------------------------- account panel ------------------------------ */
const BOT_URL = 'https://t.me/Hestia_gateway_bot';
function openAccount() {
  const email = (window.currentUser && window.currentUser.email) || '';
  $('#account-email').textContent = email || '-';
  const initial = (email[0] || 'H').toUpperCase();
  $('#account-avatar').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(initial) + '&background=9b4dca&color=fff&size=128&bold=true';
  const panel = $('#account-panel');
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('open'));
  $('#account-backdrop').hidden = false;
  closeDrawer();
}
function closeAccount() {
  const panel = $('#account-panel');
  panel.classList.remove('open');
  $('#account-backdrop').hidden = true;
  setTimeout(() => { panel.hidden = true; }, 300);
}
$('#account-btn').addEventListener('click', openAccount);
$('#account-close').addEventListener('click', closeAccount);
$('#account-backdrop').addEventListener('click', closeAccount);
const DURATIONS = {
  '1': { id: '1 Hari', en: '1 Day', price: 'Rp 5.000' },
  '3': { id: '3 Hari', en: '3 Days', price: 'Rp 10.000' },
  '7': { id: '1 Minggu', en: '1 Week', price: 'Rp 15.000' },
};
function openQris(dur) {
  const d = DURATIONS[dur];
  if (!d) return;
  $('#qris-title').textContent = (LANG === 'en' ? 'Payment - ' : 'Pembayaran - ') + (LANG === 'en' ? d.en : d.id);
  $('#qris-amount').textContent = d.price;
  $('#qris-bot-btn').href = BOT_URL + '?start=durasi_' + dur;
  $('#qris-modal').classList.remove('hidden');
  closeAccount();
}
$('#qris-close').addEventListener('click', () => $('#qris-modal').classList.add('hidden'));
$('#qris-modal').addEventListener('click', e => {
  if (e.target.id === 'qris-modal') $('#qris-modal').classList.add('hidden');
});
document.querySelectorAll('.duration-card').forEach(card => {
  card.addEventListener('click', () => openQris(card.dataset.dur));
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
const VIEW_TITLES = { home: 'nav.home', keys: 'topbar.keys', providers: 'nav.providers', users: 'nav.users', mykeys: 'nav.mykeys' };
function switchView(name) {
  document.querySelectorAll('.drawer-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $('.topbar-title').textContent = t(VIEW_TITLES[name] || 'topbar.keys');
  closeDrawer();
  if (name === 'users') loadUsers();
}
document.querySelectorAll('.drawer-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
$('#refresh-btn').addEventListener('click', async () => { await refreshAll(); toast(t('toast.refreshed')); });
$('#my-refresh-btn').addEventListener('click', async () => { await refreshMine(); toast(t('toast.refreshed')); });
$('#users-refresh-btn').addEventListener('click', async () => { await loadUsers(); toast(t('toast.refreshed')); });

/* -------------------------------- stats ---------------------------------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-grid').innerHTML =
    statCard(ICON.key, 'rose', fmtNum(s.totalKeys), t('stat.total')) +
    statCard(ICON.check, 'green', fmtNum(s.activeKeys), t('stat.active')) +
    statCard(ICON.bolt, 'purple', fmtNum(s.totalRequests), t('stat.requests')) +
    statCard(ICON.warn, 'red', fmtNum(s.limitedKeysToday || 0), t('stat.limited'));
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
  $('#key-count').textContent = keysCache.length + ' ' + t('count.keys');
  const box = $('#key-list');
  if (!keysCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">' + t('empty.keys') + '</div></div>';
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
      (k.revoked ? '<span class="badge off">' + t('card.disabled') + '</span>' : '<span class="badge on">' + t('card.active') + '</span>') +
    '</div>' +
    '<div><span class="key-masked">' + esc(k.masked) + '</span></div>' +
    '<div class="key-info">' +
      '<div class="row"><span class="k">' + t('card.provider') + '</span><span class="v">' + esc(k.providerName) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.request') + '</span><span class="v">' + fmtNum(k.stats.requests) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.in') + '</span><span class="v">' + fmtNum(k.stats.promptTokens) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.out') + '</span><span class="v">' + fmtNum(k.stats.completionTokens) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.total') + '</span><span class="v">' + fmtNum(k.stats.totalTokens) + '</span></div>' +
      (k.tokenQuota ? '<div class="row"><span class="k">' + t('card.quota') + '</span><span class="v">' + fmtNum(k.tokenQuota) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.remaining') + '</span><span class="v">' + fmtNum(Math.max(0, k.tokenQuota - k.stats.totalTokens)) + '</span></div>' : '') +
      '<div class="usage-bar"><i style="width:' + pct + '%"></i></div>' +
    '</div>' +
    '<div class="key-actions">' +
      (k.revoked
        ? '<button class="btn btn-sm" data-act="restore" data-id="' + k.id + '">' + t('btn.activate') + '</button>'
        : '<button class="btn btn-sm" data-act="revoke" data-id="' + k.id + '">' + t('btn.deactivate') + '</button>') +
      '<button class="btn btn-sm btn-primary" data-act="connect" data-id="' + k.id + '">' + t('btn.connect') + '</button>' +
      '<button class="btn btn-sm" data-act="edit" data-id="' + k.id + '">' + t('btn.edit') + '</button>' +
      '<button class="btn btn-sm" data-act="rotate" data-id="' + k.id + '">' + t('btn.rotate') + '</button>' +
      '<button class="btn btn-sm" data-act="reset" data-id="' + k.id + '">' + t('btn.reset') + '</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '">' + t('btn.delete') + '</button>' +
    '</div>' +
    '<div class="key-meta">' + t('card.created') + ' ' + fmtDate(k.createdAt) + ' · ' + t('card.lastused') + ' ' + timeAgo(k.lastUsedAt) + '</div>' +
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
      if (!confirm(t('confirm.key.deactivate').replace('{name}', k ? k.name : id))) return;
      await api('/api/keys/' + id + '/revoke', { method: 'POST' });
      toast(t('toast.key.deactivated'));
      await refreshAll();
    } else if (act === 'restore') {
      await api('/api/keys/' + id + '/restore', { method: 'POST' });
      toast(t('toast.key.reactivated'));
      await refreshAll();
    } else if (act === 'del') {
      if (!confirm(t('confirm.key.delete').replace('{name}', k ? k.name : id))) return;
      await api('/api/keys/' + id, { method: 'DELETE' });
      toast(t('toast.key.deleted'));
      await refreshAll();
    } else if (act === 'edit') {
      $('#rename-name').value = k ? k.name : '';
      $('#rename-quota').value = k && k.tokenQuota ? k.tokenQuota : '';
      $('#rename-error').classList.add('hidden');
      $('#rename-modal').dataset.id = id;
      $('#rename-modal').classList.remove('hidden');
    } else if (act === 'rotate') {
      if (!confirm(t('confirm.key.rotate'))) return;
      const j = await api('/api/keys/' + id + '/rotate', { method: 'POST' });
      $('#key-once-value').textContent = j.token;
      $('#key-form').classList.add('hidden');
      $('#key-result').classList.remove('hidden');
      $('#key-modal').classList.remove('hidden');
      toast(t('toast.key.created'));
      await refreshAll();
    } else if (act === 'reset') {
      if (!confirm(t('confirm.key.reset'))) return;
      await api('/api/keys/' + id + '/reset-usage', { method: 'POST' });
      toast(t('toast.stats.reset'));
      await refreshAll();
    } else if (act === 'connect') {
      await openConnectModal(id, '/api/keys', k ? k.name : '');
    }
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});
$('#connect-modal-close').addEventListener('click', () => $('#connect-modal').classList.add('hidden'));
$('#connect-modal').addEventListener('click', e => {
  if (e.target.id === 'connect-modal') $('#connect-modal').classList.add('hidden');
});
$('#connect-base-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-base').textContent);
  toast(t('toast.base.copied'));
});
$('#connect-key-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-key').textContent);
  toast(t('toast.apikey.copied'));
});
$('#connect-curl-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#connect-curl').textContent);
  toast(t('toast.curl.copied'));
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
  const qv = parseInt($('#rename-quota').value, 10);
  try {
    await api('/api/keys/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ name: $('#rename-name').value, tokenQuota: qv > 0 ? qv : null })
    });
    $('#rename-modal').classList.add('hidden');
    toast(t('toast.saved'));
    await refreshAll();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
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
    if (!j.providers.length) { toast(t('toast.addprovider')); return; }
    $('#key-provider').innerHTML = j.providers.map(p =>
      '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.modelCount + ' ' + t('card.models') + ')</option>').join('');
    $('#key-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});
$('#key-modal-close').addEventListener('click', () => $('#key-modal').classList.add('hidden'));
$('#key-done').addEventListener('click', () => { $('#key-modal').classList.add('hidden'); refreshAll(); });
$('#key-modal').addEventListener('click', e => {
  if (e.target.id === 'key-modal') $('#key-modal').classList.add('hidden');
});
$('#key-once-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#key-once-value').textContent);
  toast(t('toast.key.copied'));
});
$('#key-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#key-error');
  err.classList.add('hidden');
  const qv = parseInt($('#key-quota').value, 10);
  try {
    const j = await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: $('#key-name').value, providerId: $('#key-provider').value, tokenQuota: qv > 0 ? qv : null })
    });
    $('#key-once-value').textContent = j.token;
    $('#key-form').classList.add('hidden');
    $('#key-result').classList.remove('hidden');
    $('#key-name').value = '';
    $('#key-quota').value = '';
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  }
});

/* ------------------------------ providers -------------------------------- */
async function loadProviders() {
  const j = await api('/api/providers');
  const box = $('#prov-list');
  if (!j.providers.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">' + t('empty.providers') + '</div></div>';
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
        '<div class="row"><span class="k">' + t('card.models') + '</span><span class="v">' + p.modelCount + ' ' + t('card.models') + '</span></div>' +
        '<div class="row"><span class="k">' + t('card.added') + '</span><span class="v">' + fmtDate(p.createdAt) + '</span></div>' +
      '</div>' +
      '<div class="key-actions">' +
        '<button class="btn btn-sm" data-act="test" data-id="' + p.id + '">' + t('btn.test') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + p.id + '">' + t('btn.delete') + '</button>' +
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
      toast(j.ok ? (t('toast.conn.ok') + j.modelCount + ' ' + t('card.models') + '.') : (t('toast.failed') + j.error));
      await loadProviders();
    } else if (btn.dataset.act === 'del') {
      if (!confirm(t('confirm.provider.delete'))) return;
      await api('/api/providers/' + id, { method: 'DELETE' });
      toast(t('toast.provider.deleted'));
      await refreshAll();
    }
  } catch (ex) { btn.disabled = false; if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});
$('#provider-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#prov-error');
  err.classList.add('hidden');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = t('form.provider.validating');
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
    toast(t('toast.provider.saved'));
    await refreshAll();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = t('form.provider.submit');
  }
});

/* ------------------------- my keys (pengguna) ---------------------------- */
let myKeysCache = [];
async function loadMyKeys() {
  const j = await api('/api/my-keys');
  myKeysCache = j.keys;
  const box = $('#mykey-list');
  if (!myKeysCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">' + t('empty.mykeys') + '</div></div>';
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
      '<div class="row"><span class="k">' + (k.mode === 'worker' ? t('card.worker') : t('card.provider')) + '</span><span class="v">' + via + '</span></div>' +
      (k.mode === 'worker' ? '<div class="row"><span class="k">' + t('card.worker.status') + '</span><span class="v">' + (k.workerOnline ? t('card.online') : t('card.offline')) + '</span></div>' : '') +
      '<div class="row"><span class="k">' + t('card.request') + '</span><span class="v">' + fmtNum(k.stats.requests) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.in') + '</span><span class="v">' + fmtNum(k.stats.promptTokens) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.out') + '</span><span class="v">' + fmtNum(k.stats.completionTokens) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.tokens.total') + '</span><span class="v">' + fmtNum(k.stats.totalTokens) + '</span></div>' +
      (k.tokenQuota ? '<div class="row"><span class="k">' + t('card.quota') + '</span><span class="v">' + fmtNum(k.tokenQuota) + '</span></div>' +
      '<div class="row"><span class="k">' + t('card.remaining') + '</span><span class="v">' + fmtNum(Math.max(0, k.tokenQuota - k.stats.totalTokens)) + '</span></div>' : '') +
      '<div class="usage-bar"><i style="width:' + pct + '%"></i></div>' +
    '</div>' +
    '<div class="key-actions">' +
      '<button class="btn btn-sm btn-primary" data-act="connect" data-id="' + k.id + '">' + t('btn.connect') + '</button>' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '">' + t('btn.delete') + '</button>' +
    '</div>' +
    '<div class="key-meta">' + t('card.created') + ' ' + fmtDate(k.createdAt) + ' · ' + t('card.lastused') + ' ' + timeAgo(k.lastUsedAt) + '</div>' +
  '</div>';
}
$('#mykey-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  const k = myKeysCache.find(x => x.id === id);
  try {
    if (act === 'del') {
      if (!confirm(t('confirm.key.delete').replace('{name}', k ? k.name : id))) return;
      await api('/api/my-keys/' + id, { method: 'DELETE' });
      toast(t('toast.key.deleted'));
      await loadMyKeys();
    } else if (act === 'connect') {
      await openConnectModal(id, '/api/my-keys', k ? k.name : '');
    }
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
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
      : '<option value="">' + t('opt.no.provider') + '</option>';
    const wonline = w.workers.filter(x => x.online);
    $('#mykey-worker').innerHTML = wonline.length
      ? wonline.map(x => '<option value="' + x.id + '">' + esc(x.name) + t('opt.online') + '</option>').join('')
      : '<option value="">' + t('opt.no.worker') + '</option>';
    $('#mykey-mode').value = 'provider';
    $('#mykey-provider-wrap').classList.remove('hidden');
    $('#mykey-worker-wrap').classList.add('hidden');
    $('#mykey-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
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
  toast(t('toast.key.copied'));
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
    const qv = parseInt($('#mykey-quota').value, 10);
    if (qv > 0) body.tokenQuota = qv;
    const j = await api('/api/my-keys', { method: 'POST', body: JSON.stringify(body) });
    $('#mykey-once-value').textContent = j.token;
    $('#mykey-form').classList.add('hidden');
    $('#mykey-result').classList.remove('hidden');
    $('#mykey-name').value = '';
    $('#mykey-quota').value = '';
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  }
});

/* ------------------------ my workers (pengguna) -------------------------- */
let myWorkersCache = [];
async function loadMyWorkers() {
  const j = await api('/api/my-workers');
  myWorkersCache = j.workers;
  $('#myworker-count').textContent = myWorkersCache.length + ' ' + t('count.workers');
  const box = $('#myworker-list');
  if (!myWorkersCache.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">' + t('empty.workers') + '</div></div>';
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
        '<div class="row"><span class="k">' + t('card.heartbeat') + '</span><span class="v">' + timeAgo(w.lastHeartbeat) + '</span></div>' +
        '<div class="row"><span class="k">' + t('card.added') + '</span><span class="v">' + fmtDate(w.createdAt) + '</span></div>' +
      '</div>' +
      '<div class="key-actions">' +
        '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + w.id + '">' + t('btn.delete') + '</button>' +
      '</div>' +
    '</div>'
  ).join('');
}
$('#myworker-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const w = myWorkersCache.find(x => x.id === id);
  if (!confirm(t('confirm.worker.delete').replace('{name}', w ? w.name : id))) return;
  try {
    await api('/api/my-workers/' + id, { method: 'DELETE' });
    toast(t('toast.worker.deleted'));
    await loadMyWorkers();
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
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
  toast(t('toast.token.copied'));
});
$('#myworker-instructions-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#myworker-instructions').textContent);
  toast(t('toast.instr.copied'));
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
    const _base = BRIDGE_BASE.replace(/\/v1$/, '');
    $('#myworker-instructions').textContent = LANG === 'en'
      ? 'You are a Hestia Bridge worker. Repeat every 30 seconds, do not stop:\n' +
      '\n' +
      '1. Stay online — POST to ' + _base + '/v1/worker/heartbeat\n' +
      '   Header: Authorization: Bearer ' + j.token + '\n' +
      '\n' +
      '2. Check the queue — GET ' + _base + '/v1/worker/pending\n' +
      '   (same header as above)\n' +
      '\n' +
      '3. If a chat arrives — for each id:\n' +
      '   a. POST to .../v1/worker/claim with {"id": "..."} to fetch the message\n' +
      '   b. Answer the message with your abilities\n' +
      '   c. POST to .../v1/worker/done with {"id": "...", "content": "your answer"}\n' +
      '\n' +
      '4. If the queue is empty — just relax, repeat again in 30 seconds.'
      : 'Kamu adalah worker Hestia Bridge. Ulangi tiap 30 detik, jangan berhenti:\n' +
      '\n' +
      '1. Tanda online — POST ke ' + _base + '/v1/worker/heartbeat\n' +
      '   Header: Authorization: Bearer ' + j.token + '\n' +
      '\n' +
      '2. Cek antrean — GET ke ' + _base + '/v1/worker/pending\n' +
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
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  }
});

/* --------------------------- users (admin) ------------------------------- */
async function loadUsers() {
  const j = await api('/api/users');
  const box = $('#users-list');
  if (!j.users.length) {
    box.innerHTML = '<div class="card"><div class="card-body empty muted">' + t('empty.users') + '</div></div>';
    return;
  }
  box.innerHTML = j.users.map(u =>
    '<div class="key-card">' +
      '<div class="key-top">' +
        '<span class="key-dot' + (u.suspended ? ' off' : '') + '"></span>' +
        '<span class="key-name">' + esc(u.email) + '</span>' +
        (u.role === 'admin'
          ? '<span class="badge on">' + t('badge.admin') + '</span>'
          : (u.suspended ? '<span class="badge off">' + t('badge.suspended') + '</span>' : '<span class="badge on">' + t('badge.active') + '</span>')) +
      '</div>' +
      '<div class="key-info">' +
        '<div class="row"><span class="k">' + t('card.keys') + '</span><span class="v">' + u.keyCount + '</span></div>' +
        '<div class="row"><span class="k">' + t('card.registered') + '</span><span class="v">' + fmtDate(u.createdAt) + '</span></div>' +
      '</div>' +
      (u.role === 'admin' ? '' :
        '<div class="key-actions">' +
          (u.suspended
            ? '<button class="btn btn-sm" data-act="unsuspend" data-id="' + u.id + '">' + t('btn.unsuspend') + '</button>'
            : '<button class="btn btn-sm" data-act="suspend" data-id="' + u.id + '">' + t('btn.suspend') + '</button>') +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + u.id + '">' + t('btn.delete') + '</button>' +
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
      if (!confirm(t('confirm.user.suspend'))) return;
      await api('/api/users/' + id + '/suspend', { method: 'POST' });
      toast(t('toast.user.suspended'));
    } else if (act === 'unsuspend') {
      await api('/api/users/' + id + '/unsuspend', { method: 'POST' });
      toast(t('toast.user.unsuspended'));
    } else if (act === 'del') {
      if (!confirm(t('confirm.user.delete'))) return;
      await api('/api/users/' + id, { method: 'DELETE' });
      toast(t('toast.user.deleted'));
    }
    await loadUsers();
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});

/* --------------------------- home: apps grid --------------------------- */
const SUPPORTED_APPS = [
  { name: 'Muse AI', plat: 'Android · iOS · Web', desc_id: 'Didukung penuh oleh Bridge', desc_en: 'Fully supported by Bridge', logo: 'logos/muse.png', icon: null },
  { name: 'ChatBox', plat: 'Android · iOS · Desktop', desc_id: 'Paling mudah untuk pemula', desc_en: 'Easiest for beginners', logo: 'logos/chatbox.png', icon: null },
  { name: 'Cherry Studio', plat: 'Android · iOS · Desktop', desc_id: 'Populer di Asia', desc_en: 'Popular in Asia', logo: 'logos/cherry.png', icon: null },
  { name: 'NextChat', plat: 'Web / PWA', desc_id: 'Ringan, install dari browser', desc_en: 'Lightweight, install from browser', logo: null, icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 12h12l-4-4 1.5-1.5L21 12l-6.5 5.5L13 16l4-4H5z" fill="currentColor"/></svg>' },
  { name: 'OpenChat', plat: 'iOS', desc_id: 'Native iOS, kunci di Keychain', desc_en: 'Native iOS, keys in Keychain', logo: null, icon: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5.1 3.7 6.6-.1 1-.8 3.3-2.7 4.7 2.9-.3 5.3-1.7 6.6-2.8 1.1.3 2.2.4 3.4.4 5.5 0 10-3.9 10-8.7S17.5 3 12 3z" fill="currentColor"/></svg>' },
  { name: 'LibreChat', plat: 'Web', desc_id: 'Self-hosted, mirip ChatGPT', desc_en: 'Self-hosted, ChatGPT-like', logo: 'logos/librechat.svg', icon: null },
  { name: 'Open WebUI', plat: 'Web', desc_id: 'Self-hosted, fitur lengkap', desc_en: 'Self-hosted, full features', logo: 'logos/openwebui.png', icon: null },
];
function renderApps() {
  const grid = document.getElementById('apps-grid');
  if (!grid) return;
  grid.innerHTML = SUPPORTED_APPS.map(a => {
    const ico = a.logo
      ? '<img src="' + a.logo + '" alt="' + a.name + '" class="app-logo">'
      : '<div class="app-ico">' + a.icon + '</div>';
    return '<div class="app-card">' + ico +
    '<div class="app-name">' + a.name + '</div>' +
    '<div class="app-plat">' + a.plat + '</div>' +
    '<div class="app-desc">' + (LANG === 'en' ? a.desc_en : a.desc_id) + '</div>' +
    '</div>';
  }).join('');
}

/* --------------------------- theme (dark/light) ------------------------ */
function applyTheme() {
  const th = localStorage.getItem('hb-theme') || 'light';
  document.documentElement.setAttribute('data-theme', th);
}
document.getElementById('theme-btn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hb-theme', next);
});

/* --------------------------- wallpaper --------------------------------- */
function applyWallpaper() {
  const wp = localStorage.getItem('hb-wallpaper');
  if (wp) {
    document.body.style.backgroundImage = 'url(' + wp + ')';
    document.body.classList.add('has-wallpaper');
  }
}
document.getElementById('wallpaper-btn').addEventListener('click', () => {
  const cur = localStorage.getItem('hb-wallpaper');
  if (cur && confirm(t('wallpaper.remove') || 'Hapus wallpaper?')) {
    localStorage.removeItem('hb-wallpaper');
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-wallpaper');
    return;
  }
  document.getElementById('wallpaper-input').click();
});
/* --------------------------- info modal -------------------------------- */
document.getElementById('info-btn').addEventListener('click', () => {
  document.getElementById('info-modal').classList.remove('hidden');
  closeDrawer();
});
document.getElementById('info-modal-close').addEventListener('click', () => {
  document.getElementById('info-modal').classList.add('hidden');
});
document.getElementById('info-ok').addEventListener('click', () => {
  document.getElementById('info-modal').classList.add('hidden');
});
document.getElementById('info-modal').addEventListener('click', e => {
  if (e.target.id === 'info-modal') e.target.classList.add('hidden');
});

document.getElementById('wallpaper-input').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      localStorage.setItem('hb-wallpaper', r.result);
    } catch (ex) {
      // storage penuh — pakai sesi ini saja
    }
    document.body.style.backgroundImage = 'url(' + r.result + ')';
    document.body.classList.add('has-wallpaper');
  };
  r.readAsDataURL(f);
  e.target.value = '';
});

/* --------------------------- language toggle ID/EN --------------------- */
const I18N = {
  id: {
    'topbar.keys': 'Kunci API',
    'nav.keys': 'Kunci API',
    'nav.providers': 'Provider',
    'nav.users': 'Pengguna',
    'nav.mykeys': 'Key Saya',
    'nav.logout': 'Keluar',
    'nav.account': 'Akun',
    'account.title': 'Akun',
    'account.duration': 'Tambahan Durasi',
    'account.viaBot': 'Pembayaran melalui Bot Telegram',
    'qris.note': 'Scan QRIS di atas sesuai nominal, lalu kirim bukti pembayaran ke Bot Telegram.',
    'qris.sendProof': 'Kirim Bukti ke Bot',
    'hero.keys': 'Kunci API',
    'hero.keys.sub': 'Satu provider = satu API key. Kuota mengikuti provider masing-masing.',
    'hero.providers': 'Provider',
    'hero.providers.sub': 'Sambungkan AI provider yang kompatibel dengan OpenAI API.',
    'hero.mykeys': 'Key Saya',
    'hero.mykeys.sub': 'Buat API key sendiri, tanpa batasan jumlah.',
    'hero.users': 'Pengguna',
    'hero.users.sub': 'Akun pengguna yang mendaftar sendiri lewat halaman Daftar.',
    'btn.addkey': 'Tambah key',
    'btn.createkey': 'Buat Key',
    'nav.theme': 'Gelap/Terang',
    'nav.wallpaper': 'Wallpaper',
    'wallpaper.remove': 'Hapus wallpaper?',
    'nav.info': 'Informasi',
    'info.title': 'Informasi',
    'info.p1': 'Web ini masih dalam <strong>masa uji coba</strong>. Saya membangunnya dengan sepenuh hati, berharap bisa bermanfaat dan memudahkan kalian semua.',
    'info.p2': 'Jika kalian menemukan <strong>error, bug, atau kendala apapun</strong> saat menggunakannya — dari lubuk hati yang paling dalam, saya memohon maaf yang sebesar-besarnya. Setiap saran dan kritik dari kalian adalah hadiah berharga yang akan saya perbaiki dengan secepat dan sebaik mungkin.',
    'info.p3': 'Terima kasih atas <strong>pengertian, kesabaran, dan kepercayaan</strong> kalian. Kehadiran kalian adalah semangat terbesar saya untuk terus berkarya.',
    'info.sign': '— Tim Hestia Bridge',
    'btn.understand': 'Mengerti',
    'nav.home': 'Beranda',
    'home.title': 'Selamat datang di Hestia Bridge',
    'home.sub': 'Sambungkan API key kamu ke aplikasi AI favoritmu. Satu key, banyak aplikasi.',
    'home.cta': 'Lihat Key Saya',
    'home.apps.title': 'Aplikasi yang support',
    'home.apps.sub': 'Aplikasi-aplikasi ini bisa disambungkan ke Hestia Bridge lewat custom endpoint.',
    'home.how.title': 'Cara menyambungkan',
    'home.how.s1': 'Buat API key di halaman <strong>Key Saya</strong> atau <strong>Kunci API</strong>.',
    'home.how.s2': 'Buka aplikasi AI pilihanmu, cari pengaturan <strong>custom endpoint</strong> / <strong>BYOK</strong>.',
    'home.how.s3': 'Isi <strong>Base URL</strong> dengan alamat Bridge dan <strong>API Key</strong> dengan key <code>hb-...</code> milikmu.',
    'btn.createworker': 'Buat Worker',
    'btn.copy': 'Salin',
    'btn.copy.instructions': 'Salin instruksi',
    'btn.done': 'Selesai',
    'btn.save': 'Simpan',
    'lang.switch': 'Ganti bahasa',
    'aria.close': 'Tutup',
    'auth.tagline': 'Kelola API key AI kamu dari satu dashboard.',
    'auth.tab.login': 'Masuk',
    'auth.tab.register': 'Daftar',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.login.submit': 'Masuk',
    'auth.reg.email': 'Email (Gmail)',
    'auth.reg.password': 'Password (min 6 karakter)',
    'auth.reg.password.ph': 'Min 6 karakter',
    'auth.reg.submit': 'Daftar',
    'auth.reg.note': 'Hanya Gmail yang bisa daftar. Satu perangkat maksimal 3 akun.',
    'auth.example': 'contoh pakai',
    'auth.suspended': 'Akun dibuat, tapi langsung di-suspend (batas 3 akun per perangkat). Hubungi admin.',
    'section.mykeys.title': 'Key saya',
    'section.providers.title': 'Daftar provider',
    'section.workers.title': 'Worker Saya',
    'page.workers.desc': 'Daftarkan worker dari akun AI milikmu — key mode worker milikmu dijawab worker ini secara otomatis.',
    'guide.howto.title': 'Cara pakai',
    'guide.howto.s1': 'Buka halaman <strong>Provider</strong> lewat menu, tempel <strong>Base URL</strong> + <strong>API key</strong> provider AI kamu, lalu simpan — koneksi langsung divalidasi.',
    'guide.howto.s2': 'Klik <strong>+ Tambah key</strong> di atas — satu API key <code>hb-...</code> langsung dibuat dan terikat ke satu provider.',
    'guide.howto.s3': 'Di aplikasi AI di HP yang mendukung custom endpoint OpenAI: isi <strong>Base URL</strong> dengan<br><code id="guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>dan <strong>API Key</strong> dengan key <code>hb-...</code> yang baru dibuat (klik <strong>Cara sambung</strong> di kartu key untuk salin cepat), lalu pakai seperti biasa lewat prompt.',
    'guide.howto.s4': 'Pantau pemakaian tiap key di dashboard ini — jumlah request dan token tercatat otomatis.',
    'guide.test.title': 'Cara tes worker',
    'guide.test.s1': 'Pastikan worker kamu <strong>online</strong> di bagian <strong>Worker Saya</strong> di atas.',
    'guide.test.s2': 'Klik <strong>Buat Key</strong>, pilih mode <strong>Worker</strong>, lalu <strong>Buat Key</strong>.',
    'guide.test.s3': 'Klik <strong>Cara sambung</strong> di kartu key, salin <strong>Base URL</strong> dan <strong>API Key</strong> ke aplikasi AI di HP, lalu chat seperti biasa.',
    'guide.test.s4': 'Kalau ada jawaban, berarti worker kamu jalan. Kalau tidak dijawab, cek lagi worker-nya online atau tidak.',
    'guide.my.s1': 'Klik <strong>Buat Key</strong> — pilih mode <strong>Provider</strong> (pakai provider yang tersedia) atau <strong>Worker</strong> (dijawab worker AI).',
    'guide.my.s2': 'Untuk mode Worker: buat dulu worker di bagian <strong>Worker Saya</strong>, salin tokennya, lalu tempel instruksi yang diberikan ke akun AI milikmu supaya ia bekerja otomatis tiap 30 detik.',
    'guide.my.s3': 'Di aplikasi AI di HP yang mendukung custom endpoint OpenAI: isi <strong>Base URL</strong> dengan<br><code id="my-guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>dan <strong>API Key</strong> dengan key <code>hb-...</code> milikmu (klik <strong>Cara sambung</strong> di kartu key untuk salin cepat), lalu pakai seperti biasa lewat prompt.',
    'form.name': 'Nama',
    'form.name.ph': 'cth: Provider A',
    'form.apikey': 'API Key',
    'form.baseurl': 'Base URL',
    'form.keyname': 'Nama key',
    'form.keyname.ph': 'cth: Key HP',
    'form.provider': 'Provider',
    'form.quota': 'Kuota token (opsional)',
    'form.quota.ph': 'cth: 1000000 (kosongkan = tanpa batas)',
    'form.newname': 'Nama baru',
    'form.mode': 'Mode',
    'form.mode.provider': 'Provider — dijawab provider AI',
    'form.mode.worker': 'Worker — dijawab worker milikmu',
    'form.worker': 'Worker',
    'form.workername': 'Nama worker',
    'form.workername.ph': 'cth: Worker HP',
    'form.provider.submit': 'Simpan & Validasi',
    'form.provider.validating': 'Memvalidasi...',
    'form.provider.note': 'Saat disimpan, Hestia Bridge memanggil <code>GET {baseUrl}/models</code> untuk memvalidasi koneksi.',
    'modal.key.title': 'Buat API Key Baru',
    'modal.key.once': 'Key hanya ditampilkan sekali. Salin sekarang.',
    'modal.connect.title': 'Cara sambung',
    'modal.connect.desc': 'Isi dua kolom ini di aplikasi AI di HP, lalu pakai lewat prompt seperti biasa.',
    'modal.rename.title': 'Ganti nama key',
    'modal.mykey.title': 'Buat API Key',
    'modal.myworker.title': 'Buat Worker',
    'modal.myworker.once': 'Token worker hanya ditampilkan sekali. Salin sekarang, lalu tempel instruksi di bawah ke akun AI milikmu.',
    'modal.myworker.instr': 'instruksi worker — tempel ke akun AI',
    'stat.total': 'Total key',
    'stat.active': 'Aktif',
    'stat.requests': 'Request',
    'stat.limited': 'Limit habis',
    'card.active': 'AKTIF',
    'card.disabled': 'NONAKTIF',
    'card.provider': 'Provider',
    'card.request': 'Request',
    'card.tokens.in': 'Token masuk',
    'card.tokens.out': 'Token keluar',
    'card.tokens.total': 'Total token',
    'card.quota': 'Kuota',
    'card.remaining': 'Sisa',
    'card.worker': 'Worker',
    'card.worker.status': 'Status worker',
    'card.online': 'online',
    'card.offline': 'offline',
    'card.created': 'dibuat',
    'card.lastused': 'terakhir dipakai',
    'card.added': 'Ditambah',
    'card.models': 'model',
    'card.keys': 'Key',
    'card.registered': 'Daftar',
    'card.heartbeat': 'Heartbeat terakhir',
    'btn.activate': 'aktifkan',
    'btn.deactivate': 'nonaktifkan',
    'btn.connect': 'Cara sambung',
    'btn.edit': 'edit',
    'btn.rotate': 'rotate',
    'btn.reset': 'reset pakai',
    'btn.delete': 'hapus',
    'btn.test': 'Test',
    'btn.unsuspend': 'buka suspend',
    'btn.suspend': 'suspend',
    'empty.keys': 'Belum ada key.<br>Klik <strong>+ Tambah key</strong> untuk membuat yang pertama.',
    'empty.mykeys': 'Belum ada key.<br>Klik <strong>Buat Key</strong> untuk membuat yang pertama.',
    'empty.providers': 'Belum ada provider.',
    'empty.workers': 'Belum ada worker.<br>Klik <strong>Buat Worker</strong> untuk mendaftarkan worker dari akun AI milikmu.',
    'empty.users': 'Belum ada pengguna terdaftar.',
    'count.keys': 'key',
    'count.workers': 'worker',
    'badge.admin': 'ADMIN',
    'badge.suspended': 'SUSPENDED',
    'badge.active': 'AKTIF',
    'foot.signedin': 'masuk sebagai',
    'foot.admin': 'admin',
    'time.never': 'belum pernah',
    'time.sec': 'dtk lalu',
    'time.min': 'mnt lalu',
    'time.hour': 'jam lalu',
    'time.day': 'hari lalu',
    'toast.refreshed': 'Diperbarui.',
    'toast.key.deactivated': 'Key dinonaktifkan.',
    'toast.key.reactivated': 'Key aktif lagi.',
    'toast.key.deleted': 'Key dihapus.',
    'toast.saved': 'Disimpan.',
    'toast.key.created': 'Key baru dibuat — salin sekarang.',
    'toast.stats.reset': 'Statistik direset.',
    'toast.base.copied': 'Base URL disalin.',
    'toast.apikey.copied': 'API key disalin.',
    'toast.curl.copied': 'Perintah curl disalin.',
    'toast.key.copied': 'Key disalin.',
    'toast.token.copied': 'Token disalin.',
    'toast.instr.copied': 'Instruksi disalin.',
    'toast.addprovider': 'Tambah provider dulu di halaman Provider.',
    'toast.failed': 'Gagal: ',
    'toast.provider.saved': 'Provider tersimpan dan tervalidasi.',
    'toast.provider.deleted': 'Provider dihapus.',
    'toast.conn.ok': 'Koneksi OK — ',
    'toast.worker.deleted': 'Worker dihapus.',
    'toast.user.suspended': 'Pengguna di-suspend.',
    'toast.user.unsuspended': 'Suspend dibuka.',
    'toast.user.deleted': 'Pengguna dihapus.',
    'confirm.key.deactivate': 'Nonaktifkan key "{name}"? Key tidak bisa dipakai sampai diaktifkan lagi.',
    'confirm.key.delete': 'Hapus key "{name}" permanen?',
    'confirm.key.rotate': 'Buat ulang key ini? Key lama langsung tidak berlaku.',
    'confirm.key.reset': 'Nolkan statistik pemakaian key ini?',
    'confirm.provider.delete': 'Hapus provider ini? Key yang terikat akan di-revoke.',
    'confirm.worker.delete': 'Hapus worker "{name}"? Key yang terikat akan dilepas.',
    'confirm.user.suspend': 'Suspend pengguna ini? Key miliknya ikut ditolak.',
    'confirm.user.delete': 'Hapus pengguna ini permanen? Semua key miliknya ikut terhapus.',
    'opt.no.provider': '(belum ada provider)',
    'opt.no.worker': '(tidak ada worker online)',
    'opt.online': ' (online)',
  },
  en: {
    'topbar.keys': 'API Keys',
    'nav.keys': 'API Keys',
    'nav.providers': 'Providers',
    'nav.users': 'Users',
    'nav.mykeys': 'My Keys',
    'nav.logout': 'Logout',
    'nav.account': 'Account',
    'account.title': 'Account',
    'account.duration': 'Add Duration',
    'account.viaBot': 'Payment via Telegram Bot',
    'qris.note': 'Scan the QRIS above for the exact amount, then send payment proof to the Telegram Bot.',
    'qris.sendProof': 'Send Proof to Bot',
    'hero.keys': 'API Keys',
    'hero.keys.sub': 'One provider = one API key. Quota follows each provider.',
    'hero.providers': 'Providers',
    'hero.providers.sub': 'Connect AI providers compatible with OpenAI API.',
    'hero.mykeys': 'My Keys',
    'hero.mykeys.sub': 'Create your own API keys, no limit.',
    'hero.users': 'Users',
    'hero.users.sub': 'User accounts registered via the Sign Up page.',
    'btn.addkey': 'Add key',
    'btn.createkey': 'Create Key',
    'nav.theme': 'Dark/Light',
    'nav.wallpaper': 'Wallpaper',
    'wallpaper.remove': 'Remove wallpaper?',
    'nav.info': 'Information',
    'info.title': 'Information',
    'info.p1': 'This web is still in its <strong>trial period</strong>. I built it wholeheartedly, hoping it will be useful and make things easier for all of you.',
    'info.p2': 'If you encounter any <strong>errors, bugs, or issues</strong> while using it — from the bottom of my heart, I sincerely apologize. Every suggestion and criticism from you is a precious gift that I will address as quickly and as best I can.',
    'info.p3': 'Thank you for your <strong>understanding, patience, and trust</strong>. Your presence is my greatest motivation to keep creating.',
    'info.sign': '— Hestia Bridge Team',
    'btn.understand': 'Understood',
    'nav.home': 'Home',
    'home.title': 'Welcome to Hestia Bridge',
    'home.sub': 'Connect your API key to your favorite AI apps. One key, many apps.',
    'home.cta': 'View My Keys',
    'home.apps.title': 'Supported apps',
    'home.apps.sub': 'These apps can connect to Hestia Bridge via custom endpoint.',
    'home.how.title': 'How to connect',
    'home.how.s1': 'Create an API key on the <strong>My Keys</strong> or <strong>API Keys</strong> page.',
    'home.how.s2': 'Open your chosen AI app, find <strong>custom endpoint</strong> / <strong>BYOK</strong> settings.',
    'home.how.s3': 'Fill <strong>Base URL</strong> with the Bridge address and <strong>API Key</strong> with your <code>hb-...</code> key.',
    'btn.createworker': 'Create Worker',
    'btn.copy': 'Copy',
    'btn.copy.instructions': 'Copy instructions',
    'btn.done': 'Done',
    'btn.save': 'Save',
    'lang.switch': 'Switch language',
    'aria.close': 'Close',
    'auth.tagline': 'Manage your AI API keys from one dashboard.',
    'auth.tab.login': 'Login',
    'auth.tab.register': 'Sign up',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.login.submit': 'Login',
    'auth.reg.email': 'Email (Gmail)',
    'auth.reg.password': 'Password (min 6 characters)',
    'auth.reg.password.ph': 'Min 6 characters',
    'auth.reg.submit': 'Sign up',
    'auth.reg.note': 'Only Gmail can register. Max 3 accounts per device.',
    'auth.example': 'usage example',
    'auth.suspended': 'Account created, but immediately suspended (3 accounts per device limit). Contact admin.',
    'section.mykeys.title': 'My keys',
    'section.providers.title': 'Provider list',
    'section.workers.title': 'My Workers',
    'page.workers.desc': 'Register a worker from your AI account — your worker-mode keys are answered automatically by this worker.',
    'guide.howto.title': 'How to use',
    'guide.howto.s1': 'Open the <strong>Providers</strong> page from the menu, paste your AI provider\'s <strong>Base URL</strong> + <strong>API key</strong>, then save — the connection is validated immediately.',
    'guide.howto.s2': 'Click <strong>+ Add key</strong> above — one <code>hb-...</code> API key is created and bound to one provider.',
    'guide.howto.s3': 'In an AI app on your phone that supports custom OpenAI endpoints: fill <strong>Base URL</strong> with<br><code id="guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>and <strong>API Key</strong> with your new <code>hb-...</code> key (click <strong>How to connect</strong> on the key card for quick copy), then use it via prompt as usual.',
    'guide.howto.s4': 'Monitor each key\'s usage on this dashboard — request and token counts are recorded automatically.',
    'guide.test.title': 'How to test your worker',
    'guide.test.s1': 'Make sure your worker is <strong>online</strong> in the <strong>My Workers</strong> section above.',
    'guide.test.s2': 'Click <strong>Create Key</strong>, choose <strong>Worker</strong> mode, then <strong>Create Key</strong>.',
    'guide.test.s3': 'Click <strong>How to connect</strong> on the key card, copy the <strong>Base URL</strong> and <strong>API Key</strong> into the AI app on your phone, then chat as usual.',
    'guide.test.s4': 'If you get an answer, your worker is running. If not, check whether your worker is online.',
    'guide.my.s1': 'Click <strong>Create Key</strong> — choose <strong>Provider</strong> mode (use an available provider) or <strong>Worker</strong> (answered by an AI worker).',
    'guide.my.s2': 'For Worker mode: first create a worker in the <strong>My Workers</strong> section, copy its token, then paste the given instructions into your AI account so it works automatically every 30 seconds.',
    'guide.my.s3': 'In an AI app on your phone that supports custom OpenAI endpoints: fill <strong>Base URL</strong> with<br><code id="my-guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>and <strong>API Key</strong> with your <code>hb-...</code> key (click <strong>How to connect</strong> on the key card for quick copy), then use it via prompt as usual.',
    'form.name': 'Name',
    'form.name.ph': 'e.g.: Provider A',
    'form.apikey': 'API Key',
    'form.baseurl': 'Base URL',
    'form.keyname': 'Key name',
    'form.keyname.ph': 'e.g.: Phone Key',
    'form.provider': 'Provider',
    'form.quota': 'Token quota (optional)',
    'form.quota.ph': 'e.g.: 1000000 (leave empty = unlimited)',
    'form.newname': 'New name',
    'form.mode': 'Mode',
    'form.mode.provider': 'Provider — answered by AI provider',
    'form.mode.worker': 'Worker — answered by your worker',
    'form.worker': 'Worker',
    'form.workername': 'Worker name',
    'form.workername.ph': 'e.g.: Phone Worker',
    'form.provider.submit': 'Save & Validate',
    'form.provider.validating': 'Validating...',
    'form.provider.note': 'On save, Hestia Bridge calls <code>GET {baseUrl}/models</code> to validate the connection.',
    'modal.key.title': 'Create New API Key',
    'modal.key.once': 'Key is shown only once. Copy it now.',
    'modal.connect.title': 'How to connect',
    'modal.connect.desc': 'Fill these two fields in the AI app on your phone, then use it via prompt as usual.',
    'modal.rename.title': 'Rename key',
    'modal.mykey.title': 'Create API Key',
    'modal.myworker.title': 'Create Worker',
    'modal.myworker.once': 'Worker token is shown only once. Copy it now, then paste the instructions below into your AI account.',
    'modal.myworker.instr': 'worker instructions — paste into your AI account',
    'stat.total': 'Total keys',
    'stat.active': 'Active',
    'stat.requests': 'Requests',
    'stat.limited': 'Quota exhausted',
    'card.active': 'ACTIVE',
    'card.disabled': 'DISABLED',
    'card.provider': 'Provider',
    'card.request': 'Request',
    'card.tokens.in': 'Input tokens',
    'card.tokens.out': 'Output tokens',
    'card.tokens.total': 'Total tokens',
    'card.quota': 'Quota',
    'card.remaining': 'Remaining',
    'card.worker': 'Worker',
    'card.worker.status': 'Worker status',
    'card.online': 'online',
    'card.offline': 'offline',
    'card.created': 'created',
    'card.lastused': 'last used',
    'card.added': 'Added',
    'card.models': 'models',
    'card.keys': 'Keys',
    'card.registered': 'Registered',
    'card.heartbeat': 'Last heartbeat',
    'btn.activate': 'activate',
    'btn.deactivate': 'deactivate',
    'btn.connect': 'How to connect',
    'btn.edit': 'edit',
    'btn.rotate': 'rotate',
    'btn.reset': 'reset usage',
    'btn.delete': 'delete',
    'btn.test': 'Test',
    'btn.unsuspend': 'unsuspend',
    'btn.suspend': 'suspend',
    'empty.keys': 'No keys yet.<br>Click <strong>+ Add key</strong> to create your first.',
    'empty.mykeys': 'No keys yet.<br>Click <strong>Create Key</strong> to create your first.',
    'empty.providers': 'No providers yet.',
    'empty.workers': 'No workers yet.<br>Click <strong>Create Worker</strong> to register a worker from your AI account.',
    'empty.users': 'No registered users yet.',
    'count.keys': 'keys',
    'count.workers': 'workers',
    'badge.admin': 'ADMIN',
    'badge.suspended': 'SUSPENDED',
    'badge.active': 'ACTIVE',
    'foot.signedin': 'signed in as',
    'foot.admin': 'admin',
    'time.never': 'never',
    'time.sec': ' sec ago',
    'time.min': ' min ago',
    'time.hour': ' hr ago',
    'time.day': ' days ago',
    'toast.refreshed': 'Refreshed.',
    'toast.key.deactivated': 'Key deactivated.',
    'toast.key.reactivated': 'Key reactivated.',
    'toast.key.deleted': 'Key deleted.',
    'toast.saved': 'Saved.',
    'toast.key.created': 'New key created — copy it now.',
    'toast.stats.reset': 'Statistics reset.',
    'toast.base.copied': 'Base URL copied.',
    'toast.apikey.copied': 'API key copied.',
    'toast.curl.copied': 'Curl command copied.',
    'toast.key.copied': 'Key copied.',
    'toast.token.copied': 'Token copied.',
    'toast.instr.copied': 'Instructions copied.',
    'toast.addprovider': 'Add a provider first on the Providers page.',
    'toast.failed': 'Failed: ',
    'toast.provider.saved': 'Provider saved and validated.',
    'toast.provider.deleted': 'Provider deleted.',
    'toast.conn.ok': 'Connection OK — ',
    'toast.worker.deleted': 'Worker deleted.',
    'toast.user.suspended': 'User suspended.',
    'toast.user.unsuspended': 'Suspension lifted.',
    'toast.user.deleted': 'User deleted.',
    'confirm.key.deactivate': 'Deactivate key "{name}"? The key cannot be used until reactivated.',
    'confirm.key.delete': 'Permanently delete key "{name}"?',
    'confirm.key.rotate': 'Regenerate this key? The old key stops working immediately.',
    'confirm.key.reset': 'Reset usage statistics for this key?',
    'confirm.provider.delete': 'Delete this provider? Bound keys will be revoked.',
    'confirm.worker.delete': 'Delete worker "{name}"? Bound keys will be unlinked.',
    'confirm.user.suspend': 'Suspend this user? Their keys will be rejected.',
    'confirm.user.delete': 'Permanently delete this user? All their keys will be deleted too.',
    'opt.no.provider': '(no providers yet)',
    'opt.no.worker': '(no online workers)',
    'opt.online': ' (online)',
  }
};
let LANG = localStorage.getItem('hb-lang') || 'id';
function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) || I18N.id[key] || key;
}
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const k = el.getAttribute('data-i18n-html');
    el.innerHTML = t(k);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.getAttribute('data-i18n-ph');
    el.placeholder = t(k);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const k = el.getAttribute('data-i18n-aria');
    el.setAttribute('aria-label', t(k));
  });
  const lbl = document.getElementById('lang-label');
  if (lbl) lbl.textContent = LANG.toUpperCase();
  document.documentElement.lang = LANG;
  localStorage.setItem('hb-lang', LANG);
}
document.getElementById('lang-btn').addEventListener('click', () => {
  LANG = LANG === 'id' ? 'en' : 'id';
  applyLang();
  renderApps();
  const gb = $('#guide-base-url');
  if (gb) gb.textContent = BRIDGE_BASE;
  const mgb = $('#my-guide-base-url');
  if (mgb) mgb.textContent = BRIDGE_BASE;
  if (typeof refreshAll === 'function') refreshAll();
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
  applyLang();
  applyTheme();
  applyWallpaper();
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
