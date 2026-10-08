'use strict';
/* ==========================================================================
 * Hestia Bridge — lightweight OpenAI-compatible API key bridge dashboard.
 *
 * Connect any OpenAI-compatible AI provider (Base URL + API key), then issue
 * bridge keys ("hb-...") bound 1 key = 1 provider. Use the bridge key from
 * any phone app via the OpenAI-compatible /v1 endpoints below.
 *
 * Dependencies: express + bcrypt only. No build step. Plain CSS + vanilla JS.
 *
 * Env:
 *   PORT                default 3000
 *   DATA_DIR            default ./data   (mount a Railway volume at /app/data
 *                       and set DATA_DIR=/app/data for persistence)
 *   ADMIN_EMAIL         admin login email
 *   ADMIN_PASSWORD_HASH bcrypt hash of the admin password
 *                       (generate with: npm run gen-hash -- "yourpassword")
 * ========================================================================== */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60; // requests per minute per bridge key

/* ------------------------------ storage --------------------------------- */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadDb() {
  ensureDataDir();
  try {
    if (fs.existsSync(DB_PATH)) {
      const d = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      return {
        providers: Array.isArray(d.providers) ? d.providers : [],
        keys: Array.isArray(d.keys) ? d.keys : [],
        usage: Array.isArray(d.usage) ? d.usage : [],
        workers: Array.isArray(d.workers) ? d.workers : [],
        wqueue: Array.isArray(d.wqueue) ? d.wqueue : [],
        users: Array.isArray(d.users) ? d.users : [],
        sessions: (d.sessions && typeof d.sessions === 'object') ? d.sessions : {}
      };
    }
  } catch (e) {
    console.error('[db] load failed, starting fresh:', e.message);
  }
  return { providers: [], keys: [], usage: [], workers: [], wqueue: [], users: [], sessions: {} };
}
const PLAN_DURATIONS = {
  gratis: 24 * 3600 * 1000,
  '1hari': 24 * 3600 * 1000,
  '3hari': 3 * 24 * 3600 * 1000,
  '1minggu': 7 * 24 * 3600 * 1000,
};
const PLAN_NAMES = {
  gratis: 'Gratis',
  '1hari': '1 Hari',
  '3hari': '3 Hari',
  '1minggu': '1 Minggu',
};
const db = loadDb();
// Kesehatan provider gateway (in-memory, khusus pantauan admin).
const providerHealth = {};
function recordProviderError(providerId, status, msg) {
  if (!providerId) return;
  if (!providerHealth[providerId]) providerHealth[providerId] = { errors: 0, lastError: null, lastStatus: null, lastAt: null };
  const h = providerHealth[providerId];
  h.errors++;
  h.lastError = String(msg || '').slice(0, 200);
  h.lastStatus = status;
  h.lastAt = nowIso();
}
function recordProviderOk(providerId) {
  if (!providerId || !providerHealth[providerId]) return;
  // Reset error count kalau sudah pulih (sukses 5x berturut-turut).
  const h = providerHealth[providerId];
  h.okStreak = (h.okStreak || 0) + 1;
  if (h.okStreak >= 5) { h.errors = 0; h.okStreak = 0; h.lastError = null; }
}
// Seed provider gateway untuk coba-coba (dari Hestia). Ganti/hapus kalau sudah ada provider resmi.
(function seedGatewayProvider() {
  try {
    if (!db.providers) db.providers = [];
    // Metadata model dari panel GateAI (screenshot Hestia). Jangan ngarang — update manual kalau berubah.
    const gatewayModelMeta = {
      'Atria-Dawn-Preview': { context: '265.000 konteks', caps: ['Reasoning', 'Text Generation'], popular: false },
      'deepseek-v4-pro': { context: '1.000.000 konteks', caps: ['Reasoning', 'Text Generation', 'Vision'], popular: true },
      'deepseek-v4-pro-0813': { context: '1.000.000 konteks', caps: ['Reasoning', 'Text Generation', 'Vision'], popular: true },
      'deepseek-v4.1-flash': { context: '1.000.000 konteks', caps: ['Reasoning', 'Text Generation', 'Vision'], popular: true }
    };
    let gp = db.providers.find(p => p.id === 'gateway-test');
    const gatewayApiKey = 'sk-live-c4cba35f6649dae633043ce5580889e7601c270e7481ccfa4a566f9fa38bc57f';
    if (!gp) {
      db.providers.push({
        id: 'gateway-test',
        name: 'Gateway Test (GateAI)',
        baseUrl: 'https://gateai.id/v1',
        apiKey: gatewayApiKey,
        models: ['Atria-Dawn-Preview', 'deepseek-v4-pro', 'deepseek-v4-pro-0813', 'deepseek-v4.1-flash'],
        modelMeta: gatewayModelMeta,
        createdAt: nowIso()
      });
      saveDb();
    } else {
      // Pastikan selalu sinkron (apiKey, modelMeta, models).
      let dirty = false;
      if (gp.apiKey !== gatewayApiKey) { gp.apiKey = gatewayApiKey; dirty = true; }
      if (!gp.modelMeta) { gp.modelMeta = gatewayModelMeta; dirty = true; }
      if (dirty) saveDb();
    }
  } catch (e) { console.error('seed gateway gagal:', e.message); }
})();
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      ensureDataDir();
      db.sessions = Object.fromEntries(sessions);
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error('[db] save failed:', e.message);
    }
  }, 150);
}

/* ------------------------------ helpers --------------------------------- */
function uid(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}
function genKeyToken(mode) {
  const prefix = mode === 'worker' ? 'sr-' : 'hesti-';
  return prefix + crypto.randomBytes(32).toString('hex');
}
// Migrasi: user lama yang belum punya plan dapat Gratis 24 jam dari sekarang.
(function migratePlans() {
  let changed = false;
  const now = Date.now();
  for (const u of db.users) {
    if (u.role === 'admin') continue;
    if (!u.plan || !u.planExpiresAt) {
      u.plan = u.plan || 'gratis';
      u.planExpiresAt = now + PLAN_DURATIONS.gratis;
      changed = true;
    }
  }
  if (changed) saveDb();
})();
function nowIso() {
  return new Date().toISOString();
}
// Ambil IP client (dukung proxy Railway)
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || '';
}
function normBaseUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}
// Rough token estimate used ONLY when the upstream response has no usage
// object. Real usage values from the provider are always preferred.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}
// Hapus field reasoning internal dari respons upstream agar tidak bocor ke user.
const REASONING_FIELDS = ['reasoning', 'reasoning_content', 'reasoning_details', 'thinking', 'thought', 'chain_of_thought'];
// Bersihkan pesan error upstream dari branding provider asli.
function sanitizeUpstreamError(rawMsg, httpStatus) {
  let msg = (rawMsg || '').trim();
  // Buang branding provider yang umum.
  msg = msg.replace(/gateai/gi, 'Hestia').replace(/plugsky/gi, 'Hestia');
  // Kalau kosong atau terlalu teknis, pakai pesan generik berdasarkan status.
  if (!msg || msg.length > 300) {
    if (httpStatus === 429) return 'Batas pemakaian tercapai, coba lagi nanti.';
    if (httpStatus === 401 || httpStatus === 403) return 'Akses ditolak.';
    if (httpStatus >= 500) return 'Layanan AI sedang gangguan, coba lagi nanti.';
    return 'Permintaan gagal diproses.';
  }
  return msg;
}
function stripReasoning(data) {
  if (!data || !Array.isArray(data.choices)) return data;
  for (const c of data.choices) {
    for (const part of [c.message, c.delta]) {
      if (part && typeof part === 'object') {
        for (const f of REASONING_FIELDS) delete part[f];
      }
    }
  }
  return data;
}
// Normalisasi respons chat dari provider mana pun ke format OpenAI standar yang bersih.
function normalizeChatResponse(data, fallbackModel) {
  if (!data || typeof data !== 'object') return data;
  const src = data.choices && data.choices[0];
  const msg = (src && (src.message || src.delta)) || {};
  const clean = {
    id: 'hestia-' + (data.id || Date.now().toString(36)).replace(/^chatcmpl-/, ''),
    object: 'chat.completion',
    created: data.created || Math.floor(Date.now() / 1000),
    model: data.model || fallbackModel || 'unknown',
    choices: [{
      index: 0,
      message: {
        role: msg.role || 'assistant',
        content: typeof msg.content === 'string' ? msg.content : ''
      },
      finish_reason: (src && (src.finish_reason || src.stop_reason)) || 'stop'
    }],
    usage: null,
    provider: 'Hestia'
  };
  if (data.usage && typeof data.usage === 'object') {
    clean.usage = {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || ((data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0))
    };
  }
  return clean;
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function maskKey(k) {
  if (!k || k.length < 10) return '***';
  return k.slice(0, 6) + '...' + k.slice(-4);
}

/* ------------------------ sessions (admin + users) ----------------------- */
// Sessions persist di db.json supaya tidak hangus tiap deploy/restart.
const sessions = new Map();
(function initSessions() {
  const now = Date.now();
  for (const [tok, s] of Object.entries(db.sessions || {})) {
    if (s && s.expiresAt > now) sessions.set(tok, s);
  }
})();
function createSessionObj(s) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Object.assign({}, s, { expiresAt: Date.now() + SESSION_TTL_MS }));
  saveDb();
  return token;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    'hb_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000));
}
function sessionOf(req) {
  const token = parseCookies(req).hb_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    if (sessions.delete(token)) saveDb();
    return null;
  }
  return s;
}
function requireAdmin(req, res, next) {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'not_authenticated' });
  if (s.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  req.session = s;
  next();
}
/* Auth khusus bot Telegram: header x-bot-token harus sama dengan env BOT_API_TOKEN */
const BOT_API_TOKEN = String(process.env.BOT_API_TOKEN || '').trim();
function requireBot(req, res, next) {
  if (!BOT_API_TOKEN) return res.status(500).json({ ok: false, msg: 'BOT_API_TOKEN belum diset di server.' });
  if (req.headers['x-bot-token'] !== BOT_API_TOKEN)
    return res.status(403).json({ ok: false, msg: 'Token bot tidak valid.' });
  next();
}
/* Regular logged-in users (and admin). Suspended accounts are rejected. */
function requireUser(req, res, next) {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'not_authenticated' });
  if (s.role === 'admin') {
    req.session = s;
    req.user = null;
    return next();
  }
  const u = db.users.find(x => x.id === s.userId);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (u.suspended) return res.status(403).json({ error: 'account_suspended' });
  req.session = s;
  req.user = u;
  next();
}
setInterval(() => {
  const t = Date.now();
  let changed = false;
  for (const [k, s] of sessions) if (!s || s.expiresAt < t) { sessions.delete(k); changed = true; }
  if (changed) saveDb();
}, 60 * 60 * 1000).unref();

