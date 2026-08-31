# 📅 Panduan Cron Job & WhatsApp Gateway — ePresensi Sinaga

> Referensi cepat saat ingin membuat atau memodifikasi **Scheduler Notifikasi WhatsApp** di project ini.
> Semua kode scheduler + Baileys ada di `server.js`.

---

## 📖 Gambaran Umum Sistem

Cron job di project ini berfungsi **mengirim notifikasi WhatsApp otomatis** ke seluruh guru sesuai jadwal presensi. Sistem ini:

- ✅ Berjalan setiap **1 menit** (master cron tick)
- ✅ Mendukung **multi-tenant** (banyak sekolah sekaligus)
- ✅ Mengambil data presensi **real-time dari ePresensi Jateng**
- ✅ Membedakan template pesan: guru yang **sudah absen** vs **belum absen**
- ✅ Menyimpan log pengiriman ke **Supabase** (`notification_logs`)
- ✅ Mengirim WA via **Baileys** (gratis, scan QR) atau **Fonnte** (API berbayar) — otomatis pilih yang aktif

---

## 🏗️ Arsitektur Cron Job

```
setupScheduler()
      │
      ▼
cron.schedule('* * * * *', ...)   ← setiap menit
      │
      ▼
getActiveSchools()                ← query Supabase (cache 5 menit)
      │
      ▼
for each school → buildTenantCfg()
      │
      ├── H:M === pagiHour:pagiMinute                         → runSchedulerLogic('pagi', cfg)
      ├── H:M === siangHour:siangMinute                       → runSchedulerLogic('siang', cfg)
      ├── H:M === pulangHour:pulangMinute                     → runSchedulerLogic('pulang', cfg)
      └── dayOfWeek===5 && H:M === jumatPulangHour:Minute 🆕  → runSchedulerLogic('pulang', cfg)
                                               │
                                               ▼
                                    ensureTenantSession() → login ePresensi
                                               │
                                               ▼
                                    fetchColleaguesAttendance() → data guru
                                               │
                                               ▼
                                    for each guru → sendWhatsAppWithRetry()
                                               │
                                               ▼
                                    logNotificationToSupabase()
```

---

## 📦 Dependensi yang Digunakan

```json
"node-cron": "^3.0.3"
```

Install jika belum ada:
```bash
npm install node-cron
```

Import di awal file:
```js
const cron = require('node-cron');
```

---

## 🔧 Cara Kerja Detail

### 1. Master Cron — Setiap 1 Menit

```js
// server.js — Line ~1707
masterCron = cron.schedule('* * * * *', async () => {
  if (schedulerRunning) return;  // guard: cegah eksekusi ganda
  schedulerRunning = true;

  try {
    const now = new Date();
    // ⚠️ PENTING: gunakan timezone WIB!
    const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const H = wib.getHours();
    const M = wib.getMinutes();

    const schools = await getActiveSchools();  // cache 5 menit

    for (const row of schools) {
      const cfg = buildTenantCfg(row);

      if (H === cfg.pagiHour && M === cfg.pagiMinute) {
        runSchedulerLogic('pagi', cfg).catch(...);
      }
      if (cfg.schedulerSiangEnabled && H === cfg.siangHour && M === cfg.siangMinute) {
        runSchedulerLogic('siang', cfg).catch(...);
      }
      if (H === cfg.pulangHour && M === cfg.pulangMinute) {
        runSchedulerLogic('pulang', cfg).catch(...);
      }
      // 🆕 Jadwal khusus Jumat — pulang lebih awal (default 14:00)
      if (cfg.jumatPulangEnabled !== false && dayOfWeek === 5
          && H === cfg.jumatPulangHour && M === cfg.jumatPulangMinute) {
        runSchedulerLogic('pulang', cfg).catch(...);
      }
    }
  } finally {
    schedulerRunning = false;  // ⚠️ selalu reset guard!
  }
});
```

