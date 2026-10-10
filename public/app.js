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
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (r.status === 401) { showAuth(); throw new Error('auth'); }
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-json */ }
  if (!r.ok) throw new Error((j && (j.error || j.msg)) || ('HTTP ' + r.status));
  return j;
}

function toast(msg, ok) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('success', !!ok);
  t.classList.toggle('error', !ok);
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
  renderApps();
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
  const _hcta = $('#home-cta'); if (_hcta) _hcta.onclick = () => switchView(isAdmin ? 'keys' : 'mykeys');
  if (!isAdmin) loadPlan(); else { $('#plan-card').hidden = true; if (planTimer) clearInterval(planTimer); }
}

/* Fingerprint perangkat sederhana untuk batas 1 akun per device. */
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
/* landing nav: switch tab + scroll to form */
function gotoAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  const isLogin = tab === 'login';
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
  const sec = $('#auth-form-section');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const _nlb = $('#nav-login-btn'); if (_nlb) _nlb.addEventListener('click', () => gotoAuthTab('login'));
const _nrb = $('#nav-register-btn'); if (_nrb) _nrb.addEventListener('click', () => gotoAuthTab('register'));
$('#hero-cta').addEventListener('click', () => gotoAuthTab('register'));
$('#hero-guide-btn').addEventListener('click', () => {
  const g = $('#landing-guide');
  if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const _lba = $('#lang-btn-auth'); if (_lba) _lba.addEventListener('click', () => $('#lang-btn').click());
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error');
  err.classList.add('hidden');
  const btn = $('#login-form button[type="submit"]');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
    });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && j.error) || 'Login gagal.');
    $('#login-password').value = '';
    enterApp(j);
  } catch (ex) {
    btn.classList.remove('loading'); btn.disabled = false;
    const msg = ex.message;
    err.textContent = msg;
    err.classList.remove('hidden');
    toast(msg, false);
    const pw = $('#login-password');
    pw.value = '';
    pw.blur();
    return;
  }
  btn.classList.remove('loading'); btn.disabled = false;
});
/* --------------------------- Page loader --------------------------------- */
window.addEventListener('load', () => {
  setTimeout(() => $('#page-loader').classList.add('hide'), 300);
});
// Fallback: sembunyikan juga setelah DOM siap jika load lambat
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => $('#page-loader').classList.add('hide'), 2500);
});

/* --------------------------- Forgot password ----------------------------- */
const forgotModal = $('#forgot-modal');
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'forgot-link') {
    e.preventDefault();
    $('#forgot-step1').classList.remove('hidden');
    $('#forgot-step2').classList.add('hidden');
    $('#forgot-step3').classList.add('hidden');
    $('#forgot-error').classList.add('hidden');
    $('#forgot-error2').classList.add('hidden');
    forgotModal.classList.remove('hidden');
  }
});
$('#forgot-modal-close').addEventListener('click', () => forgotModal.classList.add('hidden'));
forgotModal.addEventListener('click', e => {
  if (e.target.id === 'forgot-modal') forgotModal.classList.add('hidden');
});
$('#forgot-ok').addEventListener('click', () => forgotModal.classList.add('hidden'));

let forgotCooldown = null;
$('#forgot-send').addEventListener('click', async () => {
  const email = $('#forgot-email').value.trim();
  const err = $('#forgot-error');
  err.classList.add('hidden');
  if (!email) { err.textContent = 'Isi email dulu.'; err.classList.remove('hidden'); return; }
  const btn = $('#forgot-send');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    $('#forgot-step1').classList.add('hidden');
    $('#forgot-step2').classList.remove('hidden');
    toast(t('auth.forgot.toast'), true);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
  btn.classList.remove('loading');
  btn.disabled = false;
});

$('#forgot-reset').addEventListener('click', async () => {
  const err = $('#forgot-error2');
  err.classList.add('hidden');
  const email = $('#forgot-email').value.trim();
  const code = $('#forgot-otp').value.trim();
  const password = $('#forgot-password').value;
  if (code.length !== 6) { err.textContent = 'Kode harus 6 digit.'; err.classList.remove('hidden'); return; }
  if (!password || password.length < 6) { err.textContent = 'Sandi minimal 6 karakter.'; err.classList.remove('hidden'); return; }
  const btn = $('#forgot-reset');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, password })
    });
    $('#forgot-step2').classList.add('hidden');
    $('#forgot-step3').classList.remove('hidden');
    $('#forgot-otp').value = '';
    $('#forgot-password').value = '';
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
  btn.classList.remove('loading');
  btn.disabled = false;
});

/* --------------------------- TOS checkbox gate --------------------------- */
const regTos = $('#reg-tos');
const regSubmitBtn = $('#reg-submit-btn');
regTos.addEventListener('change', () => {
  regSubmitBtn.disabled = !regTos.checked;
});
regSubmitBtn.disabled = true;

/* --------------------------- OTP flow ------------------------------------ */
let otpVerified = false;
const otpRow = $('#otp-row');
const otpSendBtn = $('#otp-send');
const otpStatus = $('#otp-status');

// Password visibility toggle
document.querySelectorAll('.pw-toggle-inside').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '◎' : '◉';
  });
});

$('#reg-email').addEventListener('input', () => {
  otpVerified = false;
  otpRow.classList.remove('hidden');
  otpStatus.textContent = '';
});

otpSendBtn.addEventListener('click', async () => {
  const email = $('#reg-email').value.trim();
  if (!email) { otpStatus.textContent = t('auth.reg.email') + ' dulu.'; return; }
  otpSendBtn.disabled = true;
  otpSendBtn.classList.add('loading');
  try {
    await api('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) });
    otpSendBtn.classList.remove('loading');
    otpStatus.textContent = t('auth.reg.otp.sent');
    toast(t('auth.reg.otp.toast'), true);
    // Cooldown 30 detik dengan hitung mundur
    let sisa = 30;
    const labelAsli = t('auth.reg.otp.send');
    const timer = setInterval(() => {
      sisa--;
      if (sisa <= 0) {
        clearInterval(timer);
        otpSendBtn.disabled = false;
        otpSendBtn.textContent = labelAsli;
      } else {
        otpSendBtn.textContent = sisa + ' ' + t('auth.reg.otp.wait');
      }
    }, 1000);
    otpSendBtn.textContent = sisa + ' ' + t('auth.reg.otp.wait');
  } catch (ex) {
    otpStatus.textContent = ex.message;
    otpSendBtn.classList.remove('loading');
    otpSendBtn.disabled = false;
  }
});

$('#reg-otp').addEventListener('input', async e => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
  e.target.value = v;
  if (v.length === 6 && !otpVerified) {
    try {
      await api('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: $('#reg-email').value.trim(), code: v })
      });
      otpVerified = true;
      otpStatus.textContent = t('auth.reg.otp.verified');
    } catch (ex) {
      otpStatus.textContent = ex.message;
    }
  }
});

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#reg-error');
  err.classList.add('hidden');
  if (!otpVerified) {
    err.textContent = 'Verifikasi email dulu dengan kode OTP.';
    err.classList.remove('hidden');
    return;
  }
  const pw = $('#reg-password').value;
  const pw2 = $('#reg-password-confirm').value;
  if (pw !== pw2) {
    err.textContent = 'Konfirmasi sandi tidak cocok.';
    err.classList.remove('hidden');
    return;
  }
  regSubmitBtn.classList.add('loading'); regSubmitBtn.disabled = true;
  try {
    const j = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#reg-email').value,
        firstName: $('#reg-firstname').value.trim(),
        lastName: $('#reg-lastname').value.trim(),
        username: $('#reg-username').value.trim(),
        password: pw,
        fingerprint: deviceFingerprint()
      })
    });
    $('#reg-password').value = '';
    $('#reg-otp').value = '';
    otpVerified = false;
    otpRow.classList.add('hidden');
    regTos.checked = false;
    regSubmitBtn.disabled = true;
    if (j.suspended) {
      err.textContent = t('auth.suspended');
      err.classList.remove('hidden');
      return;
    }
    enterApp(j);
  } catch (ex) {
    regSubmitBtn.classList.remove('loading');
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
    return;
  }
  regSubmitBtn.classList.remove('loading');
});
async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  showAuth();
}
$('#logout-btn2').addEventListener('click', doLogout);