/* ------------------------- rate limit (bridge) --------------------------- */
const rateHits = new Map(); // keyId -> [timestamps]
const limitedToday = new Map(); // keyId -> 'YYYY-MM-DD' of last 429 (honest "limit habis" metric)
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function rateLimited(keyId) {
  const t = Date.now();
  let arr = rateHits.get(keyId) || [];
  arr = arr.filter(x => t - x < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    rateHits.set(keyId, arr);
    return true;
  }
  arr.push(t);
  rateHits.set(keyId, arr);
  return false;
}

/* ------------------------------ app setup -------------------------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

function bridgeError(res, status, message) {
  return res.status(status).json({ error: { message, type: 'invalid_request_error' } });
}

/* Bridge-key auth for /v1/*. One key = one provider. */
function requireBridgeKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return bridgeError(res, 401, 'Missing Authorization: Bearer hb-... header.');
  const token = m[1].trim();
  const key = db.keys.find(k => k.token === token);
  if (!key) return bridgeError(res, 401, 'Invalid API key.');
  if (key.revoked) return bridgeError(res, 401, 'This API key has been revoked.');
  if (key.userId) {
    const owner = db.users.find(u => u.id === key.userId);
    if (!owner) return bridgeError(res, 401, 'Key owner account no longer exists.');
    if (owner.suspended) return bridgeError(res, 403, 'Key owner account is suspended.');
    if (planExpired(owner)) return bridgeError(res, 402, 'Durasi paket habis. Perpanjang dulu ya.');
  }
  if (rateLimited(key.id)) {
    limitedToday.set(key.id, todayStr());
    res.set('Retry-After', '60');
    return bridgeError(res, 429, 'Rate limit exceeded: max 60 requests per minute for this key.');
  }
  if (key.tokenQuota > 0) {
    const st = keyStats(key.id);
    if (st.totalTokens >= key.tokenQuota) {
      return bridgeError(res, 429, 'Kuota token key ini sudah habis (' + key.tokenQuota.toLocaleString('id-ID') + ' token).');
    }
  }
  let provider = db.providers.find(p => p.id === key.providerId);
  if (!provider && key.providerId === 'custom' && key.userId) {
    // BYOK: key terikat ke provider milik user sendiri.
    const keyOwner = db.users.find(u => u.id === key.userId);
    provider = customProviderOf(keyOwner);
  }
  if (key.mode === 'worker') {
    // Worker-mode keys are answered by a connected worker, not a provider.
    req.bridgeKey = key;
    req.provider = null;
    return next();
  }
  if (!provider) return bridgeError(res, 401, 'The provider bound to this key no longer exists.');
  req.bridgeKey = key;
  req.provider = provider;
  next();
}

function recordUsage(keyId, model, promptTokens, completionTokens, streamed, via) {
  const entry = {
    keyId,
    ts: nowIso(),
    model: model || 'unknown',
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    streamed: !!streamed
  };
  if (via) entry.via = via;
  db.usage.push(entry);
  // keep the log bounded: last 50k entries
  if (db.usage.length > 50000) db.usage.splice(0, db.usage.length - 50000);
  const k = db.keys.find(x => x.id === keyId);
  if (k) k.lastUsedAt = nowIso();
  saveDb();
}

/* ==================== activity log (admin monitoring) ===================== */
/* In-memory, bounded ke 10k entri terakhir. Tidak disimpan ke DB supaya
 * file data.json tidak membengkak. */
const activities = [];
const MAX_ACTIVITIES = 10000;
const ACT_TYPES = ['register', 'login', 'login_failed', 'logout', 'key_created',
  'key_deleted', 'api_chat', 'api_models', 'admin_action'];
function logActivity(type, o) {
  o = o || {};
  activities.push({
    id: uid('act_'),
    ts: nowIso(),
    type: type,
    actor: o.actor || null, // 'admin' bila aksi dilakukan admin
    userId: o.userId || null,
    email: o.email || null,
    ip: o.ip || null,
    keyId: o.keyId || null,
    keyName: o.keyName || null,
    model: o.model || null,
    promptTokens: o.promptTokens || 0,
    completionTokens: o.completionTokens || 0,
    detail: o.detail || null
  });
  if (activities.length > MAX_ACTIVITIES) activities.splice(0, activities.length - MAX_ACTIVITIES);
}
/* Catat pemakaian API dari sebuah bridge key (resolve pemilik key). */
function logKeyUsage(req, key, endpoint, model, pt, ct) {
  const owner = key.userId ? db.users.find(u => u.id === key.userId) : null;
  logActivity(endpoint === 'models' ? 'api_models' : 'api_chat', {
    userId: key.userId || null,
    email: owner ? owner.email : (key.userId ? '(akun dihapus)' : 'admin'),
    ip: clientIp(req),
    keyId: key.id,
    keyName: key.name,
    model: model || null,
    promptTokens: pt || 0,
    completionTokens: ct || 0,
    detail: endpoint === 'models' ? 'GET /v1/models' : 'POST /v1/chat/completions'
  });
}

/* Catat aksi admin (actor = 'admin'). */
function adminLog(req, detail, o) {
  o = o || {};
  logActivity('admin_action', Object.assign({
    actor: 'admin',
    email: (req.session && req.session.email) || ADMIN_EMAIL,
    ip: clientIp(req),
    detail: detail
  }, o));
}

/* Upstream /models probe used when adding/testing a provider. */
async function fetchUpstreamModels(baseUrl, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(normBaseUrl(baseUrl) + '/models', {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('upstream responded HTTP ' + r.status);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : []);
    const ids = arr.map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    return { ok: true, models: ids };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'connection timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* BYOK: provider milik user sendiri (diatur di halaman Pengaturan).
 * Dibangun sebagai objek mirip provider agar seluruh alur chat
 * (baseUrl, key, models) bisa dipakai ulang tanpa perubahan. */
function customProviderOf(user) {
  const c = user && user.customProvider;
  if (!c || !c.baseUrl || !c.apiKey) return null;
  return { id: 'custom', name: 'Provider Saya', baseUrl: c.baseUrl, key: c.apiKey, models: c.models || [] };
}

/* ============================ public: health ============================= */
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'hestia-bridge' }));

/* ==================== auth: register + login (admin & user) ============ */
const MAX_PER_DEVICE = 1; // 1 device = 1 Gmail, pendaftar ke-2 langsung ditolak
function planExpired(u) {
  if (!u || u.role === 'admin') return false;
  return !u.planExpiresAt || u.planExpiresAt < Date.now();
}
const BLOCKED_DOMAINS = new Set(['hotmail.com', 'hotmail.co.id', 'outlook.com', 'outlook.co.id', 'live.com', 'live.co.id', 'msn.com']);
const TEMP_DOMAINS = new Set(('tempmail.com temp-mail.org guerrillamail.com guerrillamail.org 10minutemail.com 10minutemail.net ' +
  'mailinator.com yopmail.com yopmail.fr trashmail.com throwawaymail.com getnada.com mohmal.com emailondeck.com ' +
  'tempail.com fakemail.net dispostable.com maildrop.cc harakirimail.com anonbox.net burnermail.io crazymailing.com ' +
  'dashmail.io dropmail.me fakeinbox.com incognitomail.org spamgourmet.com tmpmail.org deadaddress.com moakt.com ' +
  'tempmailo.com mailnesia.com mintemail.com sharklasers.com spambog.com teleworm.us veryrealemail.com ' +
  'e4ward.com mailnull.com spambox.us mytrashmail.com pookmail.com sogetthis.com zippymail.info').split(' '));
function emailCheck(email) {
  const m = String(email || '').trim().toLowerCase().match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  if (!m) return { ok: false, msg: 'Format email tidak valid.' };
  const d = m[2];
  if (BLOCKED_DOMAINS.has(d)) return { ok: false, msg: 'Hotmail/Outlook diblokir. Pakai Gmail ya.' };
  if (TEMP_DOMAINS.has(d)) return { ok: false, msg: 'Email sementara diblokir.' };
  if (d !== 'gmail.com') return { ok: false, msg: 'Hanya Gmail yang bisa daftar.' };
  return { ok: true, email: m[1] + '@' + d };
}
function usersOnDevice(fp) {
  if (!fp) return [];
  return db.users.filter(u => u.role !== 'admin' && u.deviceFingerprint === fp);
}