> **Kenapa `* * * * *` bukan langsung di jam tertentu?**
> Karena jadwal pagi/siang/pulang setiap sekolah **berbeda-beda** dan bisa diubah dari dashboard. Master cron hanya jadi "jantung" yang berdetak setiap menit, lalu memeriksa apakah sekarang waktunya kirim.

> **Kenapa jadwal Jumat pakai `dayOfWeek === 5`?**
> `dayOfWeek` diambil dari `wib.getDay()` — hasilnya `0`=Minggu, `1`=Senin, ..., `5`=**Jumat**, `6`=Sabtu. Jadi kondisi `dayOfWeek === 5` memastikan pengingat pulang Jumat **hanya berjalan di hari Jumat**. Untuk keperluan testing, kondisi ini bisa dilepas sementara.

---

### 2. Cache Sekolah — Supabase (5 Menit)

```js
// server.js — Line ~1614
let schoolsCache = null;
let schoolsCacheExpiry = 0;

async function getActiveSchools() {
  if (schoolsCache && Date.now() < schoolsCacheExpiry) {
    return schoolsCache;  // pakai cache, tidak query ulang
  }

  const { data } = await supabase
    .from('school_configs')
    .select(`
      scheduler_enabled, pagi_hour, pagi_minute,
      siang_hour, siang_minute, pulang_hour, pulang_minute,
      school_id,
      schools!inner(id, name, epresensi_username, epresensi_password, ...)
    `)
    .eq('scheduler_enabled', true);

  schoolsCache = data;
  schoolsCacheExpiry = Date.now() + 5 * 60_000;  // cache 5 menit
  return data;
}
```

---

### 3. Logic Pengiriman — `runSchedulerLogic(type, cfg)`

Fungsi utama yang dipanggil saat jadwal cocok:

```js
async function runSchedulerLogic(type = 'pagi', cfg = null) {
  // type: 'pagi' | 'siang' | 'pulang'

  // 1. Login ePresensi untuk ambil data absensi
  const session = await ensureTenantSession(cfg);

  // 2. Ambil daftar guru + status absen hari ini
  const colleaguesRes = await fetchColleaguesAttendance(
    session.cookie, day, null, null,
    true,   // forceRefresh: SELALU ambil data terbaru
    0, cfg
  );

  // 3. Cocokkan guru ePresensi dengan penerima WA di Supabase
  //    Menggunakan fuzzy matching nama
  for (const guru of targets_raw) {
    const found = registered.find(r => {
      const cleanGuru = guru.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanR    = r.nama.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanGuru.includes(cleanR) || cleanR.includes(cleanGuru);
    });
    if (found) targets.push({ nama: guru.nama, nomor: found.nomor, isHadir: guru.isHadir });
  }

  // 4. Kirim WA dengan template berbeda: sudah absen vs belum absen
  for (const t of targets) {
    const template = t.isHadir ? msgPagiSudah : msgBelumPagi;
    const msg = template.replace(/\{nama\}/gi, t.nama);

    await sendWhatsAppWithRetry(t.nomor, msg);  // retry 3x otomatis

    // 5. Simpan log ke Supabase
    logNotificationToSupabase({ school_id, type, nama, nomor, status, ... });

    await new Promise(r => setTimeout(r, 1000));  // delay 1 detik antar pesan
  }
}
```

---

## 🗄️ Tabel Supabase yang Terlibat

| Tabel | Fungsi |
|-------|--------|
| `school_configs` | Jadwal cron per sekolah (`pagi_hour`, `siang_hour`, `pulang_hour`, dll.) |
| `schools` | Kredensial ePresensi + konfigurasi WA gateway |
| `recipients` | Daftar penerima WA + nomor HP guru |
| `notification_logs` | Log riwayat pengiriman (persistent) |

---

## ⚙️ Kolom Penting di `school_configs`

