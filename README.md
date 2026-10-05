# Hestia Bridge

Dashboard ringan untuk mengelola API key AI — ala halaman `1mr.tech/app/keys`, versi Hestia.

Sambungkan AI provider yang kompatibel OpenAI (Base URL + API key), buat bridge key
berawalan `hb-` (1 key terikat ke 1 provider), lalu pakai key itu dari aplikasi HP
mana pun lewat endpoint OpenAI-compatible.

## Fitur

- Tambah provider (Base URL + API key), divalidasi via `GET {baseUrl}/models`
- Buat / salin / revoke / hapus bridge key (`hb-...`), 1 key = 1 provider
- Endpoint OpenAI-compatible:
  - `GET /v1/models` — daftar model provider (format OpenAI)
  - `POST /v1/chat/completions` — proxy ke upstream, dukung `stream: true` (SSE)
- Statistik per key: jumlah request, token masuk/keluar (dari data asli provider;
  estimasi kasar 4 karakter = 1 token hanya bila upstream tidak memberi `usage`)
- Rate limit 60 request/menit per key; key yang di-revoke ditolak (401)
- Auth admin: single admin, bcrypt, session cookie 30 hari

## Teknologi

Node.js + Express + bcrypt saja. CSS polos, JS vanilla, tanpa build step.
Ikon inline SVG, tanpa emoji.

## Cara menjalankan

1. Install: `npm install`
2. Buat hash password admin: `npm run gen-hash -- "password-rahasia"` → salin hash yang keluar
3. Jalankan dengan env:

```
PORT=3000 \
ADMIN_EMAIL="kamu@email.com" \
ADMIN_PASSWORD_HASH="hash-dari-langkah-2" \
DATA_DIR="./data" \
npm start
```

4. Buka `http://localhost:3000`, login dengan email + password admin.

Untuk Railway: pasang volume di `/app/data` dan set `DATA_DIR=/app/data`
agar `db.json` tidak hilang saat redeploy.

## Cara pakai dari aplikasi HP

1. Di dashboard, buat key lalu salin (key penuh hanya tampil sekali).
2. Di aplikasi AI (yang mendukung custom OpenAI endpoint):
   - **Base URL**: `https://domain-kamu/v1`
   - **API Key**: `hb-...` yang tadi disalin
3. Pilih model dari daftar provider yang terikat key tersebut.

## Contoh curl

```bash
# daftar model
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer hb-xxxx"

# chat biasa
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer hb-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-id","messages":[{"role":"user","content":"Halo"}]}'

# chat streaming
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer hb-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-id","stream":true,"messages":[{"role":"user","content":"Halo"}]}'
```

## Struktur data (`data/db.json`)

- `providers`: `{id, name, baseUrl, key, models[], createdAt, lastCheckedAt}`
- `keys`: `{id, token, name, providerId, createdAt, lastUsedAt, revoked}`
- `usage`: `{keyId, ts, model, promptTokens, completionTokens, streamed}`