/* --------------------------- Email OTP --------------------------------- */
const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || '').trim();
const SMTP_USER = (process.env.SMTP_USER || 'hestia.sri.rosee@gmail.com').trim();
const APP_URL = (process.env.APP_URL || 'https://hestia-bridge-production.up.railway.app').trim();

// Kirim email via SendGrid HTTP API (Railway memblokir SMTP).
async function sendOtpEmail(to, code) {
  if (!SENDGRID_API_KEY) throw new Error('Layanan email belum aktif.');
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: SMTP_USER, name: 'Hestia Bridge' },
    subject: 'Kode Verifikasi Hestia Bridge: ' + code,
    content: [{ type: 'text/html', value: otpEmailHtml(code) }]
  };
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SENDGRID_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('SendGrid ' + r.status + ': ' + t.slice(0, 120));
  }
}
const mailerReady = () => !!SENDGRID_API_KEY;

// OTP: email -> { code, expiresAt, verified, attempts }
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 menit
const OTP_RESEND_MS = 30 * 1000;   // kirim ulang min 30 detik

function otpEmailHtml(code) {
  return '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f6f1fb;border-radius:16px;overflow:hidden">' +
    '<div style="background:linear-gradient(135deg,#a855f7,#ec4899);padding:28px 24px;text-align:center">' +
    '<img src="' + APP_URL + '/logo.jpg" alt="Hestia Bridge" width="72" height="72" style="border-radius:18px">' +
    '<h2 style="color:#fff;margin:12px 0 0;font-size:20px">Hestia Bridge</h2>' +
    '<p style="color:#f5e6ff;margin:6px 0 0;font-size:13px">Kode Verifikasi Pendaftaran</p></div>' +
    '<div style="padding:28px 24px;text-align:center;background:#fff">' +
    '<p style="color:#555;font-size:14px;margin:0 0 16px">Masukkan kode berikut untuk menyelesaikan pendaftaran akunmu:</p>' +
    '<div style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#7c3aed;margin:0 0 16px">' + code + '</div>' +
    '<p style="color:#999;font-size:12px;margin:0">Kode berlaku 10 menit. Jangan bagikan ke siapa pun.</p></div>' +
    '<div style="padding:16px;text-align:center;background:#f6f1fb">' +
    '<p style="color:#aaa;font-size:11px;margin:0">— Tim Hestia Bridge</p></div></div>';
}

app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body || {};
  const chk = emailCheck(email);
  if (!chk.ok) return res.status(400).json({ error: chk.msg });
  const em = chk.email;
  if (db.users.some(u => u.email === em)) {
    return res.status(400).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
  }
  if (!mailerReady()) return res.status(500).json({ error: 'Layanan email belum aktif.' });
  const now = Date.now();
  const prev = otpStore.get(em);
  if (prev && now - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (now - prev.sentAt)) / 1000);
    return res.status(429).json({ error: 'Tunggu ' + wait + ' detik sebelum kirim ulang.' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(em, { code, expiresAt: now + OTP_TTL_MS, sentAt: now, verified: false, attempts: 0 });
  try {
    await sendOtpEmail(em, code);
    res.json({ ok: true });
  } catch (e) {
    otpStore.delete(em);
    const msg = (e && e.message) || 'unknown';
    console.error('[OTP] sendGrid gagal:', msg);
    res.status(500).json({ error: 'Gagal mengirim email: ' + msg });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body || {};
  const chk = emailCheck(email);
  if (!chk.ok) return res.status(400).json({ error: chk.msg });
  const em = chk.email;
  const rec = otpStore.get(em);
  if (!rec) return res.status(400).json({ error: 'Belum ada kode dikirim. Minta kode dulu.' });
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(em);
    return res.status(400).json({ error: 'Kode kedaluwarsa. Minta kode baru.' });
  }
  rec.attempts++;
  if (rec.attempts > 5) {
    otpStore.delete(em);
    return res.status(400).json({ error: 'Terlalu banyak percobaan. Minta kode baru.' });
  }
  if (String(code || '').trim() !== rec.code) {
    return res.status(400).json({ error: 'Kode salah. Coba lagi.' });
  }
  rec.verified = true;
  res.json({ ok: true });
});

/* --------------------------- Lupa kata sandi --------------------------- */
const resetStore = new Map(); // email -> { code, expiresAt, sentAt, verified, attempts }

function resetEmailHtml(code) {
  return '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f6f1fb;border-radius:16px;overflow:hidden">' +
    '<div style="background:linear-gradient(135deg,#a855f7,#ec4899);padding:28px 24px;text-align:center">' +
    '<img src="' + APP_URL + '/logo.jpg" alt="Hestia Bridge" width="72" height="72" style="border-radius:18px">' +
    '<h2 style="color:#fff;margin:12px 0 0;font-size:20px">Hestia Bridge</h2>' +
    '<p style="color:#f5e6ff;margin:6px 0 0;font-size:13px">Kode Reset Kata Sandi</p></div>' +
    '<div style="padding:28px 24px;text-align:center;background:#fff">' +
    '<p style="color:#555;font-size:14px;margin:0 0 16px">Masukkan kode berikut untuk mereset kata sandimu:</p>' +
    '<div style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#7c3aed;margin:0 0 16px">' + code + '</div>' +
    '<p style="color:#999;font-size:12px;margin:0">Kode berlaku 10 menit. Jika kamu tidak meminta reset, abaikan email ini.</p></div>' +
    '<div style="padding:16px;text-align:center;background:#f6f1fb">' +
    '<p style="color:#aaa;font-size:11px;margin:0">— Tim Hestia Bridge</p></div></div>';
}

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!em) return res.status(400).json({ error: 'Isi email dulu.' });
  const u = db.users.find(x => x.email === em);
  // Selalu balas OK agar tidak membocorkan email mana yang terdaftar.
  if (!u) return res.json({ ok: true });
  if (!mailerReady()) return res.status(500).json({ error: 'Layanan email belum aktif.' });
  const now = Date.now();
  const prev = resetStore.get(em);
  if (prev && now - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (now - prev.sentAt)) / 1000);
    return res.status(429).json({ error: 'Tunggu ' + wait + ' detik sebelum kirim ulang.' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  resetStore.set(em, { code, expiresAt: now + OTP_TTL_MS, sentAt: now, verified: false, attempts: 0 });
  try {
    const body = {
      personalizations: [{ to: [{ email: em }] }],
      from: { email: SMTP_USER, name: 'Hestia Bridge' },
      subject: 'Kode Reset Kata Sandi Hestia Bridge: ' + code,
      content: [{ type: 'text/html', value: resetEmailHtml(code) }]
    };
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('SendGrid ' + r.status);
    res.json({ ok: true });
  } catch (e) {
    resetStore.delete(em);
    res.status(500).json({ error: 'Gagal mengirim email. Coba lagi.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, password } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  const rec = resetStore.get(em);
  if (!rec) return res.status(400).json({ error: 'Minta kode reset dulu.' });
  if (Date.now() > rec.expiresAt) {
    resetStore.delete(em);
    return res.status(400).json({ error: 'Kode kedaluwarsa. Minta kode baru.' });
  }
  rec.attempts++;
  if (rec.attempts > 5) {
    resetStore.delete(em);
    return res.status(400).json({ error: 'Terlalu banyak percobaan. Minta kode baru.' });
  }
  if (String(code || '').trim() !== rec.code) {
    return res.status(400).json({ error: 'Kode salah. Coba lagi.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Sandi minimal 6 karakter.' });
  }
  const u = db.users.find(x => x.email === em);
  if (!u) return res.status(400).json({ error: 'Akun tidak ditemukan.' });
  u.passwordHash = bcrypt.hashSync(String(password), 10);
  saveDb();
  resetStore.delete(em);
  res.json({ ok: true });
});
app.post('/api/auth/register', async (req, res) => {
  const { email, password, fingerprint } = req.body || {};
  const chk = emailCheck(email);
  if (!chk.ok) return res.status(400).json({ error: chk.msg });
  const em = chk.email;
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Sandi minimal 6 karakter.' });
  }
  if (db.users.some(u => u.email === em)) {
    return res.status(400).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
  }
  const otp = otpStore.get(em);
  if (!otp || !otp.verified || Date.now() > otp.expiresAt) {
    return res.status(400).json({ error: 'Verifikasi email dulu dengan kode OTP.' });
  }
  otpStore.delete(em);
  const fp = String(fingerprint || '').slice(0, 128);
  let suspended = false;
  const sameDevice = usersOnDevice(fp);
  if (sameDevice.length >= MAX_PER_DEVICE) {
    // 1 device = 1 Gmail: tolak pendaftar baru dari device yang sudah punya akun.
    return res.status(400).json({ error: 'Device ini sudah terdaftar. 1 device hanya untuk 1 Gmail.' });
  }
  const user = {
    id: uid('user_'),
    email: em,
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: (ADMIN_EMAIL && em === ADMIN_EMAIL) ? 'admin' : 'user',
    deviceFingerprint: fp || null,
    suspended,
    plan: 'gratis',
    planExpiresAt: Date.now() + PLAN_DURATIONS.gratis,
    createdAt: nowIso(),
    lastIp: clientIp(req) || null
  };
  db.users.push(user);
  saveDb();
  logActivity('register', { userId: user.id, email: user.email, ip: clientIp(req), detail: 'akun baru mendaftar' });
  const token = createSessionObj({ role: user.role, userId: user.id, email: user.email });
  setSessionCookie(res, token);
  res.json({ ok: true, role: user.role, email: user.email, suspended: user.suspended });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  // Admin via env (tetap seperti semula).
  if (ADMIN_EMAIL && ADMIN_PASSWORD_HASH && em === ADMIN_EMAIL) {
    let ok = false;
    try { ok = await bcrypt.compare(String(password || ''), ADMIN_PASSWORD_HASH); }
    catch (e) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'Email atau password salah.' });
    const token = createSessionObj({ role: 'admin', userId: 'admin', email: ADMIN_EMAIL });
    setSessionCookie(res, token);
    logActivity('login', { actor: 'admin', email: ADMIN_EMAIL, ip: clientIp(req), detail: 'admin login' });
    return res.json({ ok: true, role: 'admin', email: ADMIN_EMAIL });
  }
  // Pengguna terdaftar.
  const u = db.users.find(x => x.email === em);
  let ok = false;
  try { ok = !!u && await bcrypt.compare(String(password || ''), u.passwordHash || ''); }
  catch (e) { ok = false; }
  if (!u) {
    logActivity('login_failed', { email: em, ip: clientIp(req), detail: 'email belum terdaftar' });
    return res.status(401).json({ error: 'Email belum terdaftar.' });
  }
  if (!ok) {
    logActivity('login_failed', { userId: u.id, email: u.email, ip: clientIp(req), detail: 'sandi salah' });
    return res.status(401).json({ error: 'Sandi anda salah.' });
  }
  if (u.suspended) {
    logActivity('login_failed', { userId: u.id, email: u.email, ip: clientIp(req), detail: 'akun di-suspend' });
    return res.status(403).json({ error: 'Akun kamu di-suspend. Hubungi admin.' });
  }
  u.lastIp = clientIp(req) || u.lastIp || null;
  saveDb();
  const token = createSessionObj({ role: u.role, userId: u.id, email: u.email });
  setSessionCookie(res, token);
  logActivity('login', { userId: u.id, email: u.email, ip: clientIp(req), detail: 'user login' });
  res.json({ ok: true, role: u.role, email: u.email, suspended: !!u.suspended });
});
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).hb_session;
  const s = token ? sessions.get(token) : null;
  if (token && sessions.delete(token)) saveDb();
  if (s) logActivity('logout', {
    actor: s.role === 'admin' ? 'admin' : null,
    userId: s.role === 'admin' ? null : (s.userId || null),
    email: s.email || null, detail: s.role === 'admin' ? 'admin logout' : 'user logout'
  });
  res.setHeader('Set-Cookie', 'hb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'not_authenticated' });
  if (s.role === 'admin') {
    return res.json({ ok: true, role: 'admin', email: s.email || ADMIN_EMAIL });
  }
  const u = db.users.find(x => x.id === s.userId);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  res.json({ ok: true, role: u.role, email: u.email, suspended: !!u.suspended });
});