| Kolom | Tipe | Contoh | Keterangan |
|-------|------|--------|------------|
| `scheduler_enabled` | bool | `true` | ON/OFF scheduler sekolah ini |
| `scheduler_siang_enabled` | bool | `true` | ON/OFF sesi siang |
| `pagi_hour` | int | `7` | Jam notif pagi (WIB) |
| `pagi_minute` | int | `30` | Menit notif pagi |
| `siang_hour` | int | `15` | Jam notif siang |
| `siang_minute` | int | `30` | Menit notif siang |
| `pulang_hour` | int | `18` | Jam notif pulang hari biasa |
| `pulang_minute` | int | `0` | Menit notif pulang hari biasa |
| `jumat_pulang_enabled` 🆕 | bool | `true` | ON/OFF pengingat pulang khusus Jumat |
| `jumat_pulang_hour` 🆕 | int | `14` | Jam notif pulang Jumat (WIB) |
| `jumat_pulang_minute` 🆕 | int | `0` | Menit notif pulang Jumat |
| `message_pagi` | text | — | Template pesan belum absen pagi |
| `message_pagi_sudah` | text | — | Template pesan sudah absen pagi |
| `message_pulang` | text | — | Template pesan belum absen pulang (dipakai juga untuk Jumat) |
| `message_pulang_sudah` | text | — | Template pesan sudah absen pulang (dipakai juga untuk Jumat) |

> **⚠️ Migration SQL** (jalankan sekali di Supabase SQL Editor):
> ```sql
> ALTER TABLE school_configs
>   ADD COLUMN IF NOT EXISTS jumat_pulang_enabled  boolean NOT NULL DEFAULT true,
>   ADD COLUMN IF NOT EXISTS jumat_pulang_hour     smallint NOT NULL DEFAULT 14,
>   ADD COLUMN IF NOT EXISTS jumat_pulang_minute   smallint NOT NULL DEFAULT 0;
> ```

> Placeholder `{nama}` di template akan diganti otomatis dengan nama guru.

---

## 🛠️ Template Pesan (Default)

```js
// Pesan pagi — belum absen
const DEF_MSG_PAGI = "Halo {nama}! 👋\n\n...BELUM...\n\nSegera presensi masuk!";

// Pesan pagi — sudah absen
const DEF_MSG_PAGI_SUDAH = "Halo {nama}! 👋\n\n...SUDAH...\n\nSelamat bertugas! 🏢✨";

// Siang dan Pulang juga ada pasangannya (BELUM & SUDAH)
```

---

## 📡 Retry Otomatis Pengiriman WA

```js
// Retry 3x dengan exponential backoff: 2s, 4s, 8s
async function sendWhatsAppWithRetry(target, message, tokenOverride = null, maxRetry = 3) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    const result = await sendWhatsApp(target, message, tokenOverride);
    if (result.success) return result;

    const delayMs = 2000 * Math.pow(2, attempt - 1);  // 2s → 4s → 8s
    await new Promise(r => setTimeout(r, delayMs));
  }
}
```

---

## ➕ Cara Menambah Cron Job Baru

### Opsi A — Tambah ke Master Cron (disarankan, ikut multi-tenant)

**Langkah 1** — Buat fungsi logika:
```js
async function runDailyReport(cfg) {
  console.log(`[DailyReport] Mengirim laporan ke ${cfg.namaSekolah}`);
  // logika di sini...
}
```

**Langkah 2** — Daftarkan di dalam `setupScheduler()`:
```js
// Di dalam masterCron = cron.schedule('* * * * *', async () => {
for (const row of schools) {
  const cfg = buildTenantCfg(row);

  // Yang sudah ada:
  if (H === cfg.pagiHour && M === cfg.pagiMinute)   runSchedulerLogic('pagi', cfg);
  if (H === cfg.siangHour && M === cfg.siangMinute) runSchedulerLogic('siang', cfg);
  if (H === cfg.pulangHour && M === cfg.pulangMinute) runSchedulerLogic('pulang', cfg);

  // 🆕 Jadwal Jumat — sudah ditambahkan:
  if (cfg.jumatPulangEnabled !== false && dayOfWeek === 5
      && H === cfg.jumatPulangHour && M === cfg.jumatPulangMinute) {
    runSchedulerLogic('pulang', cfg).catch(e => console.error('[Jumat Pulang] Error:', e.message));
  }

  // ✅ Contoh cron baru lainnya:
  if (H === 6 && M === 0) {
    runDailyReport(cfg).catch(e => console.error('[DailyReport] Error:', e.message));
  }
}
```