/* --------------------------- plan countdown ----------------------------- */
let planTimer = null;
let planData = null;
function fmtCountdown(ms) {
  if (ms <= 0) return LANG === 'en' ? 'Expired' : 'Habis';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return d + 'h ' + h + 'j ' + m + 'm';
  if (h > 0) return h + 'j ' + m + 'm ' + sec + 'd';
  return m + 'm ' + sec + 'd';
}
function renderPlan() {
  const card = $('#plan-card');
  if (!planData || !card) return;
  card.hidden = false;
  const badge = $('#plan-badge');
  badge.textContent = planData.planName || 'Gratis';
  badge.classList.toggle('expired', !!planData.expired);
  const now = Date.now();
  const remain = Math.max(0, (planData.planExpiresAt || 0) - now);
  $('#plan-countdown').textContent = fmtCountdown(remain);
  // progress bar: sisa dibanding total durasi paket
  const totals = { gratis: 864e5, '1hari': 864e5, '3hari': 3 * 864e5, '1minggu': 7 * 864e5 };
  const total = totals[planData.plan] || 864e5;
  const pct = Math.min(100, Math.max(0, (remain / total) * 100));
  $('#plan-bar-fill').style.width = pct + '%';
}
async function loadPlan() {
  try {
    const p = await api('/api/my-plan');
    planData = p;
    renderPlan();
    if (planTimer) clearInterval(planTimer);
    planTimer = setInterval(renderPlan, 1000);
  } catch (e) { /* abaikan */ }
}
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
  '1': { id: '1 Hari', en: '1 Day', price: 'Rp 3.000' },
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
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}
$('#drawer-btn').addEventListener('click', openDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
const VIEW_TITLES = { home: 'nav.home', keys: 'topbar.keys', providers: 'nav.providers', users: 'nav.users', activities: 'nav.activities', mykeys: 'nav.mykeys', myworkers: 'nav.myworkers', settings: 'nav.settings' };
function switchView(name) {
  document.querySelectorAll('.drawer-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $('.topbar-title').textContent = t(VIEW_TITLES[name] || 'topbar.keys');
  closeDrawer();
  if (name === 'users') loadUsers();
  if (name === 'activities') loadActivities(true);
  if (name === 'settings') loadMySettings();
  if (name === 'myworkers') { loadMyWorkers(); refreshWorkerAgentCard(); }
}
document.querySelectorAll('.drawer-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
$('#refresh-btn').addEventListener('click', async () => { await refreshAll(); toast(t('toast.refreshed')); });
$('#my-refresh-btn').addEventListener('click', async () => { await refreshMine(); toast(t('toast.refreshed')); });
$('#users-refresh-btn').addEventListener('click', async () => { await loadUsers(); toast(t('toast.refreshed')); });
$('#activities-refresh-btn').addEventListener('click', async () => { await loadActivities(true); toast(t('toast.refreshed')); });

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
      (k.model ? '<div class="row"><span class="k">' + t('card.model') + '</span><span class="v">' + esc(k.model) + '</span></div>' : '') +
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
async function openConnectModal(id, apiBase, name, model) {
  connectKeyId = id;
  const j = await api(apiBase + '/' + id + '/reveal');
  $('#connect-base').textContent = BRIDGE_BASE;
  $('#connect-key').textContent = j.token;
  $('#connect-key-name').textContent = name || '';
  let modelId = model || 'model-id';
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
      await openConnectModal(id, '/api/keys', k ? k.name : '', k ? k.model : '');
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
let keyProvidersCache = [];
function fillKeyModels() {
  const pid = $('#key-provider').value;
  const p = keyProvidersCache.find(x => x.id === pid);
  const models = (p && p.models) || [];
  $('#key-model').innerHTML = models.length
    ? models.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('')
    : '<option value="">' + t('opt.no.model') + '</option>';
}
$('#key-provider').addEventListener('change', fillKeyModels);
$('#new-key-btn').addEventListener('click', async () => {
  $('#key-form').classList.remove('hidden');
  $('#key-result').classList.add('hidden');
  $('#key-error').classList.add('hidden');
  try {
    const j = await api('/api/providers');
    if (!j.providers.length) { toast(t('toast.addprovider')); return; }
    keyProvidersCache = j.providers;
    $('#key-provider').innerHTML = j.providers.map(p =>
      '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.modelCount + ' ' + t('card.models') + ')</option>').join('');
    fillKeyModels();
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
      body: JSON.stringify({ name: $('#key-name').value, providerId: $('#key-provider').value, model: $('#key-model').value || null, tokenQuota: qv > 0 ? qv : null })
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
  // Cek kesehatan provider (khusus admin).
  try {
    const h = await api('/api/admin/provider-health');
    const box = $('#provider-health-alert');
    const bad = (h.providers || []).filter(p => !p.healthy);
    if (bad.length && box) {
      box.innerHTML = bad.map(p =>
        '<div class="alert alert-warn">⚠ Provider <b>' + esc(p.name) + '</b> bermasalah: ' +
        esc(p.lastError || ('HTTP ' + p.lastStatus)) +
        (p.lastAt ? ' <span class="muted">(' + esc(p.lastAt) + ')</span>' : '') + '</div>'
      ).join('');
    } else if (box) {
      box.innerHTML = '';
    }
  } catch (e) { /* abaikan */ }
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
  const via = k.mode === 'worker' ? esc(k.workerName || '-') : '';
  return '<div class="key-card">' +
    '<div class="key-top">' +
      '<span class="key-dot' + (k.revoked ? ' off' : '') + '"></span>' +
      '<span class="key-name">' + esc(k.name) + '</span>' +
      (k.mode === 'worker' ? '<span class="badge on">WORKER</span>' : '') +
    '</div>' +
    '<div><span class="key-masked">' + esc(k.masked) + '</span></div>' +
    '<div class="key-info">' +
      (k.mode === 'worker' ? '<div class="row"><span class="k">' + t('card.worker') + '</span><span class="v">' + via + '</span></div>' : '') +
      (k.mode === 'worker' ? '<div class="row"><span class="k">' + t('card.worker.status') + '</span><span class="v">' + (k.workerOnline ? t('card.online') : t('card.offline')) + '</span></div>' : '') +
      (k.mode === 'provider' && k.supportedModels && k.supportedModels.length
        ? '<div class="row"><span class="k">' + t('card.supportedmodels') + '</span></div><div class="model-list">' +
          k.supportedModels.map(m => {
            const meta = (k.modelMeta && k.modelMeta[m]) || {};
            const caps = (meta.caps || []).map(c => '<span class="cap-tag">' + esc(c) + '</span>').join('');
            return '<div class="model-item">' +
              '<div class="model-item-top"><span class="model-dot"></span>' +
              '<span class="model-name">' + esc(m) + '</span>' +
              '<button class="icon-btn model-copy" data-model="' + esc(m) + '" title="' + t('card.copymodel') + '" aria-label="' + t('card.copymodel') + '">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>' +
              '</button>' +
              '<span class="model-avail">' + t('card.available') + '</span></div>' +
              (caps ? '<div class="model-caps">' + caps + '</div>' : '') +
              (meta.context ? '<div class="model-ctx">' + esc(meta.context) + '</div>' : '') +
              (meta.popular ? '<div class="model-pop">★ ' + t('card.popular') + '</div>' : '') +
            '</div>';
          }).join('') + '</div>'
        : '') +
    '</div>' +
    '<div class="key-actions">' +
      '<button class="btn btn-sm btn-primary" data-act="connect" data-id="' + k.id + '">' + t('btn.connect') + '</button>' +
      '' +
      '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + k.id + '">' + t('btn.delete') + '</button>' +
    '</div>' +
    '<div class="key-meta">' + t('card.created') + ' ' + fmtDate(k.createdAt) + ' · ' + t('card.lastused') + ' ' + timeAgo(k.lastUsedAt) + '</div>' +
  '</div>';
}
$('#mykey-list').addEventListener('click', async e => {
  const copyBtn = e.target.closest('button.model-copy');
  if (copyBtn && copyBtn.dataset.model) {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.model);
      toast(t('toast.model.copied'));
    } catch (ex) { toast(t('toast.failed')); }
    return;
  }
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
      await openConnectModal(id, '/api/my-keys', k ? k.name : '', k ? k.model : '');
    } else if (act === 'editmodel') {
      await openEditModelModal(id);
    }
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});

/* edit model modal (ganti model key yang sudah dibuat) */
async function openEditModelModal(id) {
  const k = myKeysCache.find(x => x.id === id);
  if (!k || k.mode !== 'provider') return;
  try {
    if (!mykeyProvidersCache.length) {
      const j = await api('/api/my-providers');
      mykeyProvidersCache = j.providers || [];
    }
    const p = mykeyProvidersCache.find(x => x.id === k.providerId);
    const models = (p && p.models) || [];
    if (!models.length) { toast(t('toast.failed') + t('opt.no.model')); return; }
    $('#editmodel-keyname').textContent = k.name || '';
    $('#editmodel-model').innerHTML = models.map(m =>
      '<option value="' + esc(m) + '"' + (m === k.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
    $('#editmodel-error').classList.add('hidden');
    $('#editmodel-modal').dataset.id = id;
    $('#editmodel-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
}
$('#editmodel-modal-close').addEventListener('click', () => $('#editmodel-modal').classList.add('hidden'));
$('#editmodel-modal').addEventListener('click', e => {
  if (e.target.id === 'editmodel-modal') $('#editmodel-modal').classList.add('hidden');
});
$('#editmodel-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#editmodel-modal').dataset.id;
  const err = $('#editmodel-error');
  err.classList.add('hidden');
  try {
    await api('/api/my-keys/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ model: $('#editmodel-model').value })
    });
    $('#editmodel-modal').classList.add('hidden');
    toast(t('toast.saved'));
    await loadMyKeys();
  } catch (ex) {
    if (ex.message === 'auth') return;
    err.textContent = t('toast.failed') + ex.message;
    err.classList.remove('hidden');
  }
});

/* my key modal */
let mykeyProvidersCache = [];
function fillMykeyModels() {
  const pid = $('#mykey-provider').value;
  const p = mykeyProvidersCache.find(x => x.id === pid);
  const models = (p && p.models) || [];
  $('#mykey-model').innerHTML = models.length
    ? models.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('')
    : '<option value="">' + t('opt.no.model') + '</option>';
  $('#mykey-model-wrap').classList.toggle('hidden', $('#mykey-mode').value === 'worker');
}
$('#mykey-provider').addEventListener('change', fillMykeyModels);
$('#my-new-key-btn').addEventListener('click', async () => {
  await openMyKeyModal('provider');
});
$('#my-new-workerkey-btn').addEventListener('click', async () => {
  await openMyKeyModal('worker');
});
async function openMyKeyModal(presetMode) {
  $('#mykey-form').classList.remove('hidden');
  $('#mykey-result').classList.add('hidden');
  $('#mykey-error').classList.add('hidden');
  try {
    const [p, w] = await Promise.all([api('/api/my-providers'), api('/api/my-workers/available')]);
    mykeyProvidersCache = p.providers;
    $('#mykey-provider').innerHTML = p.providers.length
      ? p.providers.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('')
      : '<option value="">' + t('opt.no.provider') + '</option>';
    const wonline = w.workers.filter(x => x.online);
    $('#mykey-worker').innerHTML = wonline.length
      ? wonline.map(x => '<option value="' + x.id + '">' + esc(x.name) + t('opt.online') + '</option>').join('')
      : '<option value="">' + t('opt.no.worker') + '</option>';
    const mode = presetMode || 'provider';
    $('#mykey-mode').value = mode;
    onMyKeyModeChange(mode);
    $('#mykey-modal').classList.remove('hidden');
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
}
function onMyKeyModeChange(mode) {
  const isWorker = mode === 'worker';
  // Mode selector disembunyikan — ditentukan dari tombol asal (gateway vs worker)
  $('#mykey-mode-wrap').classList.add('hidden');
  // Gateway: tanpa pilih provider/model (pakai default dari Hestia)
  // Worker: pilih worker saja
  $('#mykey-provider-wrap').classList.add('hidden');
  $('#mykey-model-wrap').classList.add('hidden');
  $('#mykey-worker-wrap').classList.toggle('hidden', !isWorker);
}
$('#mykey-mode').addEventListener('change', () => {
  onMyKeyModeChange($('#mykey-mode').value);
});
$('#mykey-modal-close').addEventListener('click', () => $('#mykey-modal').classList.add('hidden'));
$('#mykey-done').addEventListener('click', () => { $('#mykey-modal').classList.add('hidden'); loadMyKeys(); });
$('#mykey-modal').addEventListener('click', e => {
  if (e.target.id === 'mykey-modal') $('#mykey-modal').classList.add('hidden');
});

/* ------------------- user settings: BYOK provider sendiri ------------------ */
let mysetModelsCache = [];
function fillMysetModels(selected) {
  const sel = $('#myset-model');
  sel.innerHTML = mysetModelsCache.length
    ? mysetModelsCache.map(m => '<option value="' + esc(m) + '"' + (m === selected ? ' selected' : '') + '>' + esc(m) + '</option>').join('')
    : '<option value="">' + t('opt.checkfirst') + '</option>';
  sel.disabled = !mysetModelsCache.length;
}
async function loadMySettings() {
  const err = $('#myset-error');
  if (err) err.classList.add('hidden');
  $('#myset-ok').classList.add('hidden');
  try {
    const s = await api('/api/my-provider');
    if (s.configured) {
      $('#myset-base').value = s.baseUrl || '';
      $('#myset-key').value = '';
      $('#myset-key').placeholder = t('form.settings.keyset') + ' (' + (s.keyMasked || '') + ')';
      mysetModelsCache = s.models || [];
      fillMysetModels(s.model || (mysetModelsCache[0] || ''));
      $('#myset-ok').textContent = t('settings.configured');
      $('#myset-ok').classList.remove('hidden');
      $('#myset-delete').classList.remove('hidden');
    } else {
      $('#myset-base').value = '';
      $('#myset-key').value = '';
      $('#myset-key').placeholder = 'sk-...';
      mysetModelsCache = [];
      fillMysetModels('');
      $('#myset-delete').classList.add('hidden');
    }
  } catch (e) { if (e.message !== 'auth') toast(t('toast.failed') + e.message); }
}
$('#myset-check').addEventListener('click', async () => {
  const err = $('#myset-error');
  err.classList.add('hidden');
  const btn = $('#myset-check');
  btn.disabled = true;
  try {
    const r = await api('/api/my-provider/check', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: $('#myset-base').value.trim(), apiKey: $('#myset-key').value })
    });
    if (!r.ok) throw new Error(r.error || 'check failed');
    mysetModelsCache = r.models || [];
    fillMysetModels(mysetModelsCache[0] || '');
    toast(t('settings.checkok'), true);
  } catch (e) {
    mysetModelsCache = [];
    fillMysetModels('');
    err.textContent = e.message;
    err.classList.remove('hidden');
  } finally { btn.disabled = false; }
});
$('#mysettings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#myset-error');
  err.classList.add('hidden');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/my-provider', {
      method: 'POST',
      body: JSON.stringify({
        baseUrl: $('#myset-base').value.trim(),
        apiKey: $('#myset-key').value, // boleh kosong = pakai key yang tersimpan
        model: $('#myset-model').value || null
      })
    });
    $('#myset-key').value = '';
    await loadMySettings();
    toast(t('settings.saved'), true);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally { btn.disabled = false; }
});
$('#myset-delete').addEventListener('click', async () => {
  if (!confirm(t('settings.confirmdelete'))) return;
  try {
    await api('/api/my-provider', { method: 'DELETE' });
    toast(t('settings.deleted'), true);
    await loadMySettings();
  } catch (e) { toast(t('toast.failed') + e.message); }
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
    if (mode === 'worker') {
      body.workerId = $('#mykey-worker').value;
    }
    // Gateway: providerId/model tidak dikirim — backend pakai default (model jualan Hestia).
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
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act !== 'del') return;
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
/* ---- worker view: refresh + agent card ---- */
const _mwr = $('#myworkers-refresh-btn');
if (_mwr) _mwr.addEventListener('click', async () => { await loadMyWorkers(); await refreshWorkerAgentCard(); toast(t('toast.refreshed')); });
const _wao = $('#worker-agent-open-btn');
if (_wao) _wao.addEventListener('click', () => switchView('settings'));
async function refreshWorkerAgentCard() {
  const el = $('#worker-agent-status');
  if (!el) return;
  try {
    const s = await api('/api/my-provider');
    if (s.configured) {
      el.innerHTML = '<strong>' + esc(s.baseUrl || '') + '</strong>' +
        (s.model ? ' · <span class="muted">' + esc(s.model) + '</span>' : '');
    } else {
      el.innerHTML = '<span class="muted">' + t('worker.agent.notset') + '</span>';
    }
  } catch (e) { el.innerHTML = ''; }
}
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
      ? 'You are a Hestia Bridge Worker. Your task is real, not a simulation. Follow these steps exactly, keep the loop running forever:\n' +
      '\n' +
      'MANDATORY RULES:\n' +
      '- You MUST send real HTTP requests for every step. Making up results is forbidden.\n' +
      '- After each step, report the actual HTTP status code you received (e.g. 200, 404, 503).\n' +
      '- If you cannot send HTTP requests, say honestly "I cannot send HTTP requests" — do not pretend.\n' +
      '- Do not invent stories about revoked tokens, quotas, or anything you did not verify via a real request.\n' +
      '\n' +
      'STEP 1 — HEARTBEAT (sign you are alive):\n' +
      'POST to ' + _base + '/v1/worker/heartbeat\n' +
      'Header: Authorization: Bearer ' + j.token + '\n' +
      'Report the status you received.\n' +
      '\n' +
      'STEP 2 — WAIT FOR WORK (long-poll, instant):\n' +
      'GET ' + _base + '/v1/worker/pending?wait=45\n' +
      '(same header as above)\n' +
      'This request stays open up to 45 seconds and returns INSTANTLY when a chat arrives. Do NOT wait manually — just call it again right after it returns.\n' +
      'Report the queue contents you received.\n' +
      '\n' +
      'STEP 3 — IF A CHAT IS WAITING, for each id:\n' +
      'a. POST to ' + _base + '/v1/worker/claim with {"id": "THE_ID"} to read it\n' +
      'b. Read the message, compose your best answer\n' +
      'c. POST to ' + _base + '/v1/worker/done with {"id": "THE_ID", "content": "YOUR_ANSWER"}\n' +
      'Report every status.\n' +
      '\n' +
      'STEP 4 — AFTER STEP 2 RETURNS (empty or not):\n' +
      'Go straight back to STEP 2 (call pending?wait=45 again). Do NOT wait manually — the long-poll already waited for you. Keep this loop running forever: heartbeat every few minutes is enough, the queue check is instant.\n' +
      '\n' +
      'Start now. Do STEP 1 first and report the result.'
      : 'Kamu adalah Worker Hestia Bridge. Tugasmu nyata, bukan simulasi. Ikuti persis langkah ini, jaga loop-nya terus berjalan tanpa henti:\n' +
      '\n' +
      'ATURAN WAJIB:\n' +
      '- Kamu HARUS benar-benar mengirim HTTP request sungguhan setiap langkah. Dilarang mengarang hasil.\n' +
      '- Setiap selesai satu langkah, laporkan kode status HTTP yang sebenarnya kamu terima (contoh: 200, 404, 503).\n' +
      '- Kalau kamu tidak punya kemampuan kirim HTTP request, katakan jujur "saya tidak bisa kirim HTTP request" — jangan pura-pura berhasil.\n' +
      '- Jangan membuat cerita tentang token dicabut, kuota, atau hal lain yang tidak kamu verifikasi lewat request sungguhan.\n' +
      '\n' +
      'LANGKAH 1 — HEARTBEAT (tanda kamu hidup):\n' +
      'POST ke ' + _base + '/v1/worker/heartbeat\n' +
      'Header: Authorization: Bearer ' + j.token + '\n' +
      'Laporkan status yang kamu terima.\n' +
      '\n' +
      'LANGKAH 2 — TUNGGU KERJA (long-poll, instan):\n' +
      'GET ke ' + _base + '/v1/worker/pending?wait=45\n' +
      '(header sama seperti di atas)\n' +
      'Request ini tetap terbuka sampai 45 detik dan LANGSUNG kembali begitu ada chat masuk. Jangan tunggu manual — langsung panggil lagi begitu request kembali.\n' +
      'Laporkan isi antrean yang kamu terima.\n' +
      '\n' +
      'LANGKAH 3 — KALAU ADA CHAT MENUNGGU, untuk tiap id:\n' +
      'a. POST ke ' + _base + '/v1/worker/claim dengan {"id": "ID_TSB"} untuk ambil pesannya\n' +
      'b. Baca pesannya, susun jawaban terbaikmu\n' +
      'c. POST ke ' + _base + '/v1/worker/done dengan {"id": "ID_TSB", "content": "JAWABANMU"}\n' +
      'Laporkan setiap status.\n' +
      '\n' +
      'LANGKAH 4 — SETELAH LANGKAH 2 KEMBALI (kosong atau tidak):\n' +
      'Langsung kembali ke LANGKAH 2 (panggil pending?wait=45 lagi). Jangan tunggu manual — long-poll sudah menunggumu. Jaga loop ini terus berjalan: heartbeat tiap beberapa menit cukup, cek antrean bersifat instan.\n' +
      '\n' +
      'Mulai sekarang. Kerjakan LANGKAH 1 dulu dan laporkan hasilnya.';
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
        '<div class="row"><span class="k">Username</span><span class="v">' + esc(u.username || '-') + '</span></div>' +
        '<div class="row"><span class="k">' + t('card.keys') + '</span><span class="v">' + u.keyCount + '</span></div>' +
        '<div class="row"><span class="k">IP</span><span class="v">' + esc(u.lastIp || '-') + '</span></div>' +
        '<div class="row"><span class="k">' + t('card.registered') + '</span><span class="v">' + fmtDate(u.createdAt) + '</span></div>' +
      '</div>' +
      (u.role === 'admin' ? '' :
        '<div class="key-actions">' +
          '<button class="btn btn-sm btn-primary" data-act="extend" data-id="' + u.id + '">+ Durasi</button>' +
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
    } else if (act === 'extend') {
      const plan = prompt('Pilih durasi:\n1 = 1 hari\n2 = 3 hari\n3 = 1 minggu\n4 = gratis', '1');
      const planMap = { '1': '1hari', '2': '3hari', '3': '1minggu', '4': 'gratis' };
      const p = planMap[String(plan || '').trim()];
      if (!p) return;
      await api('/api/users/' + id + '/extend', { method: 'POST', body: JSON.stringify({ plan: p }) });
      toast('Durasi diperpanjang: ' + p);
    }
    await loadUsers();
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
});