/* ========================== admin: providers ============================= */
function publicProvider(p) {
  return {
    id: p.id, name: p.name, baseUrl: p.baseUrl,
    models: p.models || [], modelCount: (p.models || []).length,
    createdAt: p.createdAt, lastCheckedAt: p.lastCheckedAt || null
  };
}
app.get('/api/providers', requireAdmin, (req, res) => {
  res.json({ providers: db.providers.map(publicProvider) });
});
app.post('/api/providers', requireAdmin, async (req, res) => {
  const { name, baseUrl, apiKey } = req.body || {};
  if (!name || !baseUrl || !apiKey) {
    return res.status(400).json({ error: 'name, baseUrl and apiKey are required' });
  }
  const probe = await fetchUpstreamModels(baseUrl, apiKey);
  if (!probe.ok) return res.status(502).json({ error: 'upstream_unreachable', detail: probe.error });
  const p = {
    id: uid('prov_'),
    name: String(name).trim(),
    baseUrl: normBaseUrl(baseUrl),
    key: String(apiKey).trim(),
    models: probe.models,
    createdAt: nowIso(),
    lastCheckedAt: nowIso()
  };
  db.providers.push(p);
  saveDb();
  adminLog(req, 'Tambah provider "' + p.name + '" (' + (p.models || []).length + ' model)');
  res.json({ provider: publicProvider(p) });
});
app.post('/api/providers/:id/test', requireAdmin, async (req, res) => {
  const p = db.providers.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'provider_not_found' });
  const probe = await fetchUpstreamModels(p.baseUrl, p.key);
  if (probe.ok) {
    p.models = probe.models;
    p.lastCheckedAt = nowIso();
    saveDb();
  }
  res.json(probe.ok
    ? { ok: true, modelCount: probe.models.length, models: probe.models }
    : { ok: false, error: probe.error });
});
app.delete('/api/providers/:id', requireAdmin, (req, res) => {
  const i = db.providers.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'provider_not_found' });
  const pid = db.providers[i].id;
  const pname = db.providers[i].name;
  // revoke (not delete) bound keys so usage history stays intact
  db.keys.forEach(k => { if (k.providerId === pid && !k.revoked) k.revoked = true; });
  db.providers.splice(i, 1);
  saveDb();
  adminLog(req, 'Hapus provider "' + pname + '" (key terikat di-revoke)');
  res.json({ ok: true });
});

/* ============================ admin: keys ================================ */
function keyStats(keyId) {
  let requests = 0, prompt = 0, completion = 0;
  for (const u of db.usage) {
    if (u.keyId !== keyId) continue;
    requests++;
    prompt += u.promptTokens || 0;
    completion += u.completionTokens || 0;
  }
  return { requests, promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}
app.get('/api/keys', requireAdmin, (req, res) => {
  res.json({
    keys: db.keys.map(k => {
      const p = db.providers.find(x => x.id === k.providerId);
      const w = k.workerId ? db.workers.find(x => x.id === k.workerId) : null;
      const owner = k.userId ? db.users.find(x => x.id === k.userId) : null;
      return {
        id: k.id, name: k.name, masked: maskKey(k.token),
        mode: k.mode || 'provider',
        providerId: k.providerId, providerName: k.providerId === 'custom' ? 'Provider Saya' : (p ? p.name : '(deleted)'),
        model: k.model || null,
        workerId: k.workerId || null, workerName: w ? w.name : null,
        userId: k.userId || null, ownerEmail: owner ? owner.email : 'admin',
        createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null,
        revoked: !!k.revoked, tokenQuota: k.tokenQuota || null, stats: keyStats(k.id)
      };
    })
  });
});
app.post('/api/keys', requireAdmin, (req, res) => {
  const { name, providerId, mode, workerId, tokenQuota, model } = req.body || {};
  const m = mode === 'worker' ? 'worker' : 'provider';
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  let pid = providerId || null;
  let pmodel = null;
  if (m === 'provider') {
    if (!pid) return res.status(400).json({ error: 'name and providerId are required' });
    const p = db.providers.find(x => x.id === pid);
    if (!p) return res.status(404).json({ error: 'provider_not_found' });
    // Validate model against provider's model list if provided.
    if (model && String(model).trim()) {
      const models = p.models || [];
      if (models.length && !models.includes(String(model).trim())) {
        return res.status(400).json({ error: 'model_not_found' });
      }
      pmodel = String(model).trim();
    }
  }
  // Worker-mode keys can be bound to exactly one worker at creation.
  let wid = null;
  if (m === 'worker' && workerId) {
    const w = db.workers.find(x => x.id === workerId);
    if (!w) return res.status(400).json({ error: 'worker_not_found' });
    wid = w.id;
  }
  const k = {
    id: uid('key_'),
    token: genKeyToken(m),
    name: String(name).trim(),
    mode: m,
    providerId: pid,
    workerId: wid,
    model: pmodel, // default model for this key (nullable)
    userId: null, // admin-owned
    tokenQuota: tokenQuota > 0 ? Math.floor(tokenQuota) : null,
    createdAt: nowIso(),
    lastUsedAt: null,
    revoked: false
  };
  db.keys.push(k);
  saveDb();
  // Full token is returned exactly once, at creation.
  res.json({ id: k.id, name: k.name, token: k.token, mode: m, providerId: pid, workerId: wid, model: pmodel, createdAt: k.createdAt });
});
app.get('/api/keys/:id/reveal', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  res.json({ id: k.id, token: k.token });
});
app.post('/api/keys/:id/revoke', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  k.revoked = true;
  saveDb();
  adminLog(req, 'Revoke key "' + (k.name || k.id) + '"', { keyId: k.id, keyName: k.name, userId: k.userId || null });
  res.json({ ok: true });
});
app.post('/api/keys/:id/restore', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  k.revoked = false;
  saveDb();
  res.json({ ok: true });
});
app.patch('/api/keys/:id', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  const { name, tokenQuota } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  k.name = String(name).trim().slice(0, 60);
  k.tokenQuota = tokenQuota > 0 ? Math.floor(tokenQuota) : null;
  saveDb();
  res.json({ ok: true, id: k.id, name: k.name, tokenQuota: k.tokenQuota });
});
app.post('/api/keys/:id/rotate', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  k.token = genKeyToken(k.mode);
  saveDb();
  res.json({ id: k.id, token: k.token, masked: maskKey(k.token) });
});
app.post('/api/keys/:id/reset-usage', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  db.usage = db.usage.filter(u => u.keyId !== k.id);
  k.lastUsedAt = null;
  saveDb();
  res.json({ ok: true });
});
app.delete('/api/keys/:id', requireAdmin, (req, res) => {
  const i = db.keys.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'key_not_found' });
  const k = db.keys[i];
  db.keys.splice(i, 1);
  saveDb();
  adminLog(req, 'Hapus key "' + (k.name || k.id) + '" permanen', { keyId: k.id, keyName: k.name, userId: k.userId || null });
  res.json({ ok: true });
});
/* Bind (or rebind) a worker-mode key to exactly one worker.
 * Requests through the key are then only answerable by that worker.
 * Send { workerId: null } to unbind. */
