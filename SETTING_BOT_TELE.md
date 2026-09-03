# 🤖 SETTING BOT TELEGRAM — Panduan Konfigurasi

> Catatan lengkap setup, pemisahan token, dan troubleshooting semua bot Telegram di VPS 119.28.100.51

---

## 📋 Daftar Bot Aktif di VPS

| Bot | PM2 Name | Script | Token Env | Fungsi |
|-----|----------|--------|-----------|--------|
| Notif Uptime Nineteen | `uptime-bot` (id: 2) | `tg-bot.js` | `TELEGRAM_BOT_TOKEN` | Monitoring server, uptime, detail VPS |
| Jemput Bola Bot | `maps-blast` (id: 10) | `maps-blast.js` | `MAPS_BOT_TOKEN` | Lead scraper, WA blast, follow-up |
| ePresensi SINAGA | `epresensi-sinaga` (id: 4) | `server.js` | `TG_BOT_TOKEN` | Notifikasi absensi WA ke guru |

> ⚠️ **WAJIB: Setiap bot HARUS pakai token Telegram yang BERBEDA!**
> Token sama = 409 Conflict = bot tidak merespon secara acak.

---

## 🔑 File .env VPS (/root/uptime-kuma/.env)

```env
# Bot Uptime Nineteen (tg-bot.js)
TELEGRAM_BOT_TOKEN=8633904059:AAERtptVrCbmXGCq5B-hQrTNeqcwhdhtJXQ

# Bot Maps Blast / Jemput Bola (maps-blast.js)
MAPS_BOT_TOKEN=8822972318:AAGBirzLtfY-5NQ-dFWm37vSfyXDhoAWfnU

# Token lain (jangan hapus)
BOT_JUALAN_TOKEN=8975358507:...
AUTOPOST_BOT_TOKEN=8643852705:...
```

---

## 🛠️ Yang Sudah Dilakukan

### 1. Pisah Token Bot Maps Blast (2026-09-03)

**Masalah:** `maps-blast.js` dan `tg-bot.js` pakai `TELEGRAM_BOT_TOKEN` yang sama
→ `TelegramError: 409 Conflict` → kedua bot tidak merespon

**Fix:**
```bash
# Hapus TELEGRAM_BOT_TOKEN lama
sed -i '/^TELEGRAM_BOT_TOKEN=/d' /root/uptime-kuma/.env

# Tambah dua token terpisah
echo "TELEGRAM_BOT_TOKEN=8633904059:..." >> /root/uptime-kuma/.env
echo "MAPS_BOT_TOKEN=8822972318:..." >> /root/uptime-kuma/.env

# Update maps-blast.js pakai MAPS_BOT_TOKEN
sed -i "s/process.env.TELEGRAM_BOT_TOKEN/process.env.MAPS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN/g" /root/uptime-kuma/maps-blast.js

# Restart dengan env baru
pm2 restart uptime-bot maps-blast --update-env
pm2 save
```

### 2. Tambah Reply Keyboard Menu ke Maps Blast Bot (2026-09-03)

**File:** `maps-blast.js`

Keyboard menu dengan tombol cepat:
```
📡 Status WA     📋 Leads Info
🚀 Blast Semua   🔄 Follow Up
📊 Per Kategori  📥 Export CSV
❓ Bantuan
```

**Command baru:**
- `/start` → menampilkan keyboard menu
- `/leadskat` → lihat leads dikelompokkan per kategori + shortcut `/blastfilter`

### 3. Kill Proses tg-bot.js Orphan

**Masalah:** Setelah PM2 restart, proses lama tidak mati → dua instance jalan

**Fix:**
```bash
pkill -f "tg-bot.js"
pm2 restart uptime-bot --update-env
```

---

## 🔧 Cara Buat Bot Baru (@BotFather)

```
1. Buka Telegram → cari @BotFather
2. /newbot
3. Isi nama bot (contoh: "Jemput Bola Bot")
4. Isi username (harus diakhiri _bot, contoh: jemputbola_nineteen2026_bot)
5. Copy TOKEN yang diberikan → simpan ke .env
```

---

## ❌ Troubleshooting 409 Conflict

### Gejala
- Bot tidak merespon command apapun
- Log error: `TelegramError: 409: Conflict: terminated by other getUpdates request`

### Penyebab
1. **Dua proses pakai token sama** → pisah ke variable berbeda
2. **Proses orphan** (proses lama tidak mati saat PM2 restart)
3. **File dump.pm2 lama** masih menyimpan proses yang sudah dihapus

### Solusi Langkah per Langkah
```bash
# 1. Cek semua proses Node.js yang jalan
ps aux | grep node | grep -v grep

# 2. Cek token setiap PM2 process
pm2 env 2 | grep -i token    # uptime-bot
pm2 env 10 | grep -i token   # maps-blast
pm2 env 4 | grep -i token    # epresensi

# 3. Kill proses orphan yang tidak ada di pm2 list
pkill -f "nama-script.js"

# 4. Pastikan setiap bot pakai token berbeda di .env
grep "TOKEN" /root/uptime-kuma/.env
grep "TOKEN" /root/epresensi/.env

# 5. Restart semua dengan env baru
pm2 restart all --update-env
pm2 save
```

---

## 📱 Test Bot Setelah Setup

| Bot | Username | Command Test |
|-----|----------|-------------|
| Uptime Nineteen | @NotifUptimeNineteen_bot | `/detail` |
| Jemput Bola | @jemputbola_nineteen2026_bot | `/start` atau `/statuswa` |
| ePresensi | Bot internal | Cek Telegram admin |

---

## 🔒 Keamanan Token

> [!CAUTION]
> Token bot yang bocor (tampil di chat/log) HARUS segera di-revoke!

```
1. Buka @BotFather
2. /mybots → pilih bot
3. API Token → Revoke current token
4. Copy token baru → update .env di VPS
5. pm2 restart [bot-name] --update-env
```

---

## 📁 Lokasi File Penting

| File | Lokasi VPS | Fungsi |
|------|-----------|--------|
| `.env` | `/root/uptime-kuma/.env` | Semua token & konfigurasi |
| `tg-bot.js` | `/root/uptime-kuma/tg-bot.js` | Script uptime-bot |
| `maps-blast.js` | `/root/uptime-kuma/maps-blast.js` | Script maps blast |
| `server.js` | `/root/epresensi/server.js` | Script ePresensi |