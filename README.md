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

## Mode Worker (trial)

Selain mode provider (1 key = 1 provider, request di-proxy langsung),
bridge juga punya mode worker ala 1Mister: request yang masuk via API key
**diantrekan**, lalu dijawab oleh aplikasi AI terpisah ("worker") yang
terhubung ke bridge.

Alur:

1. Di dashboard (atau via API admin), buat worker:
   `POST /api/workers` body `{"name": "worker-1"}` → dapat `token`
   berawalan `wt-` (token penuh hanya tampil sekali).
2. Buat bridge key dengan `mode: "worker"`:
   `POST /api/keys` body `{"name": "key-ai", "mode": "worker"}`
   (tidak butuh `providerId`).
3. Jalankan worker: ia harus rutin memanggil (pakai header
   `Authorization: Bearer wt-...`):
   - `POST /v1/worker/heartbeat` → `{ok: true}` (kirim tiap < 10 menit
     agar dianggap online)
   - `GET /v1/worker/pending` → `{pending: [{id, received_at}], worker_online: true}`
   - `POST /v1/worker/claim` body `{"id": "..."}` → `200 {request: {messages, max_tokens, model}}`
     (409 bila sudah diklaim/dijawab)
   - Jawab pesan user, lalu `POST /v1/worker/done` body `{"id": "...", "content": "jawaban"}`
4. Request via key worker: `POST /v1/chat/completions` dengan
   `Authorization: Bearer hb-...` → bridge membuat antrean lalu menunggu
   maksimal 55 detik sampai worker menjawab. Bila tidak ada worker online →
   `503 worker_offline`; bila worker tidak menjawab tepat waktu →
   `503 worker_timeout`. Mode worker selalu non-streaming (flag `stream`
   diabaikan). Item antrean yang tidak diklaim > 220 detik otomatis
   kedaluwarsa (`expired`).
5. Pemakaian tetap tercatat per key seperti biasa (dengan penanda
   `via: "worker"`).

Contoh worker minimal (bash + curl, poll tiap 10 detik):

```bash
WTOKEN="wt-..."
BASE="https://domain-kamu"
while true; do
  curl -s -X POST "$BASE/v1/worker/heartbeat" -H "Authorization: Bearer $WTOKEN" > /dev/null
  for id in $(curl -s "$BASE/v1/worker/pending" -H "Authorization: Bearer $WTOKEN" \
      | python3 -c "import sys,json; print(' '.join(x['id'] for x in json.load(sys.stdin)['pending']))"); do
    MSG=$(curl -s -X POST "$BASE/v1/worker/claim" -H "Authorization: Bearer $WTOKEN" \
      -H "Content-Type: application/json" -d "{\"id\":\"$id\"}")
    # ... jawab $MSG dengan AI pilihanmu, simpan ke $JAWABAN ...
    curl -s -X POST "$BASE/v1/worker/done" -H "Authorization: Bearer $WTOKEN" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "import json,sys; print(json.dumps({'id':sys.argv[1],'content':sys.argv[2]}))" "$id" "$JAWABAN")" > /dev/null
  done
  sleep 10
done
```

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
- `keys`: `{id, token, name, mode ('provider'|'worker'), providerId, createdAt, lastUsedAt, revoked}`
- `usage`: `{keyId, ts, model, promptTokens, completionTokens, streamed, via?}`
- `workers`: `{id, name, token ('wt-...'), createdAt, lastHeartbeat}`
- `wqueue`: `{id, keyId, model, messages, maxTokens, receivedAt, status ('pending'|'claimed'|'done'|'expired'), answer, claimedAt}`