app.post('/api/keys/:id/bind', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  if (k.mode !== 'worker') return res.status(400).json({ error: 'key_not_worker_mode' });
  const { workerId } = req.body || {};
  if (workerId) {
    const w = db.workers.find(x => x.id === workerId);
    if (!w) return res.status(400).json({ error: 'worker_not_found' });
    k.workerId = w.id;
  } else {
    k.workerId = null;
  }
  saveDb();
  const w = k.workerId ? db.workers.find(x => x.id === k.workerId) : null;
  res.json({ ok: true, id: k.id, workerId: k.workerId, workerName: w ? w.name : null });
});

/* ==================== user: my keys (self-service, no limits) ============ */
function userKeyShape(k) {
  const w = k.workerId ? db.workers.find(x => x.id === k.workerId) : null;
  const p = k.providerId ? db.providers.find(x => x.id === k.providerId) : null;
  return {
    id: k.id, name: k.name, masked: maskKey(k.token),
    mode: k.mode || 'provider',
    providerId: k.providerId,
    model: k.model || null,
    supportedModels: p ? (p.models || []) : [],
    modelMeta: p ? (p.modelMeta || {}) : {},
    workerId: k.workerId || null, workerName: w ? w.name : null,
    workerOnline: w ? workerOnline(w) : null,
    createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null,
    revoked: !!k.revoked, tokenQuota: k.tokenQuota || null, stats: keyStats(k.id)
  };
}
/* Ownership check for /api/my-keys/:id. Returns the key or sends 404/403. */
function ownKey(req, res) {
  const myId = req.user ? req.user.id : null;
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) { res.status(404).json({ error: 'key_not_found' }); return null; }
  if ((k.userId || null) !== myId) { res.status(403).json({ error: 'not_your_key' }); return null; }
  return k;
}
app.get('/api/my-keys', requireUser, (req, res) => {
  const myId = req.user ? req.user.id : null;
  res.json({ keys: db.keys.filter(k => (k.userId || null) === myId).map(userKeyShape) });
});
app.post('/api/my-keys', requireUser, (req, res) => {
  const { name, mode, providerId, workerId, tokenQuota, model } = req.body || {};
  const m = mode === 'worker' ? 'worker' : 'provider';
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  let pid = null, wid = null, pmodel = null;
  if (m === 'provider') {
    // BYOK: 'custom' = provider milik user sendiri (diatur di Pengaturan).
    // Gateway: tanpa providerId = pakai provider default (model jualan Hestia).
    let p;
    if (!providerId) {
      p = db.providers.find(x => x.id === 'gateway-test')
        || db.providers.find(x => !x.disabled)
        || db.providers[0];
    } else {
      p = providerId === 'custom'
        ? customProviderOf(req.user)
        : db.providers.find(x => x.id === providerId);
    }
    if (!p) return res.status(400).json({ error: providerId === 'custom' ? 'custom_provider_not_configured' : 'provider_not_found' });
    pid = providerId === 'custom' ? 'custom' : p.id;
    // Validate model against provider's model list if provided.
    if (model && String(model).trim()) {
      const models = p.models || [];
      if (models.length && !models.includes(String(model).trim())) {
        return res.status(400).json({ error: 'model_not_found' });
      }
      pmodel = String(model).trim();
    }
  } else {
    const w = db.workers.find(x => x.id === workerId);
    if (!w) return res.status(400).json({ error: 'worker_not_found' });
    // A key may only bind to the user's own worker or an admin worker.
    const myId = req.user ? req.user.id : null;
    const ownerId = w.userId || null;
    if (ownerId !== myId && ownerId !== null) {
      return res.status(403).json({ error: 'not_your_worker' });
    }
    wid = w.id;
  }
  // No limits on how many keys a user may create (Hestia's decision).
  const k = {
    id: uid('key_'),
    token: genKeyToken(m),
    name: String(name).trim().slice(0, 60),
    mode: m,
    providerId: pid,
    workerId: wid,
    model: pmodel, // default model for this key (nullable)
    userId: req.user ? req.user.id : null,
    tokenQuota: tokenQuota > 0 ? Math.floor(tokenQuota) : null,
    createdAt: nowIso(),
    lastUsedAt: null,
    revoked: false
  };
  db.keys.push(k);
  saveDb();
  logActivity('key_created', {
    userId: req.user ? req.user.id : null,
    email: req.user ? req.user.email : null,
    ip: clientIp(req),
    keyId: k.id, keyName: k.name, model: pmodel,
    detail: 'Buat key "' + k.name + '" (' + (m === 'worker' ? 'worker' : 'provider: ' + String(pid)) + (pmodel ? ', model: ' + pmodel : '') + ')'
  });
  // Full token is returned exactly once, at creation.
  res.json({ id: k.id, name: k.name, token: k.token, mode: m, providerId: pid, workerId: wid, model: pmodel });
});
app.get('/api/my-keys/:id/reveal', requireUser, (req, res) => {
  const k = ownKey(req, res);
  if (!k) return;
  res.json({ id: k.id, token: k.token });
});
app.delete('/api/my-keys/:id', requireUser, (req, res) => {
  const k = ownKey(req, res);
  if (!k) return;
  db.keys = db.keys.filter(x => x.id !== k.id);
  db.usage = db.usage.filter(u => u.keyId !== k.id);
  saveDb();
  logActivity('key_deleted', {
    userId: req.user ? req.user.id : null,
    email: req.user ? req.user.email : null,
    ip: clientIp(req),
    keyId: k.id, keyName: k.name,
    detail: 'Hapus key "' + k.name + '"'
  });
  res.json({ ok: true });
});
app.patch('/api/my-keys/:id', requireUser, (req, res) => {
  const k = ownKey(req, res);
  if (!k) return;
  if (k.mode !== 'provider') return res.status(400).json({ error: 'model_not_applicable' });
  const { model } = req.body || {};
  if (!model || !String(model).trim()) return res.status(400).json({ error: 'model is required' });
  // Resolve provider yang terikat ke key ini (validasi model terhadap daftarnya).
  const p = k.providerId === 'custom'
    ? customProviderOf(req.user)
    : db.providers.find(x => x.id === k.providerId);
  if (!p) return res.status(400).json({ error: k.providerId === 'custom' ? 'custom_provider_not_configured' : 'provider_not_found' });
  const m = String(model).trim();
  const models = p.models || [];
  if (models.length && !models.includes(m)) {
    return res.status(400).json({ error: 'model_not_found' });
  }
  const old = k.model || null;
  k.model = m;
  saveDb();
  logActivity('key_model_changed', {
    userId: req.user ? req.user.id : null,
    email: req.user ? req.user.email : null,
    ip: clientIp(req),
    keyId: k.id, keyName: k.name, model: m,
    detail: 'Ganti model key "' + k.name + '" dari ' + (old || '(kosong)') + ' ke ' + m
  });
  res.json({ ok: true, key: userKeyShape(k) });
});

/* ============ user: safe provider & worker lists (no secrets) ============ */
app.get('/api/my-providers', requireUser, (req, res) => {
  // User hanya melihat "Provider Saya" miliknya sendiri.
  // Provider admin TIDAK ditampilkan ke user (privasi, masing-masing).
  const list = [];
  // BYOK: tampilkan "Provider Saya" bila user sudah mengaturnya di Agent Pilihan.
  const cp = customProviderOf(req.user);
  if (cp) list.push({ id: 'custom', name: 'Provider Saya', models: cp.models || [] });
  res.json({ providers: list });
});

/* ============ user: BYOK provider sendiri (halaman Pengaturan) ============
 * User mengisi Base URL + API key miliknya sendiri, lalu Bridge memakai
 * kredensial itu saat key terikat ke "Provider Saya". Hestia tidak nanggung. */