### Opsi B — Cron Independen Terpisah

```js
// Format: 'menit jam hari_bulan bulan hari_minggu'
cron.schedule('0 7 * * 1-5', () => {
  console.log('[WeeklyReport] Mengirim laporan mingguan...');
  // logika di sini
}, {
  timezone: 'Asia/Jakarta'  // ⚠️ PENTING: selalu set timezone!
});

// Jalankan setelah setupScheduler() di bawah
```

> **Tip:** Untuk cron independen, gunakan opsi `timezone` langsung. Untuk master cron, timezone WIB sudah dihandle manual dengan `toLocaleString`.

---

## 🕐 Format Ekspresi Cron

```
┌─── menit       (0–59)
│  ┌─── jam       (0–23)
│  │  ┌─── hari bulan (1–31)
│  │  │  ┌─── bulan    (1–12)
│  │  │  │  ┌─── hari minggu (0–7, Minggu=0 atau 7)
│  │  │  │  │
*  *  *  *  *
```

| Ekspresi | Artinya |
|----------|---------|
| `* * * * *` | Setiap menit |
| `0 7 * * *` | Setiap hari jam 07:00 |
| `30 7 * * 1-5` | Senin–Jumat jam 07:30 |
| `0 7,15,18 * * *` | Jam 07:00, 15:00, 18:00 setiap hari |
| `*/5 * * * *` | Setiap 5 menit |
| `0 0 1 * *` | Tanggal 1 setiap bulan jam 00:00 |

---

## ⚠️ Guard Pattern — Cegah Eksekusi Ganda

Selalu gunakan guard variable agar cron tidak dieksekusi ganda:

```js
let schedulerRunning = false;

cron.schedule('* * * * *', async () => {
  if (schedulerRunning) return;  // ← skip jika masih berjalan
  schedulerRunning = true;

  try {
    // ... logika berat di sini
  } finally {
    schedulerRunning = false;  // ← HARUS di finally agar selalu direset
  }
});
```

---

## 🔄 Restart Scheduler Tanpa Restart Server

```js
// Hentikan cron lama
masterCron.stop();
masterCron = null;

// Buat cron baru
setupScheduler();
```

Digunakan saat konfigurasi jadwal berubah dari dashboard admin.

---

## 🧪 Manual Trigger (Test tanpa tunggu jadwal)

```http
POST /api/scheduler/run-now
Authorization: Bearer <token>
Content-Type: application/json

{ "type": "pagi" }
```

Tersedia di dashboard → **Pengiriman Manual**.

---

## 📋 Checklist Membuat Cron Baru

- [ ] Install `node-cron` jika belum: `npm install node-cron`
- [ ] Tentukan jadwal (ekspresi cron atau perbandingan jam/menit WIB)
- [ ] Buat fungsi `async` untuk logika utama
- [ ] Tambahkan guard `isRunning` jika proses bisa lambat
- [ ] Handle timezone dengan benar (`Asia/Jakarta`)
- [ ] Tambahkan `console.log` di awal agar mudah debugging
- [ ] Tambahkan `addLog()` untuk menyimpan riwayat ke `logs.json`
- [ ] Tambahkan `logNotificationToSupabase()` jika terkait pengiriman WA
- [ ] Pastikan error di-catch agar tidak crash server
- [ ] Test dengan manual trigger sebelum tunggu jadwal

---

## 🗂️ File Referensi