/* ------------------------- admin: activity log --------------------------- */
const ACT_TYPE_KEYS = ['register', 'login', 'login_failed', 'logout', 'key_created',
  'key_deleted', 'key_model_changed', 'api_chat', 'api_models', 'admin_action'];
let actState = { offset: 0, total: 0, hasMore: false, loading: false };
const ACT_LIMIT = 50;
function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(LANG === 'en' ? 'en-US' : 'id-ID',
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function actTypeLabel(type) { return t('act.' + type); }
function actDetail(a) {
  let d = a.detail || '';
  if ((a.type === 'api_chat') && (a.promptTokens || a.completionTokens)) {
    const tot = (a.promptTokens || 0) + (a.completionTokens || 0);
    d += ' — <span class="tok">' + fmtNum(tot) + ' token</span>';
  }
  if (a.keyName && a.type !== 'key_created' && a.type !== 'key_deleted') {
    d += ' <span class="muted">[' + esc(a.keyName) + ']</span>';
  }
  if (a.model && a.type === 'api_chat') d = '<strong>' + esc(a.model) + '</strong>' + (d ? '<br>' + d : '');
  return d || '-';
}
function buildActFilters() {
  const tu = $('#act-filter-user');
  if (tu && !tu.dataset.built) {
    tu.dataset.built = '1';
    api('/api/users').then(j => {
      tu.innerHTML = '<option value="">' + esc(t('filter.user')) + '</option>' +
        j.users.map(u => '<option value="' + esc(u.id) + '">' + esc(u.email) + '</option>').join('');
    }).catch(() => {});
  }
  const tt = $('#act-filter-type');
  if (tt) {
    const cur = tt.value;
    tt.innerHTML = '<option value="">' + esc(t('filter.type')) + '</option>' +
      ACT_TYPE_KEYS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + esc(actTypeLabel(k)) + '</option>').join('');
  }
}
function actQuery(offset) {
  const p = new URLSearchParams();
  p.set('limit', ACT_LIMIT); p.set('offset', offset);
  const u = $('#act-filter-user').value, ty = $('#act-filter-type').value;
  const f = $('#act-filter-from').value, to = $('#act-filter-to').value, q = $('#act-filter-q').value.trim();
  if (u) p.set('user', u);
  if (ty) p.set('type', ty);
  if (f) p.set('from', f);
  if (to) p.set('to', to);
  if (q) p.set('q', q);
  return p.toString();
}
async function loadActivities(reset) {
  if (actState.loading) return;
  if (reset) { actState.offset = 0; buildActFilters(); }
  actState.loading = true;
  try {
    const j = await api('/api/admin/activities?' + actQuery(actState.offset));
    actState.total = j.total; actState.hasMore = j.hasMore;
    const box = $('#activities-list');
    const rows = j.activities.map(a =>
      '<tr>' +
        '<td class="time">' + esc(fmtDateTime(a.ts)) + '</td>' +
        '<td class="user" title="' + esc(a.email || '') + '">' + esc(a.email || '-') +
          (a.actor === 'admin' ? ' <span class="act-type admin_action">ADMIN</span>' : '') + '</td>' +
        '<td><span class="act-type ' + a.type + '">' + esc(actTypeLabel(a.type)) + '</span></td>' +
        '<td>' + actDetail(a) + '</td>' +
        '<td class="time">' + esc(a.ip || '-') + '</td>' +
      '</tr>').join('');
    if (reset) {
      $('#act-count').textContent = fmtNum(j.total) + ' ' + t('act.count');
      box.innerHTML = j.activities.length
        ? '<div class="card"><div class="act-table-wrap"><table class="act-table"><thead><tr>' +
          '<th>' + esc(t('col.time')) + '</th><th>' + esc(t('col.user')) + '</th><th>' + esc(t('col.type')) + '</th>' +
          '<th>' + esc(t('col.detail')) + '</th><th>' + esc(t('col.ip')) + '</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table></div></div>'
        : '<div class="card"><div class="card-body empty muted">' + t('empty.activities') + '</div></div>';
      actState.offset = j.activities.length;
    } else {
      const tb = box.querySelector('tbody');
      if (tb) tb.insertAdjacentHTML('beforeend', rows);
      actState.offset += j.activities.length;
    }
    $('#act-load-more').classList.toggle('hidden', !actState.hasMore);
  } catch (ex) { if (ex.message !== 'auth') toast(t('toast.failed') + ex.message); }
  actState.loading = false;
}
$('#act-filter-apply').addEventListener('click', () => loadActivities(true));
$('#act-filter-reset').addEventListener('click', () => {
  $('#act-filter-user').value = ''; $('#act-filter-type').value = '';
  $('#act-filter-from').value = ''; $('#act-filter-to').value = ''; $('#act-filter-q').value = '';
  loadActivities(true);
});
$('#act-filter-q').addEventListener('keydown', e => { if (e.key === 'Enter') loadActivities(true); });
$('#act-load-more').addEventListener('click', () => loadActivities(false));