app.post('/api/my-provider/check', requireUser, async (req, res) => {
  if (!req.user) return res.status(403).json({ ok: false, error: 'user_only' });
  const { baseUrl, apiKey } = req.body || {};
  if (!baseUrl || !String(baseUrl).trim() || !apiKey || !String(apiKey).trim()) {
    return res.status(400).json({ ok: false, error: 'baseUrl and apiKey are required' });
  }
  const probe = await fetchUpstreamModels(String(baseUrl).trim(), String(apiKey).trim());
  if (!probe.ok) return res.json({ ok: false, error: probe.error });
  res.json({ ok: true, models: probe.models });
});
app.get('/api/my-provider', requireUser, (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'user_only' });
  const c = req.user.customProvider || null;
  if (!c) return res.json({ configured: false });
  res.json({
    configured: true,
    baseUrl: c.baseUrl,
    model: c.model || null,
    models: c.models || [],
    keyMasked: maskKey(c.apiKey),
    checkedAt: c.checkedAt || null
  });
});
app.post('/api/my-provider', requireUser, async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'user_only' });
  let { baseUrl, apiKey, model } = req.body || {};
  baseUrl = baseUrl && String(baseUrl).trim() ? String(baseUrl).trim() : null;
  apiKey = apiKey && String(apiKey).trim() ? String(apiKey).trim() : null;
  const existing = req.user.customProvider || null;
  // API key boleh dikosongkan = pakai key yang sudah tersimpan.
  if (!apiKey && existing && existing.apiKey) apiKey = existing.apiKey;
  if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required' });
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  // Validasi dulu: pastikan URL + key benar-benar bisa dihubungi.
  const probe = await fetchUpstreamModels(baseUrl, apiKey);
  if (!probe.ok) return res.status(502).json({ error: 'upstream_unreachable', detail: probe.error });
  const m = model && String(model).trim() ? String(model).trim() : null;
  if (m && probe.models.length && !probe.models.includes(m)) {
    return res.status(400).json({ error: 'model_not_found' });
  }
  req.user.customProvider = {
    baseUrl: normBaseUrl(baseUrl),
    apiKey: apiKey,
    model: m,
    models: probe.models,
    checkedAt: nowIso()
  };
  saveDb();
  res.json({
    ok: true,
    baseUrl: req.user.customProvider.baseUrl,
    model: m,
    models: probe.models,
    keyMasked: maskKey(req.user.customProvider.apiKey)
  });
});
app.delete('/api/my-provider', requireUser, (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'user_only' });
  delete req.user.customProvider;
  saveDb();
  res.json({ ok: true });
});
function userWorkerShape(w) {
  // Worker tokens are NEVER exposed here.
  return {
    id: w.id, name: w.name, online: workerOnline(w),
    lastHeartbeat: w.lastHeartbeat || null, createdAt: w.createdAt
  };
}
// Workers the user may bind keys to: their own + admin's. No tokens.
app.get('/api/my-workers/available', requireUser, (req, res) => {
  const myId = req.user ? req.user.id : null;
  res.json({
    workers: db.workers
      .filter(w => (w.userId || null) === myId || (w.userId || null) === null)
      .map(userWorkerShape)
  });
});
// The user's OWN workers ("Worker Saya" section). No tokens.
app.get('/api/my-workers', requireUser, (req, res) => {
  const myId = req.user ? req.user.id : null;
  res.json({
    workers: db.workers
      .filter(w => (w.userId || null) === myId)
      .map(userWorkerShape)
  });
});
app.post('/api/my-workers', requireUser, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const w = {
    id: uid('worker_'),
    name: String(name).trim().slice(0, 60),
    token: 'wt-' + crypto.randomBytes(16).toString('hex'),
    userId: req.user ? req.user.id : null,
    createdAt: nowIso(),
    lastHeartbeat: null
  };
  db.workers.push(w);
  saveDb();
  // Full worker token is returned exactly once, at creation.
  res.json({ id: w.id, name: w.name, token: w.token, createdAt: w.createdAt });
});
/* Ownership check for /api/my-workers/:id. Returns the worker or sends 404/403. */
function ownWorker(req, res) {
  const myId = req.user ? req.user.id : null;
  const w = db.workers.find(x => x.id === req.params.id);
  if (!w) { res.status(404).json({ error: 'worker_not_found' }); return null; }
  if ((w.userId || null) !== myId) { res.status(403).json({ error: 'not_your_worker' }); return null; }
  return w;
}
app.delete('/api/my-workers/:id', requireUser, (req, res) => {
  const w = ownWorker(req, res);
  if (!w) return;
  // Unbind keys bound to this worker (mirrors admin DELETE /api/workers/:id).
  db.keys.forEach(k => { if (k.workerId === w.id) k.workerId = null; });
  db.workers = db.workers.filter(x => x.id !== w.id);
  saveDb();
  res.json({ ok: true });
});

/* ========================= admin: user management ========================= */
app.get('/api/users', requireAdmin, (req, res) => {
  res.json({
    users: db.users.map(u => ({
      id: u.id, email: u.email, role: u.role,
      createdAt: u.createdAt, suspended: !!u.suspended,
      plan: u.plan || 'gratis', planName: PLAN_NAMES[u.plan] || 'Gratis',
      planExpiresAt: u.planExpiresAt || null,
      lastIp: u.lastIp || null,
      keyCount: db.keys.filter(k => k.userId === u.id).length
    }))
  });
});
app.post('/api/users/:id/suspend', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u || u.role === 'admin') return res.status(400).json({ error: 'cannot_suspend' });
  u.suspended = true;
  saveDb();
  adminLog(req, 'Suspend pengguna ' + u.email, { userId: u.id, email: u.email });
  res.json({ ok: true });
});
app.post('/api/users/:id/unsuspend', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u || u.role === 'admin') return res.status(400).json({ error: 'cannot_unsuspend' });
  u.suspended = false;
  saveDb();
  adminLog(req, 'Buka suspend pengguna ' + u.email, { userId: u.id, email: u.email });
  res.json({ ok: true });
});
/* Perpanjang durasi user: plan = gratis|1hari|3hari|1minggu. Dipakai admin/bot setelah pembayaran. */
app.post('/api/users/:id/extend', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u || u.role === 'admin') return res.status(400).json({ error: 'user_not_found' });
  const plan = String((req.body || {}).plan || '');
  if (!PLAN_DURATIONS[plan]) return res.status(400).json({ error: 'invalid_plan' });
  const base = Math.max(Date.now(), u.planExpiresAt || 0);
  u.plan = plan;
  u.planExpiresAt = base + PLAN_DURATIONS[plan];
  saveDb();
  adminLog(req, 'Tambah durasi ' + u.email + ' → ' + (PLAN_NAMES[plan] || plan), { userId: u.id, email: u.email });
  res.json({ ok: true, plan: u.plan, planExpiresAt: u.planExpiresAt });
});
/* ============ BOT TELEGRAM: perpanjang durasi akun (auth: x-bot-token) ============ */
app.get('/api/bot/user', requireBot, (req, res) => {
  const em = String(req.query.email || '').trim().toLowerCase();
  const u = db.users.find(x => x.email === em);
  if (!u) return res.json({ ok: true, exists: false });
  res.json({ ok: true, exists: true, suspended: !!u.suspended, plan: u.plan || 'gratis', planExpiresAt: u.planExpiresAt || null });
});
app.post('/api/bot/extend', requireBot, (req, res) => {
  const { email, plan } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!em) return res.json({ ok: false, msg: 'email kosong' });
  if (!PLAN_DURATIONS[plan]) return res.json({ ok: false, msg: 'plan tidak valid' });
  const u = db.users.find(x => x.email === em);
  if (!u) return res.json({ ok: false, msg: 'akun tidak ditemukan' });
  if (u.role === 'admin') return res.json({ ok: false, msg: 'tidak bisa perpanjang akun admin' });
  const base = Math.max(Date.now(), u.planExpiresAt || 0);
  u.plan = plan;
  u.planExpiresAt = base + PLAN_DURATIONS[plan];
  saveDb();
  res.json({ ok: true, email: u.email, plan: u.plan, planName: PLAN_NAMES[u.plan] || u.plan, planExpiresAt: u.planExpiresAt });
});
/* Info paket user sendiri. */
app.get('/api/my-plan', requireUser, (req, res) => {  if (!req.user) return res.json({ plan: 'admin', planName: 'Admin', planExpiresAt: null, remainingMs: null, expired: false });
  const u = req.user;
  res.json({
    plan: u.plan || 'gratis',
    planName: PLAN_NAMES[u.plan] || 'Gratis',
    planExpiresAt: u.planExpiresAt || null,
    remainingMs: Math.max(0, (u.planExpiresAt || 0) - Date.now()),
    expired: planExpired(u),
  });
});
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const i = db.users.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'user_not_found' });
  const u = db.users[i];
  if (u.role === 'admin') return res.status(400).json({ error: 'cannot_delete_admin' });
  const keyIds = new Set(db.keys.filter(k => k.userId === u.id).map(k => k.id));
  db.keys = db.keys.filter(k => k.userId !== u.id);
  db.usage = db.usage.filter(x => !keyIds.has(x.keyId));
  db.users.splice(i, 1);
  saveDb();
  adminLog(req, 'Hapus pengguna ' + u.email + ' permanen', { userId: u.id, email: u.email });
  res.json({ ok: true });
});

/* =========================== admin: workers ============================== */
const WORKER_ONLINE_MS = 10 * 60 * 1000; // heartbeat considered fresh < 10 min
const QUEUE_EXPIRE_MS = 220 * 1000;      // pending items older than this expire
const WORKER_WAIT_MS = 55 * 1000;        // how long /v1/chat waits for an answer