| File | Keterangan |
|------|------------|
| `server.js` | Seluruh logika backend + cron (line ~1474–1755) |
| `ecosystem.config.js` | Konfigurasi PM2 |
| `Kelola_PM2.bat` | Script Windows untuk kelola PM2 |
| `config.json` | Konfigurasi lokal (fallback single-tenant) |
| `create_notification_logs.sql` | SQL untuk buat tabel log di Supabase |

---

## 🚀 Menjalankan Server (PM2)

```bash
# Start / restart dengan PM2
pm2 start ecosystem.config.js
pm2 restart epresensi-sinaga

# Lihat log real-time
pm2 logs epresensi-sinaga

# Auto-start saat Windows restart
pm2 save
pm2 startup
```

Atau gunakan `Kelola_PM2.bat` yang sudah tersedia.

---

## 📱 Baileys — WhatsApp Web Gateway Self-Hosted

### Apa itu Baileys?

[`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) adalah library Node.js yang mengimplementasikan **WhatsApp Web Multi-Device protocol** secara langsung — tanpa biaya, tanpa API pihak ketiga. Di project ini, Baileys menggantikan Fonnte sebagai gateway utama pengiriman WA.

| Fitur | Baileys | Fonnte |
|-------|---------|--------|
| Biaya | **Gratis selamanya** | Berbayar (per kuota) |
| Setup | Scan QR Code sekali | Daftar akun + token |
| Kecepatan | Realtime via WebSocket | HTTP API |
| Limit kirim | Tidak ada (sesuai WA) | Tergantung paket |
| Dependensi | Self-hosted di server | Cloud pihak ketiga |

---

### 🏗️ Arsitektur Baileys di Project Ini

```
┌─────────────────────────┐         ┌───────────────────────────┐
│   Dashboard Frontend    │──HTTP──▶│   Express Server (API)    │
│  (Halaman Pengaturan)   │         │  /api/wa/qr               │
└─────────────────────────┘         │  /api/wa/status           │
                                    │  /api/wa/logout           │
                                    └─────────────┬─────────────┘
                                                  │
                                     makeWASocket()│ (WebSocket TLS)
                                                  ▼
┌─────────────────────────┐         ┌───────────────────────────┐
│  baileys_auth_info/     │◀────────│  @whiskeysockets/baileys  │
│  (Session Keys/Creds)   │         │  WhatsApp Multi-Device    │
└─────────────────────────┘         └─────────────┬─────────────┘
                                                  │ TLS Encrypted
                                                  ▼
                                    ┌───────────────────────────┐
                                    │   WhatsApp Web Servers    │
                                    └───────────────────────────┘
```

---

### ⚡ Inisialisasi Baileys saat Server Start

```js
// server.js — fungsi initBaileys()
async function initBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
  const { version } = await fetchLatestBaileysVersion()
    .catch(() => ({ version: [2, 3000, 1015901307] }));  // fallback versi

  waSock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,     // QR ditampilkan di dashboard web
    logger: pino({ level: 'silent' }),  // matikan noise log Baileys
    browser: ['ePresensi Sinaga', 'Chrome', '1.0.0']
  });

  waSock.ev.on('creds.update', saveCreds);  // simpan session otomatis
  waSock.ev.on('connection.update', handleConnectionUpdate);
}