/* ---- tab Log / Kredensial di halaman Aktivitas (admin) ---- */
document.querySelectorAll('.auth-tab[data-acttab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab[data-acttab]').forEach(b =>
      b.classList.toggle('active', b === btn));
    const cred = btn.dataset.acttab === 'cred';
    $('#act-tab-log').classList.toggle('hidden', cred);
    $('#act-tab-cred').classList.toggle('hidden', !cred);
    if (cred) loadUserCredentials();
  });
});
let credState = { loading: false, loaded: false };
async function loadUserCredentials() {
  if (credState.loading) return;
  credState.loading = true;
  const box = $('#cred-list');
  try {
    const j = await api('/api/admin/users/credentials');
    credState.loaded = true;
    const users = j.users || [];
    box.innerHTML = users.length ? users.map(u => {
      const keyRows = (u.keys || []).map(k =>
        '<tr>' +
          '<td>' + esc(k.name) + (k.revoked ? ' <span class="act-type login_failed">' + esc(t('cred.revoked')) + '</span>' : '') + '</td>' +
          '<td class="time"><code>' + esc(k.keyPrefix) + '</code></td>' +
          '<td>' + esc(k.model || '-') + '</td>' +
        '</tr>').join('');
      const cp = u.customProvider;
      const cpHtml = cp
        ? '<div class="cred-cp"><div><span class="muted">' + esc(t('col.baseurl')) + ':</span> <code>' + esc(cp.baseUrl) + '</code></div>' +
          '<div><span class="muted">' + esc(t('col.keymasked')) + ':</span> <code>' + esc(cp.keyMasked) + '</code></div></div>'
        : '<div class="muted">' + esc(t('cred.nocustom')) + '</div>';
      return '<div class="card cred-card"><div class="card-body">' +
        '<div class="cred-head"><strong>' + esc(u.email) + '</strong>' +
        (u.suspended ? ' <span class="act-type login_failed">' + esc(t('cred.suspended')) + '</span>' : '') +
        ' <span class="muted">(' + (u.keys || []).length + ' ' + esc(t('cred.keycount')) + ')</span></div>' +
        ((u.keys || []).length
          ? '<div class="act-table-wrap"><table class="act-table"><thead><tr>' +
            '<th>' + esc(t('col.keyname')) + '</th><th>' + esc(t('col.keyprefix')) + '</th><th>' + esc(t('col.model')) + '</th>' +
            '</tr></thead><tbody>' + keyRows + '</tbody></table></div>'
          : '<div class="muted">' + esc(t('cred.nokeys')) + '</div>') +
        '<div class="cred-sub muted">' + esc(t('cred.custom')) + '</div>' + cpHtml +
      '</div></div>';
    }).join('')
      : '<div class="card"><div class="card-body empty muted">' + esc(t('empty.creds')) + '</div></div>';
  } catch (ex) {
    if (ex.message !== 'auth') box.innerHTML = '<div class="card"><div class="card-body empty muted">' + esc(t('toast.failed')) + esc(ex.message) + '</div></div>';
  }
  credState.loading = false;
}