function workerOnline(w) {
  return !!w.lastHeartbeat && (Date.now() - new Date(w.lastHeartbeat).getTime() < WORKER_ONLINE_MS);
}
function expireOldQueueItems() {
  const cutoff = Date.now() - QUEUE_EXPIRE_MS;
  let changed = false;
  for (const q of db.wqueue) {
    if (q.status === 'pending' && new Date(q.receivedAt).getTime() < cutoff) {
      q.status = 'expired';
      changed = true;
    }
  }
  // Keep the queue bounded: drop done/expired items older than 1 hour.
  const pruneCut = Date.now() - 60 * 60 * 1000;
  const before = db.wqueue.length;
  db.wqueue = db.wqueue.filter(q =>
    !((q.status === 'done' || q.status === 'expired') &&
      new Date(q.receivedAt).getTime() < pruneCut));
  if (changed || db.wqueue.length !== before) saveDb();
}

app.post('/api/workers', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const w = {
    id: uid('worker_'),
    name: String(name).trim().slice(0, 60),
    token: 'wt-' + crypto.randomBytes(16).toString('hex'),
    userId: null, // admin-owned
    createdAt: nowIso(),
    lastHeartbeat: null
  };
  db.workers.push(w);
  saveDb();
  // Full worker token is returned exactly once, at creation.
  res.json({ id: w.id, name: w.name, token: w.token, createdAt: w.createdAt });
});
app.get('/api/workers', requireAdmin, (req, res) => {
  res.json({
    workers: db.workers.map(w => {
      const owner = w.userId ? db.users.find(x => x.id === w.userId) : null;
      return {
        id: w.id, name: w.name, createdAt: w.createdAt,
        lastHeartbeat: w.lastHeartbeat, online: workerOnline(w),
        userId: w.userId || null, ownerEmail: owner ? owner.email : 'admin'
      };
    })
  });
});
app.delete('/api/workers/:id', requireAdmin, (req, res) => {
  const i = db.workers.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'worker_not_found' });
  const wid = db.workers[i].id;
  // unbind any keys bound to this worker
  db.keys.forEach(k => { if (k.workerId === wid) k.workerId = null; });
  db.workers.splice(i, 1);
  saveDb();
  res.json({ ok: true });
});

/* ========================= worker API (wt- token) ========================= */
function requireWorker(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return bridgeError(res, 401, 'Missing Authorization: Bearer wt-... header.');
  const token = m[1].trim();
  const w = db.workers.find(x => x.token === token);
  if (!w) return bridgeError(res, 401, 'Invalid worker token.');
  req.worker = w;
  next();
}
app.post('/v1/worker/heartbeat', requireWorker, (req, res) => {
  req.worker.lastHeartbeat = nowIso();
  saveDb();
  res.json({ ok: true });
});
/* Long-poll waiters: workerId -> [resolve fns]. When a new queue item arrives,
   waiting /v1/worker/pending?wait= requests are answered immediately. */
const pendingWaiters = new Map();
function notifyPendingWaiters(workerId) {
  const list = pendingWaiters.get(workerId);
  if (!list || !list.length) return;
  pendingWaiters.delete(workerId);
  for (const r of list) { try { r(); } catch (e) {} }
}
function getPendingFor(workerId) {
  return db.wqueue
    .filter(q => q.status === 'pending' && q.workerId === workerId)
    .map(q => ({ id: q.id, received_at: q.receivedAt }));
}
app.get('/v1/worker/pending', requireWorker, async (req, res) => {
  expireOldQueueItems();
  // Each worker only ever sees its OWN queue items (1 key = 1 worker).
  let pending = getPendingFor(req.worker.id);
  // Long-poll: ?wait=N (max 50s). Hold until work arrives or timeout,
  // so the worker answers almost instantly instead of cron-polling.
  const waitSec = Math.min(Math.max(parseInt(req.query.wait, 10) || 0, 0), 50);
  if (!pending.length && waitSec > 0) {
    let done = false;
    await new Promise(resolve => {
      const timer = setTimeout(() => { done = true; resolve(); }, waitSec * 1000);
      const arr = pendingWaiters.get(req.worker.id) || [];
      arr.push(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
      pendingWaiters.set(req.worker.id, arr);
      res.on('close', () => {
        if (!done) {
          done = true; clearTimeout(timer); resolve();
          const l = pendingWaiters.get(req.worker.id) || [];
          pendingWaiters.set(req.worker.id, l.filter(f => f !== arr[arr.length - 1]));
        }
      });
    });
    if (!res.writableEnded) pending = getPendingFor(req.worker.id);
    else return;
  }
  res.json({ pending, worker_online: true });
});
app.post('/v1/worker/claim', requireWorker, (req, res) => {
  const { id } = req.body || {};
  const q = db.wqueue.find(x => x.id === id);
  if (!q) return res.status(404).json({ error: 'queue_item_not_found' });
  if (q.workerId !== req.worker.id) return res.status(403).json({ error: 'not_your_queue_item' });
  if (q.status !== 'pending') return res.status(409).json({ error: 'already_claimed' });
  q.status = 'claimed';
  q.claimedAt = nowIso();
  saveDb();
  res.json({ request: { messages: q.messages, max_tokens: q.maxTokens, model: q.model } });
});
app.post('/v1/worker/done', requireWorker, (req, res) => {
  const { id, content } = req.body || {};
  const q = db.wqueue.find(x => x.id === id);
  if (!q) return res.status(404).json({ error: 'queue_item_not_found' });
  if (q.workerId !== req.worker.id) return res.status(403).json({ error: 'not_your_queue_item' });
  q.status = 'done';
  q.answer = String(content == null ? '' : content);
  saveDb();
  res.json({ ok: true });
});

/* ========================= admin: activity log =========================== */
/* Pantau aktivitas pengguna: login, pembuatan key, pemakaian API, aksi admin.
 * Hanya admin (requireAdmin) yang boleh akses. */
app.get('/api/admin/activities', requireAdmin, (req, res) => {
  const q = req.query || {};
  let rows = activities.slice().reverse(); // terbaru dulu
  if (q.type && ACT_TYPES.includes(String(q.type))) {
    rows = rows.filter(a => a.type === String(q.type));
  }
  if (q.user) {
    const needle = String(q.user).toLowerCase();
    rows = rows.filter(a =>
      (a.userId && String(a.userId).toLowerCase().includes(needle)) ||
      (a.email && String(a.email).toLowerCase().includes(needle)));
  }
  if (q.from) {
    const from = String(q.from).length <= 10 ? String(q.from) + 'T00:00:00.000Z' : String(q.from);
    rows = rows.filter(a => a.ts >= from);
  }
  if (q.to) {
    const to = String(q.to).length <= 10 ? String(q.to) + 'T23:59:59.999Z' : String(q.to);
    rows = rows.filter(a => a.ts <= to);
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    rows = rows.filter(a => [a.email, a.detail, a.keyName, a.model, a.ip]
      .some(v => v && String(v).toLowerCase().includes(needle)));
  }
  const total = rows.length;
  const lim = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(q.offset, 10) || 0, 0);
  rows = rows.slice(off, off + lim);
  res.json({ activities: rows, total: total, hasMore: off + lim < total });
});
/* Ringkasan jumlah per jenis aktivitas (untuk badge/filter cepat). */
app.get('/api/admin/activities/summary', requireAdmin, (req, res) => {
  const counts = {};
  for (const a of activities) counts[a.type] = (counts[a.type] || 0) + 1;
  res.json({ counts: counts, total: activities.length });
});

/* ============ admin: kredensial pengguna (monitoring) ===================== */
/* Daftar API key (prefix saja, BUKAN full token) dan custom provider
 * (Base URL full + key ter-mask) milik tiap user, dikelompokkan per Gmail.
 * Hanya admin (requireAdmin) yang boleh akses. User biasa -> 403. */
app.get('/api/admin/users/credentials', requireAdmin, (req, res) => {
  const users = db.users.map(u => {
    const keys = db.keys.filter(k => k.userId === u.id).map(k => ({
      id: k.id,
      name: k.name || '-',
      keyPrefix: (k.token && k.token.length >= 9) ? k.token.slice(0, 9) + '...' : '***',
      model: k.model || null,
      providerId: k.providerId || null,
      revoked: !!k.revoked,
      createdAt: k.createdAt || null
    }));
    const c = u.customProvider;
    const customProvider = (c && c.baseUrl) ? {
      baseUrl: c.baseUrl,
      keyMasked: maskKey(c.apiKey),
      models: c.models || [],
      checkedAt: c.checkedAt || null
    } : null;
    return {
      id: u.id,
      email: u.email,
      plan: u.plan || 'gratis',
      suspended: !!u.suspended,
      keys: keys,
      customProvider: customProvider
    };
  });
  res.json({ users: users });
});

/* ============================ admin: usage ================================ */
app.get('/api/usage', requireAdmin, (req, res) => {
  const { keyId, days } = req.query;
  const nDays = Math.max(1, Math.min(90, parseInt(days || '30', 10) || 30));
  const since = Date.now() - nDays * 24 * 60 * 60 * 1000;
  const rows = db.usage
    .filter(u => (!keyId || u.keyId === keyId) && new Date(u.ts).getTime() >= since)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 500);
  res.json({ rows, total: rows.length });
});
app.get('/api/stats', requireAdmin, (req, res) => {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;  let req24 = 0, tok24 = 0, tokAll = 0;
  for (const u of db.usage) {
    const t = new Date(u.ts).getTime();
    const tot = (u.promptTokens || 0) + (u.completionTokens || 0);
    tokAll += tot;
    if (t >= dayAgo) { req24++; tok24 += tot; }
  }
  res.json({
    totalKeys: db.keys.length,
    activeKeys: db.keys.filter(k => !k.revoked).length,
    totalProviders: db.providers.length,
    requests24h: req24,
    tokens24h: tok24,
    totalTokens: tokAll,
    totalRequests: db.usage.length,
    limitedKeysToday: db.keys.filter(k => limitedToday.get(k.id) === todayStr()).length
  });
});
// Kesehatan provider gateway — khusus admin.
app.get('/api/admin/provider-health', requireAdmin, (req, res) => {
  const out = db.providers.map(p => {
    const h = providerHealth[p.id] || {};
    return {
      id: p.id, name: p.name,
      errors: h.errors || 0,
      lastError: h.lastError || null,
      lastStatus: h.lastStatus || null,
      lastAt: h.lastAt || null,
      healthy: (h.errors || 0) < 3
    };
  });
  res.json({ providers: out });
});