// Panggil saat server start
initBaileys();
```

---

### 🔄 Auto-Reconnect & Lifecycle

Ini bagian terpenting dari implementasi Baileys — menangani semua skenario disconnect:

```js
waSock.ev.on('connection.update', async (update) => {
  const { connection, lastDisconnect, qr } = update;

  // 1. QR Code tersedia → simpan ke dataURL untuk ditampilkan di dashboard
  if (qr) {
    waConnectionStatus = 'qr_ready';
    waQrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 7, margin: 2 });
  }

  // 2. Koneksi terputus
  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    waConnectionStatus = 'disconnected';
    waDisconnectedAt = Date.now();  // catat waktu disconnect

    if (shouldReconnect) {
      // Disconnect sementara (network drop) → reconnect otomatis 4 detik
      setTimeout(initBaileys, 4000);
    } else {
      // Logout resmi dari HP → hapus sesi, mulai ulang untuk QR baru
      fs.rmSync('baileys_auth_info', { recursive: true, force: true });
      setTimeout(initBaileys, 2000);
    }
  }

  // 3. Terhubung berhasil
  if (connection === 'open') {
    waConnectionStatus = 'connected';
    const cleanNumber = waSock.user?.id.split(':')[0];
    console.log(`[WhatsApp Web] ✅ Terhubung: +${cleanNumber}`);

    // ⚠️ Alert admin jika tadi disconnect > 5 menit
    if (waDisconnectedAt) {
      const downMin = Math.round((Date.now() - waDisconnectedAt) / 60000);
      if (downMin >= 5) {
        sendWhatsApp(adminNo, `⚠️ WA sempat terputus ${downMin} menit dan baru terhubung kembali.`);
      }
      waDisconnectedAt = null;
    }
  }
});
```

**Skenario yang ditangani:**

| Kejadian | Deteksi | Aksi |
|----------|---------|------|
| Network drop sesaat | `statusCode !== loggedOut` | Reconnect otomatis 4 detik |
| Logout dari HP | `statusCode === loggedOut` | Hapus sesi + mulai ulang QR |
| Server restart | Session tersimpan di folder | Auto-reconnect tanpa QR |
| Disconnect > 5 menit | `waDisconnectedAt` | Kirim alert WA ke admin |

---

### 📤 Smart Gateway Dispatcher

Sistem otomatis memilih gateway terbaik yang tersedia:

```js
async function sendWhatsApp(target, message, tokenOverride = null) {
  const cfg = loadConfig();
  const isBaileysActive = waSock && waConnectionStatus === 'connected';
  const gateway = cfg.waGateway || (isBaileysActive ? 'baileys' : 'fonnte');

  if (gateway === 'fonnte' && !isBaileysActive && (tokenOverride || cfg.fonnteToken)) {
    // Kirim via Fonnte HTTP API
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: token },
      body: new URLSearchParams({ target, message, countryCode: '62' })
    });
    return { success: result.status === true, gateway: 'fonnte' };

  } else {
    // Kirim via Baileys WebSocket
    if (!waSock || waConnectionStatus !== 'connected') {
      return { success: false, error: 'WhatsApp belum terhubung. Scan QR Code dulu.' };
    }

    // Normalisasi nomor → JID internasional
    let clean = target.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    clean = `${clean}@s.whatsapp.net`;

    const sent = await waSock.sendMessage(clean, { text: message });
    return { success: !!sent, gateway: 'baileys' };
  }
}
```

**Prioritas Gateway:**
```
config.waGateway === 'baileys'  →  pakai Baileys
config.waGateway === 'fonnte'   →  pakai Fonnte (meski Baileys aktif)
Baileys connected               →  otomatis pakai Baileys
Baileys disconnected            →  fallback ke Fonnte
```

---

### 🔢 Normalisasi Format Nomor Telepon

Baileys mewajibkan format **JID internasional** (`628xxx@s.whatsapp.net`).
Project ini menangani semua variasi input:

```js
let clean = String(target).replace(/[^0-9]/g, '');  // hapus semua non-angka
if (clean.startsWith('0')) clean = '62' + clean.slice(1);
// Contoh:
// '085868733378'     → '6285868733378@s.whatsapp.net' ✅
// '+62 858-6873-3378'→ '6285868733378@s.whatsapp.net' ✅
// '85868733378'      → '8585868733378@s.whatsapp.net' ✅
```

---

### 🔁 Retry Wrapper (3x, Exponential Backoff)

```js
async function sendWhatsAppWithRetry(target, message, tokenOverride = null, maxRetry = 3) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    const result = await sendWhatsApp(target, message, tokenOverride);
    if (result.success) return result;

    if (attempt < maxRetry) {
      const delayMs = 2000 * Math.pow(2, attempt - 1);  // 2s → 4s → 8s
      console.warn(`[WA Retry] Attempt ${attempt}/${maxRetry} gagal, coba lagi ${delayMs/1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return lastResult;  // kembalikan hasil terakhir (gagal)
}
```

---

### 🗂️ File Session Baileys

```
baileys_auth_info/
  ├── creds.json          ← kredensial akun WA (JANGAN di-commit!)
  ├── app-state-sync-*.json
  └── pre-key-*.json
```

> **⚠️ PENTING:** Folder `baileys_auth_info/` sudah masuk `.gitignore`.
> Jangan pernah commit folder ini — berisi private key sesi WA yang bisa dipakai orang lain untuk ambil alih akun.

---

### 🛠️ Troubleshooting Baileys

| Gejala | Penyebab | Solusi |
|--------|----------|--------|
| QR Code tidak muncul | Server baru start atau session corrupt | Tunggu ~5 detik, refresh halaman Pengaturan |
| "WhatsApp belum terhubung" saat kirim | `waConnectionStatus !== 'connected'` | Buka halaman Pengaturan → Scan QR |
| QR expired sebelum di-scan | Timeout 60 detik dari WA | Refresh halaman untuk generate QR baru |
| Pesan terkirim tapi tidak sampai | Nomor format salah | Pastikan nomor diawali `08` atau `62` |
| Session hilang setelah restart | `baileys_auth_info/` terhapus | Scan QR ulang sekali, sesi tersimpan otomatis |
| Log penuh noise Baileys | Logger default verbose | Sudah dimatikan dengan `pino({ level: 'silent' })` |
| WA logout sendiri | Terlalu banyak perangkat terhubung | Logout dari semua sesi lain di HP |

---

### 📋 Checklist Setup Baileys di Project Baru

- [ ] `npm install @whiskeysockets/baileys pino qrcode`
- [ ] Pastikan `baileys_auth_info/` ada di `.gitignore`
- [ ] Buat fungsi `initBaileys()` dengan `useMultiFileAuthState`
- [ ] Handle semua event: `qr`, `connection === 'close'`, `connection === 'open'`
- [ ] Bedakan disconnect sementara vs logout permanen via `DisconnectReason.loggedOut`
- [ ] Set `logger: pino({ level: 'silent' })` agar log tidak berisik
- [ ] Tambahkan normalisasi nomor telepon sebelum kirim
- [ ] Tambahkan retry wrapper untuk toleransi error sesaat
- [ ] Expose `/api/wa/qr` dan `/api/wa/status` untuk dashboard
- [ ] Test kirim pesan ke nomor sendiri sebelum kirim massal

---

## 🗂️ File Referensi

| File | Keterangan |
|------|------------|
| `server.js` | Seluruh logika backend + cron + Baileys (line ~1474–1755) |
| `BAILEYS_GUIDE.md` | Troubleshooting mendalam Baileys |
| `ecosystem.config.js` | Konfigurasi PM2 |
| `Kelola_PM2.bat` | Script Windows untuk kelola PM2 |
| `config.json` | Konfigurasi lokal (fallback single-tenant) |
| `create_notification_logs.sql` | SQL untuk buat tabel log di Supabase |

---

## 🚀 Menjalankan Server (PM2)

```bash
# Start / restart dengan PM2
pm2 start ecosystem.config.js
pm2 restart epresensi-sinaga

# Lihat log real-time
pm2 logs epresensi-sinaga

# Auto-start saat Windows restart
pm2 save
pm2 startup
```

Atau gunakan `Kelola_PM2.bat` yang sudah tersedia.

---

*Dibuat: 2026-08-19 | Terakhir diperbarui: 2026-08-31 | ePresensi Sinaga — SMKN 3 Magelang*

---

## 📋 Riwayat Perubahan

| Tanggal | Perubahan |
|---------|----------|
| 2026-08-19 | Dokumen dibuat |
| 2026-08-31 | Tambah jadwal khusus **Jumat pulang awal** (`jumat_pulang_*`), penjelasan `dayOfWeek`, dan migration SQL Supabase |
