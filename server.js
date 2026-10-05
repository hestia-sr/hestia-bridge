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
        usage: Array.isArray(d.usage) ? d.usage : []
      };
    }
  } catch (e) {
    console.error('[db] load failed, starting fresh:', e.message);
  }
  return { providers: [], keys: [], usage: [] };
}
const db = loadDb();
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      ensureDataDir();
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
function nowIso() {
  return new Date().toISOString();
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

/* --------------------------- sessions (admin) ---------------------------- */
const sessions = new Map(); // token -> expiresAt
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}
function validSession(req) {
  const token = parseCookies(req).hb_session;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  if (!validSession(req)) return res.status(401).json({ error: 'not_authenticated' });
  next();
}
setInterval(() => {
  const t = Date.now();
  for (const [k, exp] of sessions) if (exp < t) sessions.delete(k);
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
  if (rateLimited(key.id)) {
    limitedToday.set(key.id, todayStr());
    res.set('Retry-After', '60');
    return bridgeError(res, 429, 'Rate limit exceeded: max 60 requests per minute for this key.');
  }
  const provider = db.providers.find(p => p.id === key.providerId);
  if (!provider) return bridgeError(res, 401, 'The provider bound to this key no longer exists.');
  req.bridgeKey = key;
  req.provider = provider;
  next();
}

function recordUsage(keyId, model, promptTokens, completionTokens, streamed) {
  db.usage.push({
    keyId,
    ts: nowIso(),
    model: model || 'unknown',
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    streamed: !!streamed
  });
  // keep the log bounded: last 50k entries
  if (db.usage.length > 50000) db.usage.splice(0, db.usage.length - 50000);
  const k = db.keys.find(x => x.id === keyId);
  if (k) k.lastUsedAt = nowIso();
  saveDb();
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

/* ============================ public: health ============================= */
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'hestia-bridge' }));

/* ============================ admin: auth ================================ */
app.post('/api/auth/login', async (req, res) => {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  const { email, password } = req.body || {};
  if (String(email || '').trim().toLowerCase() !== ADMIN_EMAIL) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  let ok = false;
  try { ok = await bcrypt.compare(String(password || ''), ADMIN_PASSWORD_HASH); }
  catch (e) { ok = false; }
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = createSession();
  res.setHeader('Set-Cookie',
    'hb_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000));
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).hb_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'hb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  if (!validSession(req)) return res.status(401).json({ error: 'not_authenticated' });
  res.json({ ok: true, email: ADMIN_EMAIL });
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
  // revoke (not delete) bound keys so usage history stays intact
  db.keys.forEach(k => { if (k.providerId === pid && !k.revoked) k.revoked = true; });
  db.providers.splice(i, 1);
  saveDb();
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
      return {
        id: k.id, name: k.name, masked: maskKey(k.token),
        providerId: k.providerId, providerName: p ? p.name : '(deleted)',
        createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null,
        revoked: !!k.revoked, stats: keyStats(k.id)
      };
    })
  });
});
app.post('/api/keys', requireAdmin, (req, res) => {
  const { name, providerId } = req.body || {};
  if (!name || !providerId) return res.status(400).json({ error: 'name and providerId are required' });
  const p = db.providers.find(x => x.id === providerId);
  if (!p) return res.status(404).json({ error: 'provider_not_found' });
  const k = {
    id: uid('key_'),
    token: 'hb-' + crypto.randomBytes(24).toString('hex'),
    name: String(name).trim(),
    providerId,
    createdAt: nowIso(),
    lastUsedAt: null,
    revoked: false
  };
  db.keys.push(k);
  saveDb();
  // Full token is returned exactly once, at creation.
  res.json({ id: k.id, name: k.name, token: k.token, providerId, createdAt: k.createdAt });
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
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  k.name = String(name).trim().slice(0, 60);
  saveDb();
  res.json({ ok: true, id: k.id, name: k.name });
});
app.post('/api/keys/:id/rotate', requireAdmin, (req, res) => {
  const k = db.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'key_not_found' });
  k.token = 'hb-' + crypto.randomBytes(24).toString('hex');
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
  db.keys.splice(i, 1);
  saveDb();
  res.json({ ok: true });
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
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let req24 = 0, tok24 = 0, tokAll = 0;
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

/* ================== OpenAI-compatible bridge endpoints =================== */
app.get('/v1/models', requireBridgeKey, (req, res) => {
  const models = (req.provider.models || []).map(id => ({
    id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: req.provider.name
  }));
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', requireBridgeKey, async (req, res) => {
  const body = req.body || {};
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
    let msg = 'Upstream error HTTP ' + upstream.status;
    try { const j = JSON.parse(text); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
    return bridgeError(res, upstream.status === 401 ? 502 : upstream.status, msg);
  }

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
    return res.json(data);
  }

  // Streaming: forward SSE untouched, estimate tokens from bytes on finish.
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
