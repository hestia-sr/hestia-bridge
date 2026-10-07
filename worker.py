#!/usr/bin/env python3
"""
Hestia Bridge Worker — script worker beneran.

Cara pakai:
1. Isi WORKER_TOKEN dengan token wt- dari halaman Worker Saya di web Bridge.
2. Isi AI_API_URL, AI_API_KEY, AI_MODEL dengan API AI dari akun lain
   (boleh OpenAI-compatible apa saja: provider kamu sendiri, dll).
3. Jalankan: python3 worker.py
   Biarkan jalan terus. Tekan Ctrl+C untuk berhenti.

Di Termux: pkg install python && pip install requests
"""

import time
import sys

try:
    import requests
except ImportError:
    print("Install dulu: pip install requests")
    sys.exit(1)

# ==================== KONFIGURASI — ISI DI SINI ====================
BRIDGE_URL = "https://hestia-bridge-production.up.railway.app"
WORKER_TOKEN = "ISI_TOKEN_WT_DISINI"

# AI penjawab (akun lain, BUKAN akun utama). OpenAI-compatible.
AI_API_URL = "https://api.contoh.com/v1/chat/completions"
AI_API_KEY = "ISI_API_KEY_AI_DISINI"
AI_MODEL = "nama-model"

POLL_SECONDS = 30
# ===================================================================

HEADERS = {
    "Authorization": "Bearer " + WORKER_TOKEN,
    "Content-Type": "application/json",
}

def log(msg):
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)

def heartbeat():
    try:
        r = requests.post(BRIDGE_URL + "/v1/worker/heartbeat",
                          headers=HEADERS, timeout=20)
        return r.status_code == 200
    except Exception as e:
        log("heartbeat gagal: " + str(e))
        return False

def get_pending():
    try:
        r = requests.get(BRIDGE_URL + "/v1/worker/pending",
                         headers=HEADERS, timeout=20)
        if r.status_code != 200:
            return []
        return r.json().get("pending", [])
    except Exception as e:
        log("cek antrean gagal: " + str(e))
        return []

def claim(item_id):
    try:
        r = requests.post(BRIDGE_URL + "/v1/worker/claim",
                          headers=HEADERS,
                          json={"id": item_id}, timeout=20)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:
        log("claim gagal: " + str(e))
        return None

def ask_ai(messages):
    try:
        # Inject system prompt: AI harus selalu minta konfirmasi
        system_prompt = {
            "role": "system",
            "content": "Selalu minta konfirmasi kepada pengguna sebelum melakukan tindakan apa pun. Jangan langsung bertindak tanpa persetujuan eksplisit dari pengguna."
        }
        if not messages or messages[0].get("role") != "system":
            messages = [system_prompt] + list(messages)
        r = requests.post(
            AI_API_URL,
            headers={"Authorization": "Bearer " + AI_API_KEY,
                     "Content-Type": "application/json"},
            json={"model": AI_MODEL, "messages": messages},
            timeout=120,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        log("AI gagal menjawab: " + str(e))
        return None

def done(item_id, content):
    try:
        r = requests.post(BRIDGE_URL + "/v1/worker/done",
                          headers=HEADERS,
                          json={"id": item_id, "content": content},
                          timeout=20)
        return r.status_code == 200
    except Exception as e:
        log("done gagal: " + str(e))
        return False

def main():
    if "ISI_TOKEN" in WORKER_TOKEN or "ISI_API_KEY" in AI_API_KEY:
        print("Isi dulu WORKER_TOKEN dan AI_API_KEY di dalam script!")
        sys.exit(1)
    log("Worker jalan. Polling tiap %d detik. Ctrl+C untuk berhenti." % POLL_SECONDS)
    while True:
        try:
            heartbeat()
            for item in get_pending():
                item_id = item.get("id")
                log("Ada chat masuk: " + str(item_id))
                data = claim(item_id)
                if not data:
                    continue
                messages = data.get("messages", [])
                answer = ask_ai(messages)
                if answer is None:
                    answer = "Maaf, saya sedang tidak bisa menjawab."
                if done(item_id, answer):
                    log("Terjawab: " + str(item_id))
        except KeyboardInterrupt:
            log("Berhenti.")
            break
        except Exception as e:
            log("Error: " + str(e))
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