/* --------------------------- home: AI models marquee --------------------- */
const AI_MODELS = [
  { name: 'GPT', logo: 'logos/models/openai.png' },
  { name: 'Claude', logo: 'logos/models/claude.png' },
  { name: 'Muse', color: '#a855f7', logo: null, initial: 'M' },
  { name: 'Qwen', logo: 'logos/models/qwen.png' },
  { name: 'DeepSeek', logo: 'logos/models/deepseek.png' },
  { name: 'Gemini', logo: 'logos/models/gemini.png' },
  { name: 'Mistral', logo: 'logos/models/mistral.png' },
  { name: 'Llama', logo: 'logos/models/meta.png' },
  { name: 'Grok', logo: 'logos/models/grok.png' },
  { name: 'Cohere', logo: 'logos/models/cohere.png' },
  { name: 'Anthropic', logo: 'logos/models/anthropic.png' },
  { name: 'xAI', logo: 'logos/models/x.png' },
];
function renderApps() {
  const card = m => {
    const ico = m.logo
      ? '<img src="' + m.logo + '" alt="' + m.name + '" class="model-logo-img">'
      : '<div class="model-logo" style="background:' + (m.color || '#888') + '">' + (m.initial || m.name[0]) + '</div>';
    return '<div class="model-card">' + ico + '<div class="model-name">' + m.name + '</div></div>';
  };
  const mk = list => { const h = list.map(card).join(''); return h + h; };
  // Bagi model ke 3 baris dengan pergerakan berbeda
  const t1 = document.getElementById('models-track-1');
  if (t1) t1.innerHTML = mk(AI_MODELS.slice(0, 6));
  const t2 = document.getElementById('models-track-2');
  if (t2) t2.innerHTML = mk(AI_MODELS.slice(5, 11));
  const t3 = document.getElementById('models-track-3');
  if (t3) t3.innerHTML = mk(AI_MODELS.slice(10).concat(AI_MODELS.slice(0, 2)));
  // Landing page models (same content)
  const lt1 = document.getElementById('landing-models-track-1');
  if (lt1) lt1.innerHTML = mk(AI_MODELS.slice(0, 6));
  const lt2 = document.getElementById('landing-models-track-2');
  if (lt2) lt2.innerHTML = mk(AI_MODELS.slice(5, 11));
  const lt3 = document.getElementById('landing-models-track-3');
  if (lt3) lt3.innerHTML = mk(AI_MODELS.slice(10).concat(AI_MODELS.slice(0, 2)));
  const grid = document.getElementById('apps-grid');
  if (grid) grid.innerHTML = '';
  const gridLanding = document.getElementById('apps-grid-landing');
  if (gridLanding) gridLanding.innerHTML = '';
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

/* --------------------------- TOS modal --------------------------------- */
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'tos-link') {
    e.preventDefault();
    document.getElementById('tos-modal').classList.remove('hidden');
  }
});
document.getElementById('tos-modal-close').addEventListener('click', () => {
  document.getElementById('tos-modal').classList.add('hidden');
});
document.getElementById('tos-ok').addEventListener('click', () => {
  document.getElementById('tos-modal').classList.add('hidden');
});
document.getElementById('tos-modal').addEventListener('click', e => {
  if (e.target.id === 'tos-modal') e.target.classList.add('hidden');
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
    'nav.myworkers': 'Worker',
    'worker.agent.title': 'Agent untuk Worker',
    'worker.agent.desc': 'Pilih agent (Base URL + API key) milikmu yang dipakai worker.',
    'worker.agent.open': 'Atur Agent Pilihan',
    'worker.agent.notset': 'Belum diatur — klik "Atur Agent Pilihan".',
    'nav.settings': 'Agent Pilihan',
    'hero.settings': 'Agent Pilihan',
    'hero.settings.sub': 'Pakai API key AI milikmu sendiri — kuota terpakai dari akunmu, bukan admin.',
    'btn.checkmodels': 'Cek Model',
    'btn.save': 'Simpan',
    'btn.delete': 'Hapus',
    'opt.checkfirst': 'Cek model dulu',
    'form.settings.keyset': 'Tersimpan',
    'form.settings.note': 'Key hanya dipakai untuk request milikmu. <strong>Jangan</strong> bagikan ke orang lain.',
    'settings.configured': 'Provider pribadimu sudah tersimpan.',
    'settings.checkok': 'Model ditemukan!',
    'settings.saved': 'Pengaturan tersimpan.',
    'settings.deleted': 'Provider pribadi dihapus.',
    'settings.confirmdelete': 'Hapus provider pribadimu?',
    'guide.settings.title': 'Cara pakai provider sendiri',
    'guide.settings.s1': 'Isi <strong>Base URL</strong> dan <strong>API Key</strong> dari provider AI milikmu (yang kompatibel OpenAI API).',
    'guide.settings.s2': 'Klik <strong>Cek Model</strong> — daftar model dari key-mu akan muncul otomatis.',
    'guide.settings.s3': 'Pilih model, lalu klik <strong>Simpan</strong>. Setelah itu, saat <strong>Buat Key</strong> pilih <strong>Provider Saya</strong>.',
    'nav.logout': 'Keluar',
    'nav.account': 'Akun',
    'account.title': 'Akun',
    'account.duration': 'Tambahan Durasi',
    'account.badge.save': 'Hemat',
    'account.badge.best': 'Paling Hemat',
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
    'nav.activities': 'Aktivitas',
    'hero.activities': 'Aktivitas Pengguna',
    'hero.activities.sub': 'Pantau semua aktivitas pengguna: login, pembuatan key, dan pemakaian API.',
    'filter.user': 'Semua pengguna',
    'filter.type': 'Semua jenis',
    'filter.from': 'Dari',
    'filter.to': 'Sampai',
    'filter.search': 'Cari',
    'filter.search.ph': 'email / key / model / IP',
    'btn.filter': 'Filter',
    'btn.resetfilter': 'Reset',
    'btn.loadmore': 'Muat lagi',
    'col.time': 'Waktu',
    'col.user': 'Pengguna',
    'col.type': 'Jenis',
    'col.detail': 'Detail',
    'col.ip': 'IP',
    'empty.activities': 'Belum ada aktivitas tercatat.',
    'act.count': 'aktivitas',
    'act.register': 'Daftar',
    'act.login': 'Masuk',
    'act.login_failed': 'Gagal masuk',
    'act.logout': 'Keluar',
    'act.key_created': 'Key dibuat',
    'act.key_deleted': 'Key dihapus',
    'act.key_model_changed': 'Model diganti',
    'act.api_chat': 'Chat API',
    'act.api_models': 'Models API',
    'act.admin_action': 'Aksi admin',
    'tab.actlog': 'Log Aktivitas',
    'tab.creds': 'Kredensial Pengguna',
    'cred.desc': 'API key dan Base URL milik setiap pengguna, dikelompokkan per Gmail. Full key tidak pernah ditampilkan.',
    'col.keyname': 'Nama Key',
    'col.keyprefix': 'Prefix Key',
    'col.model': 'Model',
    'col.baseurl': 'Base URL',
    'col.keymasked': 'Key (mask)',
    'cred.revoked': 'dicabut',
    'cred.suspended': 'disuspend',
    'cred.keycount': 'key',
    'cred.nokeys': 'Tidak ada key.',
    'cred.nocustom': 'Belum mengatur provider sendiri.',
    'cred.custom': 'Provider sendiri (Agent Pilihan)',
    'empty.creds': 'Belum ada pengguna.',
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
    'tos.title': 'Syarat & Ketentuan',
    'auth.reg.tos': 'Saya menyetujui <a href="#" id="tos-link">Syarat &amp; Ketentuan</a> Hestia Bridge',
    'tos.content': '<h4>1. Penerimaan</h4><p>Dengan mendaftar dan menggunakan Hestia Bridge, Anda menyetujui seluruh Syarat &amp; Ketentuan ini.</p><h4>2. Akun</h4><ul><li>Hanya alamat Gmail valid yang dapat mendaftar.</li><li>Satu perangkat dibatasi untuk jumlah akun tertentu.</li><li>Anda bertanggung jawab menjaga kerahasiaan kata sandi dan API key Anda.</li></ul><h4>3. Penggunaan yang Dilarang</h4><ul><li>Dilarang menggunakan layanan untuk aktivitas ilegal, spam, atau penyalahgunaan.</li><li>Dilarang membagikan API key Anda kepada pihak lain tanpa izin.</li><li>Dilarang mencoba merusak, mengganggu, atau mengeksploitasi sistem.</li></ul><h4>4. Kuota &amp; Batasan</h4><p>Penggunaan mengikuti kuota provider masing-masing dan batasan yang ditetapkan admin. Pelanggaran dapat mengakibatkan penangguhan akun.</p><h4>5. Perubahan Layanan</h4><p>Kami dapat mengubah, menangguhkan, atau menghentikan layanan sewaktu-waktu dengan pemberitahuan yang wajar.</p><h4>6. Hubungi Kami</h4><p>Untuk pertanyaan atau laporan, hubungi tim Hestia Bridge melalui kanal resmi yang tersedia.</p>',
    'auth.forgot.link': 'Lupa kata sandi?',
    'auth.forgot.title': 'Lupa Kata Sandi',
    'auth.forgot.desc': 'Masukkan email akunmu, kami kirim kode reset ke Gmail.',
    'auth.forgot.code.desc': 'Masukkan kode 6 digit dari Gmail dan kata sandi baru.',
    'auth.forgot.newpass': 'Kata sandi baru (min 6 karakter)',
    'auth.forgot.submit': 'Reset kata sandi',
    'auth.forgot.done': 'Kata sandi berhasil direset. Silakan masuk.',
    'auth.forgot.toast': 'Kode reset terkirim, periksa di Gmail anda.',
    'nav.home': 'Beranda',
    'home.title': 'Selamat datang di Hestia Bridge',
    'home.sub': 'Sambungkan API key kamu ke aplikasi AI favoritmu. Satu key, banyak aplikasi.',
    'home.cta': 'Lihat Key Saya',
    'home.how.title': 'Cara menyambungkan',
    'home.how.s1': 'Buat API key di halaman <strong>Key Saya</strong> atau <strong>Kunci API</strong>.',
    'home.how.s2': 'Buka aplikasi AI pilihanmu, cari pengaturan <strong>custom endpoint</strong> / <strong>BYOK</strong>.',
    'home.how.s3': 'Isi <strong>Base URL</strong> dengan alamat Bridge dan <strong>API Key</strong> dengan key <code>hesti-...</code> / <code>sr-...</code> milikmu.',
    'btn.createworker': 'Buat Worker',
    'btn.createworkerkey': 'Buat Key Worker',
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
    'auth.reg.note': 'Hanya Gmail yang bisa daftar. Satu perangkat hanya untuk 1 akun.',
    'auth.reg.otp': 'Kode verifikasi (cek Gmail)',
    'auth.reg.otp.send': 'Kirim kode',
    'auth.reg.otp.sent': 'Kode dikirim ke Gmail kamu. Cek kotak masuk ya.',
    'auth.reg.otp.toast': 'Kode email sudah terkirim, periksa di Gmail anda.',
    'auth.reg.otp.wait': 'detik',
    'auth.reg.otp.verified': 'Email terverifikasi. Silakan lanjutkan daftar.',
    'auth.example': 'contoh pakai',
    'auth.suspended': 'Pendaftaran diblokir: perangkat ini sudah terdaftar. 1 perangkat hanya untuk 1 Gmail.',
    'landing.nav.login': 'Masuk',
    'landing.nav.register': 'Daftar',
    'landing.hero.title': 'Hestia Bridge',
    'landing.hero.sub': 'Kelola API key AI kamu dari satu dashboard.',
    'landing.hero.cta': 'Mulai Gratis',
    'landing.hero.guide': 'Lihat Cara Pakai',
    'landing.hero.badge': 'Kelola semua AI dari satu tempat',
    'landing.check.1': 'Satu kunci untuk banyak aplikasi',
    'landing.check.2': 'Kompatibel OpenAI API',
    'landing.check.3': 'Murah aman dan terpercaya',
    'landing.code.title': 'Pakai seperti API biasa',
    'landing.pricing.title': 'Harga Murah Mulai dari',
    'landing.pricing.d1': '1 Hari',
    'landing.pricing.d2': '3 Hari',
    'landing.pricing.d3': '1 Minggu',
    'landing.guide.title': 'Cara pakai',
    'landing.guide.1t': 'Daftar akun',
    'landing.guide.1d': 'Buat akun dengan Gmail kamu, gratis.',
    'landing.guide.2t': 'Buat API key',
    'landing.guide.2d': 'Tambah key baru dan pilih provider AI milikmu.',
    'landing.guide.3t': 'Sambungkan aplikasi',
    'landing.guide.3d': 'Isi Base URL dan API key di aplikasi AI favoritmu, langsung pakai.',
    'landing.feat.title': 'Kenapa Hestia Bridge?',
    'landing.feat.1t': 'Satu Dashboard',
    'landing.feat.1d': 'Kelola semua API key AI kamu dari satu tempat yang rapi.',
    'landing.feat.2t': 'Support Banyak Aplikasi',
    'landing.feat.2d': 'Sambungkan aplikasi AI favoritmu lewat custom endpoint yang kompatibel OpenAI.',
    'section.mykeys.title': 'Key saya',
    'section.providers.title': 'Daftar provider',
    'section.workers.title': 'Worker Saya',
    'page.workers.desc': 'Daftarkan worker dari akun AI milikmu — key mode worker milikmu dijawab worker ini secara otomatis.',
    'guide.howto.title': 'Cara pakai',
    'guide.howto.s1': 'Buka halaman <strong>Provider</strong> lewat menu, tempel <strong>Base URL</strong> + <strong>API key</strong> provider AI kamu, lalu simpan — koneksi langsung divalidasi.',
    'guide.howto.s2': 'Klik <strong>+ Tambah key</strong> di atas — satu API key <code>hesti-...</code> langsung dibuat dan terikat ke satu provider.',
    'guide.howto.s3': 'Di aplikasi AI di HP yang mendukung custom endpoint OpenAI: isi <strong>Base URL</strong> dengan<br><code id="guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>dan <strong>API Key</strong> dengan key <code>hesti-...</code> yang baru dibuat (klik <strong>info cURL</strong> di kartu key untuk salin cepat), lalu pakai seperti biasa lewat prompt.',
    'guide.howto.s4': 'Pantau pemakaian tiap key di dashboard ini — jumlah request dan token tercatat otomatis.',
    'guide.test.title': 'Cara tes worker',
    'guide.test.s1': 'Pastikan worker kamu <strong>online</strong> di daftar <strong>Worker Saya</strong> di atas.',
    'guide.test.s2': 'Klik <strong>Buat Key</strong>, pilih mode <strong>Worker</strong>, lalu <strong>Buat Key</strong>.',
    'guide.test.s3': 'Klik <strong>Cara sambung</strong> di kartu key, salin <strong>Base URL</strong> dan <strong>API Key</strong> ke aplikasi AI di HP, lalu chat seperti biasa.',
    'guide.test.s4': 'Kalau ada jawaban, berarti worker kamu jalan. Kalau tidak dijawab, cek lagi worker-nya online atau tidak.',
    'guide.my.s1': 'Klik <strong>Buat Key</strong> untuk membuat key gateway (dijawab provider AI dengan model yang tersedia).',
    'guide.my.s2': 'Untuk key worker: buka menu <strong>Worker</strong>, buat worker dulu lalu klik <strong>Buat Key Worker</strong>.',
    'guide.my.s3': 'Di aplikasi AI di HP yang mendukung custom endpoint OpenAI: isi <strong>Base URL</strong> dengan<br><code id="my-guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>dan <strong>API Key</strong> dengan key <code>hesti-...</code> milikmu (klik <strong>info cURL</strong> di kartu key untuk salin cepat), lalu pakai seperti biasa lewat prompt.',
    'form.name': 'Nama',
    'form.name.ph': 'cth: Provider A',
    'form.apikey': 'API Key',
    'form.baseurl': 'Base URL',
    'form.keyname': 'Nama key',
    'form.keyname.ph': 'cth: Key HP',
    'form.provider': 'Provider',
    'form.model': 'Model',
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
    'modal.connect.title': 'info cURL',
    'modal.connect.desc': 'Isi dua kolom ini di aplikasi AI di HP, lalu pakai lewat prompt seperti biasa.',
    'modal.rename.title': 'Ganti nama key',
    'modal.editmodel.title': 'Ganti model',
    'modal.editmodel.key': 'Key',
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
    'card.supportedmodels': 'Model yang didukung',
    'card.available': 'Tersedia',
    'card.popular': 'Paling banyak dipakai',
    'card.copymodel': 'Salin nama model',
    'toast.model.copied': 'Nama model disalin.',
    'card.model': 'Model',
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
    'btn.connect': 'info cURL',
    'btn.edit': 'edit',
    'btn.editmodel': 'ganti model',
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
    'opt.no.model': '(tidak ada model)',
    'opt.online': ' (online)',
  },
  en: {
    'topbar.keys': 'API Keys',
    'nav.keys': 'API Keys',
    'nav.providers': 'Providers',
    'nav.users': 'Users',
    'nav.mykeys': 'My Keys',
    'nav.myworkers': 'Worker',
    'worker.agent.title': 'Agent for Worker',
    'worker.agent.desc': 'Choose your own agent (Base URL + API key) used by the worker.',
    'worker.agent.open': 'Set Chosen Agent',
    'worker.agent.notset': 'Not set yet — click "Set Chosen Agent".',
    'nav.settings': 'Chosen Agent',
    'hero.settings': 'Chosen Agent',
    'hero.settings.sub': 'Use your own AI API key — usage is billed to your account, not the admin.',
    'btn.checkmodels': 'Check Models',
    'btn.save': 'Save',
    'btn.delete': 'Delete',
    'opt.checkfirst': 'Check models first',
    'form.settings.keyset': 'Saved',
    'form.settings.note': 'The key is only used for your own requests. <strong>Do not</strong> share it with others.',
    'settings.configured': 'Your personal provider is saved.',
    'settings.checkok': 'Models found!',
    'settings.saved': 'Settings saved.',
    'settings.deleted': 'Personal provider deleted.',
    'settings.confirmdelete': 'Delete your personal provider?',
    'guide.settings.title': 'How to use your own provider',
    'guide.settings.s1': 'Fill in the <strong>Base URL</strong> and <strong>API Key</strong> of your own AI provider (OpenAI API compatible).',
    'guide.settings.s2': 'Click <strong>Check Models</strong> — the model list from your key will appear automatically.',
    'guide.settings.s3': 'Pick a model, then click <strong>Save</strong>. After that, when creating a key choose <strong>My Provider</strong>.',
    'nav.logout': 'Logout',
    'nav.account': 'Account',
    'account.title': 'Account',
    'account.duration': 'Add Duration',
    'account.badge.save': 'Save',
    'account.badge.best': 'Best Value',
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
    'nav.activities': 'Activities',
    'hero.activities': 'User Activities',
    'hero.activities.sub': 'Monitor all user activities: logins, key creation, and API usage.',
    'filter.user': 'All users',
    'filter.type': 'All types',
    'filter.from': 'From',
    'filter.to': 'To',
    'filter.search': 'Search',
    'filter.search.ph': 'email / key / model / IP',
    'btn.filter': 'Filter',
    'btn.resetfilter': 'Reset',
    'btn.loadmore': 'Load more',
    'col.time': 'Time',
    'col.user': 'User',
    'col.type': 'Type',
    'col.detail': 'Detail',
    'col.ip': 'IP',
    'empty.activities': 'No activities recorded yet.',
    'act.count': 'activities',
    'act.register': 'Registered',
    'act.login': 'Login',
    'act.login_failed': 'Failed login',
    'act.logout': 'Logout',
    'act.key_created': 'Key created',
    'act.key_deleted': 'Key deleted',
    'act.key_model_changed': 'Model changed',
    'act.api_chat': 'Chat API',
    'act.api_models': 'Models API',
    'act.admin_action': 'Admin action',
    'tab.actlog': 'Activity Log',
    'tab.creds': 'User Credentials',
    'cred.desc': 'API keys and Base URLs of each user, grouped by Gmail. Full keys are never displayed.',
    'col.keyname': 'Key Name',
    'col.keyprefix': 'Key Prefix',
    'col.model': 'Model',
    'col.baseurl': 'Base URL',
    'col.keymasked': 'Key (masked)',
    'cred.revoked': 'revoked',
    'cred.suspended': 'suspended',
    'cred.keycount': 'keys',
    'cred.nokeys': 'No keys.',
    'cred.nocustom': 'No custom provider set.',
    'cred.custom': 'Own provider (Chosen Agent)',
    'empty.creds': 'No users yet.',
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
    'tos.title': 'Terms & Conditions',
    'auth.reg.tos': 'I agree to the Hestia Bridge <a href="#" id="tos-link">Terms &amp; Conditions</a>',
    'tos.content': '<h4>1. Acceptance</h4><p>By registering and using Hestia Bridge, you agree to all of these Terms &amp; Conditions.</p><h4>2. Account</h4><ul><li>Only valid Gmail addresses may register.</li><li>One device is limited to a certain number of accounts.</li><li>You are responsible for keeping your password and API keys confidential.</li></ul><h4>3. Prohibited Use</h4><ul><li>Using the service for illegal activity, spam, or abuse is prohibited.</li><li>Sharing your API keys with others without permission is prohibited.</li><li>Attempting to damage, disrupt, or exploit the system is prohibited.</li></ul><h4>4. Quotas &amp; Limits</h4><p>Usage follows each provider\'s quota and limits set by the admin. Violations may result in account suspension.</p><h4>5. Service Changes</h4><p>We may change, suspend, or discontinue the service at any time with reasonable notice.</p><h4>6. Contact Us</h4><p>For questions or reports, contact the Hestia Bridge team through the available official channels.</p>',
    'nav.home': 'Home',
    'home.title': 'Welcome to Hestia Bridge',
    'home.sub': 'Connect your API key to your favorite AI apps. One key, many apps.',
    'home.cta': 'View My Keys',
    'home.how.title': 'How to connect',
    'home.how.s1': 'Create an API key on the <strong>My Keys</strong> or <strong>API Keys</strong> page.',
    'home.how.s2': 'Open your chosen AI app, find <strong>custom endpoint</strong> / <strong>BYOK</strong> settings.',
    'home.how.s3': 'Fill <strong>Base URL</strong> with the Bridge address and <strong>API Key</strong> with your <code>hesti-...</code> / <code>sr-...</code> key.',
    'btn.createworker': 'Create Worker',
    'btn.createworkerkey': 'Create Worker Key',
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
    'auth.reg.note': 'Only Gmail can register. One device is only for 1 account.',
    'auth.reg.otp': 'Verification code (check Gmail)',
    'auth.reg.otp.send': 'Send code',
    'auth.reg.otp.sent': 'Code sent to your Gmail. Check your inbox.',
    'auth.reg.otp.toast': 'Verification code sent, check your Gmail.',
    'auth.reg.otp.wait': 'sec',
    'auth.reg.otp.verified': 'Email verified. Please continue signing up.',
    'auth.forgot.link': 'Forgot password?',
    'auth.forgot.title': 'Forgot Password',
    'auth.forgot.desc': 'Enter your account email, we will send a reset code to Gmail.',
    'auth.forgot.code.desc': 'Enter the 6-digit code from Gmail and your new password.',
    'auth.forgot.newpass': 'New password (min 6 characters)',
    'auth.forgot.submit': 'Reset password',
    'auth.forgot.done': 'Password reset successful. Please log in.',
    'auth.forgot.toast': 'Reset code sent, check your Gmail.',
    'auth.example': 'usage example',
    'auth.suspended': 'Registration blocked: this device is already registered. 1 device is only for 1 Gmail.',
    'landing.nav.login': 'Login',
    'landing.nav.register': 'Sign up',
    'landing.hero.title': 'Hestia Bridge',
    'landing.hero.sub': 'Manage your AI API keys from one dashboard.',
    'landing.hero.cta': 'Start Free',
    'landing.hero.guide': 'See How It Works',
    'landing.hero.badge': 'Manage all AI from one place',
    'landing.check.1': 'One key for many apps',
    'landing.check.2': 'OpenAI API compatible',
    'landing.check.3': 'Cheap, safe and trusted',
    'landing.code.title': 'Use it like a regular API',
    'landing.pricing.title': 'Affordable Prices Starting from',
    'landing.pricing.d1': '1 Day',
    'landing.pricing.d2': '3 Days',
    'landing.pricing.d3': '1 Week',
    'landing.guide.title': 'How to use',
    'landing.guide.1t': 'Create an account',
    'landing.guide.1d': 'Sign up with your Gmail, free.',
    'landing.guide.2t': 'Create an API key',
    'landing.guide.2d': 'Add a new key and pick your AI provider.',
    'landing.guide.3t': 'Connect your app',
    'landing.guide.3d': 'Fill in the Base URL and API key in your favorite AI app, ready to use.',
    'landing.feat.title': 'Why Hestia Bridge?',
    'landing.feat.1t': 'One Dashboard',
    'landing.feat.1d': 'Manage all your AI API keys from one tidy place.',
    'landing.feat.2t': 'Many Apps Supported',
    'landing.feat.2d': 'Connect your favorite AI apps via an OpenAI-compatible custom endpoint.',
    'section.mykeys.title': 'My keys',
    'section.providers.title': 'Provider list',
    'section.workers.title': 'My Workers',
    'page.workers.desc': 'Register a worker from your AI account — your worker-mode keys are answered automatically by this worker.',
    'guide.howto.title': 'How to use',
    'guide.howto.s1': 'Open the <strong>Providers</strong> page from the menu, paste your AI provider\'s <strong>Base URL</strong> + <strong>API key</strong>, then save — the connection is validated immediately.',
    'guide.howto.s2': 'Click <strong>+ Add key</strong> above — one <code>hesti-...</code> API key is created and bound to one provider.',
    'guide.howto.s3': 'In an AI app on your phone that supports custom OpenAI endpoints: fill <strong>Base URL</strong> with<br><code id="guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>and <strong>API Key</strong> with your new <code>hesti-...</code> key (click <strong>How to connect</strong> on the key card for quick copy), then use it via prompt as usual.',
    'guide.howto.s4': 'Monitor each key\'s usage on this dashboard — request and token counts are recorded automatically.',
    'guide.test.title': 'How to test your worker',
    'guide.test.s1': 'Make sure your worker is <strong>online</strong> in the <strong>My Workers</strong> list above.',
    'guide.test.s2': 'Click <strong>Create Key</strong>, choose <strong>Worker</strong> mode, then <strong>Create Key</strong>.',
    'guide.test.s3': 'Click <strong>How to connect</strong> on the key card, copy the <strong>Base URL</strong> and <strong>API Key</strong> into the AI app on your phone, then chat as usual.',
    'guide.test.s4': 'If you get an answer, your worker is running. If not, check whether your worker is online.',
    'guide.my.s1': 'Click <strong>Create Key</strong> to create a gateway key (answered by the AI provider with available models).',
    'guide.my.s2': 'For worker keys: open the <strong>Worker</strong> menu, create a worker first, then click <strong>Create Worker Key</strong>.',
    'guide.my.s3': 'In an AI app on your phone that supports custom OpenAI endpoints: fill <strong>Base URL</strong> with<br><code id="my-guide-base-url">https://hestia-bridge-production.up.railway.app/v1</code><br>and <strong>API Key</strong> with your <code>hesti-...</code> key (click <strong>How to connect</strong> on the key card for quick copy), then use it via prompt as usual.',
    'form.name': 'Name',
    'form.name.ph': 'e.g.: Provider A',
    'form.apikey': 'API Key',
    'form.baseurl': 'Base URL',
    'form.keyname': 'Key name',
    'form.keyname.ph': 'e.g.: Phone Key',
    'form.provider': 'Provider',
    'form.model': 'Model',
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
    'modal.connect.title': 'cURL info',
    'modal.connect.desc': 'Fill these two fields in the AI app on your phone, then use it via prompt as usual.',
    'modal.rename.title': 'Rename key',
    'modal.editmodel.title': 'Change model',
    'modal.editmodel.key': 'Key',
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
    'card.model': 'Model',
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
    'card.supportedmodels': 'Supported models',
    'card.available': 'Available',
    'card.popular': 'Most used',
    'card.copymodel': 'Copy model name',
    'toast.model.copied': 'Model name copied.',
    'card.keys': 'Keys',
    'card.registered': 'Registered',
    'card.heartbeat': 'Last heartbeat',
    'btn.activate': 'activate',
    'btn.deactivate': 'deactivate',
    'btn.connect': 'cURL info',
    'btn.edit': 'edit',
    'btn.editmodel': 'change model',
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
    'opt.no.model': '(no models)',
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
  const lblAuth = document.getElementById('lang-label-auth');
  if (lblAuth) lblAuth.textContent = LANG.toUpperCase();
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
  if (typeof refreshAll === 'function') refreshAll().catch(() => {});
  if (typeof loadActivities === 'function' && !$('#view-activities').classList.contains('hidden')) {
    $('#act-filter-type').innerHTML = '';
    loadActivities(true);
    if (credState.loaded && !$('#act-tab-cred').classList.contains('hidden')) { credState.loaded = false; loadUserCredentials(); }
  }
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