/* ================== OpenAI-compatible bridge endpoints =================== */
app.get('/v1/models', requireBridgeKey, (req, res) => {
  logKeyUsage(req, req.bridgeKey, 'models');
  if (req.bridgeKey.mode === 'worker' || !req.provider) {
    // Worker-mode: tampilkan model default key worker.
    const wid = req.bridgeKey.model || 'worker';
    return res.json({ object: 'list', data: [{
      id: wid, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'Hestia'
    }] });
  }
  // Gateway: tampilkan model yang support di key ini, tanpa nama provider asli.
  const models = (req.provider.models || []).map(id => ({
    id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'Hestia'
  }));
  res.json({ object: 'list', data: models });
});

/* Worker mode: queue the request for the worker bound to this key and wait
 * (max 55s) for that worker to answer. 1 key = 1 worker: no other worker can
 * see or claim this request. Streaming is ignored in worker mode; the answer
 * always comes back as one non-streaming OpenAI-style chat completion object. */
async function handleWorkerChat(req, res) {
  const body = req.body || {};
  const key = req.bridgeKey;
  if (!key.workerId) {
    return res.status(503).json({ error: { message: 'key belum di-bind ke worker mana pun', code: 'worker_unbound' } });
  }
  const worker = db.workers.find(w => w.id === key.workerId);
  if (!worker || !workerOnline(worker)) {
    return res.status(503).json({ error: { message: 'worker offline', code: 'worker_offline' } });
  }
  const item = {
    id: uid('wq_'),
    keyId: key.id,
    workerId: key.workerId,
    model: body.model || 'worker',
    messages: Array.isArray(body.messages) ? body.messages : [],
    maxTokens: body.max_tokens != null ? body.max_tokens : null,
    receivedAt: nowIso(),
    status: 'pending',
    answer: null,
    claimedAt: null
  };
  db.wqueue.push(item);
  saveDb();
  notifyPendingWaiters(key.workerId); // wake any long-polling worker instantly

  let cancelled = false;
  res.on('close', () => { if (!res.writableEnded) cancelled = true; });

  const start = Date.now();
  await new Promise(resolve => {
    (function check() {
      if (cancelled || item.status === 'done' || Date.now() - start >= WORKER_WAIT_MS) return resolve();
      setTimeout(check, 1000);
    })();
  });

  if (cancelled) return; // client went away; leave the item for the worker/expiry
  if (item.status !== 'done') {
    return res.status(503).json({ error: { message: 'worker tidak menjawab tepat waktu', code: 'worker_timeout' } });
  }
  const answer = item.answer || '';
  const pt = estimateTokens(JSON.stringify(body.messages || []));
  const ct = estimateTokens(answer);
  recordUsage(key.id, 'muse-spark', pt, ct, false, 'worker');
  logKeyUsage(req, key, 'chat', 'muse-spark', pt, ct);
  res.json({
    id: 'chatcmpl-w' + crypto.randomBytes(8).toString('hex'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'muse-spark',
    choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct }
  });
}

app.post('/v1/chat/completions', requireBridgeKey, async (req, res) => {
  if (req.bridgeKey.mode === 'worker') {
    return handleWorkerChat(req, res);
  }
  const body = req.body || {};
  // Use the key's default model if the request doesn't specify one.
  // Gateway: fallback ke model pertama provider (model jualan Hestia).
  if (!body.model) {
    if (req.bridgeKey.model) {
      body.model = req.bridgeKey.model;
    } else if (req.provider && Array.isArray(req.provider.models) && req.provider.models.length) {
      body.model = req.provider.models[0];
    }
  }
  const wantStream = body.stream === true;
  const target = req.provider.baseUrl + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  // If the client disconnects mid-proxy, cancel the upstream request.
  // NOTE: must listen on `res`, not `req` — the request stream is already
  // fully consumed by express.json(), so req 'close' would fire immediately.
  res.on('close', () => {
    if (!res.writableEnded) { try { ctrl.abort(); } catch (e) {} }
  });

  let upstream;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + req.provider.key
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    return bridgeError(res, 502, 'Upstream provider unreachable: ' +
      (e.name === 'AbortError' ? 'timed out' : e.message));
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    const text = await upstream.text().catch(() => '');
    // Sanitasi pesan error upstream agar tidak membocorkan identitas provider asli.
    let rawMsg = '';
    try { const j = JSON.parse(text); if (j.error && j.error.message) rawMsg = String(j.error.message); } catch (e) {}
    let msg = sanitizeUpstreamError(rawMsg, upstream.status);
    // Catat untuk pantauan admin.
    if (req.provider) recordProviderError(req.provider.id, upstream.status, rawMsg || msg);
    return bridgeError(res, upstream.status === 401 ? 502 : upstream.status, msg);
  }
  // Sukses — catat untuk reset error count.
  if (req.provider) recordProviderOk(req.provider.id);

  const model = body.model || 'unknown';
  const promptText = JSON.stringify(body.messages || []);

  if (!wantStream) {
    let data;
    try { data = await upstream.json(); }
    catch (e) { clearTimeout(timer); return bridgeError(res, 502, 'Upstream returned invalid JSON.'); }
    clearTimeout(timer);
    let pt = 0, ct = 0;
    if (data && data.usage) {
      pt = data.usage.prompt_tokens || 0;
      ct = data.usage.completion_tokens || 0;
    } else {
      const outText = JSON.stringify((data.choices || []).map(c => (c.message && c.message.content) || ''));
      pt = estimateTokens(promptText);
      ct = estimateTokens(outText);
    }
    recordUsage(req.bridgeKey.id, model, pt, ct, false);
    logKeyUsage(req, req.bridgeKey, 'chat', model, pt, ct);
    res.set('X-Hestia-Gateway', 'true');
    return res.json(normalizeChatResponse(data, model));
  }

  // Streaming: forward SSE untouched, estimate tokens from bytes on finish.
  // Fallback: jika upstream mengabaikan stream:true dan mengembalikan JSON utuh
  // (bukan SSE), konversi ke satu chunk SSE agar frontend tetap menerima respons.
  const upstreamCT = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!upstreamCT.includes('text/event-stream')) {
    let data;
    try { data = await upstream.text(); } catch (e) { data = ''; }
    clearTimeout(timer);
    let content = '';
    let usage = null;
    try {
      const j = JSON.parse(data);
      const ch = j && j.choices && j.choices[0];
      if (ch) {
        if (ch.message && typeof ch.message.content === 'string') content = ch.message.content;
        else if (ch.delta && typeof ch.delta.content === 'string') content = ch.delta.content;
        else if (typeof ch.text === 'string') content = ch.text;
      }
      if (j && j.usage) usage = j.usage;
    } catch (e) { /* bukan JSON valid, kirim apa adanya */ }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.on('error', () => {});
    if (content) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: content } }] }) + '\n\n');
    } else if (data) {
      // fallback terakhir: kirim mentah sebagai satu chunk agar tidak kosong
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: data.slice(0, 4000) } }] }) + '\n\n');
    }
    res.write('data: [DONE]\n\n');
    try { res.end(); } catch (e) {}
    const pt = usage ? (usage.prompt_tokens || 0) : estimateTokens(promptText);
    const ct = usage ? (usage.completion_tokens || 0) : estimateTokens(content || data);
    recordUsage(req.bridgeKey.id, model, pt, ct, true);
    logKeyUsage(req, req.bridgeKey, 'chat', model, pt, ct);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  let streamedChars = 0;
  let sawUsage = null;
  try {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      streamedChars += chunk.length;
      buf += chunk;
      // try to pick up a usage object if the provider sends one
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              const j = JSON.parse(payload);
              if (j.usage) sawUsage = j.usage;
            } catch (e) {}
          }
        }
      }
      if (!res.write(chunk)) {
        await new Promise(r => res.once('drain', r));
      }
    }
  } catch (e) {
    // client or upstream dropped; still record what we saw
  }
  clearTimeout(timer);
  try { res.end(); } catch (e) {}
  const pt = sawUsage ? (sawUsage.prompt_tokens || 0) : estimateTokens(promptText);
  const ct = sawUsage ? (sawUsage.completion_tokens || 0) : estimateTokens('x'.repeat(streamedChars));
  recordUsage(req.bridgeKey.id, model, pt, ct, true);
  logKeyUsage(req, req.bridgeKey, 'chat', model, pt, ct);
});

/* ============================ static frontend ============================ */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('[hestia-bridge] listening on port ' + PORT);
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) {
    console.log('[hestia-bridge] WARNING: ADMIN_EMAIL / ADMIN_PASSWORD_HASH not set — admin login disabled.');
  }
});
