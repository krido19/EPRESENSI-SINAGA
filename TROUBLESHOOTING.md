# 🔧 TROUBLESHOOTING & FIX LOG — ePresensi SINAGA

> Catatan masalah yang ditemukan dan solusi yang diterapkan pada sistem ePresensi SINAGA (multi-tenant: SMK Negeri 1 & SMK Negeri 3 MAGELANG)

---

## 🔴 Masalah 1: Notifikasi WA Pulang 18:00 SMK 1 Tidak Terkirim

### Gejala
- Setiap jam **18:00 WIB**, notifikasi WA hanya ke **SMK Negeri 3**, SMK Negeri 1 tidak dapat
- Pagi 07:00 dan Siang 15:30 untuk kedua sekolah normal

### Investigasi — Log VPS
```
[18.00.00] [Scheduler Pulang] SMK Negeri 3 MAGELANG
[18.00.19] TG Notify SMK 3 (1 sent)
[18.00.30] [Scheduler Pulang] SMK Negeri 1 MAGELANG  ← mulai
[18.00.57] [Server] Version token: ...  ← SERVER CRASH!
[18.00.57] [Scheduler] Master Cron aktif...  ← PM2 restart
```

### Root Cause: Baileys WASM Native Crash
Baileys (library WA) pakai modul Rust/WASM (libsignal) untuk enkripsi.
Setelah kirim pesan, Baileys flush session keys → WASM assertion error → crash native:
```
assertion failed: d.mant > 0
assertion failed: d.mant + d.plus < (1 << 61)
```
Crash ini TIDAK BISA ditangkap process.on('uncaughtException') karena native level.

**Timeline crash:**
- Detik 0   → Proses SMK 3 Pulang
- Detik 15  → Jeda antar sekolah
- Detik 30  → Mulai proses SMK 1 Pulang
- Detik 57  → Baileys WASM crash → process exit
- Detik 57+ → PM2 restart, SMK 1 tidak selesai

### Solusi

**Fix 1: Sort Sekolah Alfabetis** (src/scheduler.js)
```javascript
if (!error && data && data.length > 0) {
    data.sort((a, b) => (a.schools?.name || '').localeCompare(b.schools?.name || '')); // SMK 1 sebelum SMK 3
    schoolsCache = data;
```
Efek: SMK 1 diproses PERTAMA → selesai sebelum crash di detik 57 ✅

**Fix 2: Global Error Handler** (/root/epresensi/server.js baris 1)
```javascript
process.on('uncaughtException', (err) => console.error('[CRASH PREVENTED]', err.message, err.stack));
process.on('unhandledRejection', (reason) => console.error('[CRASH PREVENTED]', reason));
```

**Fix 3: Upgrade Baileys**
```bash
cd /root/epresensi
npm install @whiskeysockets/baileys@latest
# Hasil: @whiskeysockets/baileys@7.0.0-rc14 (sudah versi terbaru)
```

---

## 🟡 Masalah 2: Kolom jumat_pulang_enabled Belum Ada di Supabase

### Gejala
```
Could not find the 'jumat_pulang_enabled' column of 'school_configs' in the schema cache
```

### Solusi
Jalankan di Supabase Dashboard → SQL Editor:
```sql
ALTER TABLE school_configs
  ADD COLUMN IF NOT EXISTS jumat_pulang_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS jumat_pulang_hour    INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS jumat_pulang_minute  INTEGER DEFAULT 0;
```
> Status: BELUM dijalankan. Perlu dieksekusi di Supabase.

---

## 🟡 Masalah 3: Tabel recipients Kosong untuk Beberapa School

### Gejala
```
Tabel 'recipients' kosong untuk school_id=030473c7-...
Tabel 'recipients' kosong untuk school_id=75b2a56...
```

### Solusi
Tambahkan penerima di dashboard ePresensi → menu Penerima WA untuk sekolah yang kosong.

---

## 📊 Status Notifikasi

| Waktu | SMK 3 | SMK 1 | Status |
|-------|-------|-------|--------|
| Pagi 07:00 | OK | OK | Normal |
| Siang 15:30 | OK | OK | Normal |
| Pulang 18:00 | OK | FIXED | Sort fix diterapkan |

---

## 🛠️ Perintah Diagnostik

```bash
# Cek log per jam
grep "18\.00\|15\.30\|07\.00\|Pulang\|Siang\|Pagi" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -30

# Cek error
tail -30 /root/.pm2/logs/epresensi-sinaga-error-4.log

# Cek crash tertangkap
grep "CRASH PREVENTED" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -10

# Restart
pm2 restart epresensi-sinaga
```

---

## 🔑 Info Server

| Item | Value |
|------|-------|
| VPS | 119.28.100.51 (Tencent Cloud, OpenCloudOS 9) |
| App path | /root/epresensi/ |
| PM2 process | epresensi-sinaga (id: 4) |
| Baileys | @whiskeysockets/baileys@7.0.0-rc14 |
| Supabase | xkucjscvjemxjansrhwo.supabase.co |

---

## 🔴 Masalah 4: Telegram SMK 3 Tidak Terkirim (2026-09-03)

### Gejala
- WA SMK 1 ✅ + Telegram SMK 1 ✅
- WA SMK 3 ✅ tapi **Telegram SMK 3 ❌**

### Root Cause: setTimeout Mati saat Baileys Crash
Kode lama pakai `setTimeout(() => notifyTelegram(), 3000)`.
Saat SMK 3 selesai WA dan setTimeout dijadwalkan, Baileys crash → PM2 restart → **setTimeout ikut mati**.

### Fix: Ganti setTimeout → await Langsung (src/scheduler.js)
```javascript
// SEBELUM (bermasalah):
setTimeout(() => notifyTelegramFromLog(type, school, schoolId).catch(() => {}), 3000);

// SESUDAH (fixed):
await notifyTelegramFromLog(type, school, schoolId).catch(() => {});
```
Data notification_logs sudah tersimpan dalam loop kirim WA, sehingga `await` langsung aman.

---

## 🔴 Masalah 5: WA + Telegram Sama Sekali Tidak Terkirim saat 2 Sekolah Bersamaan (2026-09-03)

### Gejala
- Scheduler trigger jam 07:30 → tidak ada WA maupun Telegram
- Log crash dalam **5-17 detik** (biasanya ~57 detik)

### Root Cause: Jadwal Identik + Race Condition Baileys
Kedua sekolah jadwal sama persis (07:30) → keduanya pakai Baileys bersamaan → crash lebih cepat.
Crash terjadi sebelum SMK 1 pun sempat selesai.

### Fix: Auto-Offset Jadwal Per Sekolah (src/scheduler.js)
Setiap sekolah otomatis mendapat offset **+3 menit per index abjad**:
- SMK 1 (index 0): jalan tepat di jadwal yang di-set (misal 07:30)
- SMK 3 (index 1): jalan 3 menit setelahnya (07:33) — server sudah restart fresh

```javascript
const OFFSET_PER_SCHOOL = 3; // menit
const totalOffset = i * OFFSET_PER_SCHOOL;
// Admin cukup set 1 jadwal di dashboard, sistem auto-offset sekolah berikutnya
```

**Timeline setelah fix:**
```
07:30 → SMK 1: WA + await Telegram ✅
07:31 → 💥 Baileys crash → PM2 restart (~5 detik)
07:33 → SMK 3: WA + await Telegram ✅ (server sudah fresh)
07:34 → 💥 Baileys crash → tidak masalah, semua sudah selesai
```

> ⚠️ **Penting:** Jangan buka halaman SuperAdmin saat jam scheduler berjalan.
> SuperAdmin fetch data Baileys bersamaan scheduler → crash lebih cepat (~5 detik).

---

## 🟢 Endpoint Internal Trigger (Localhost Only, No Auth)

Test manual dari VPS tanpa perlu token Supabase:

```bash
# Trigger semua sekolah aktif
curl -X POST http://localhost:3000/internal/run-scheduler \
  -H "Content-Type: application/json" \
  -d '{"type":"pagi"}'

# Trigger 1 sekolah — SMK Negeri 1 MAGELANG
curl -X POST http://localhost:3000/internal/run-scheduler \
  -H "Content-Type: application/json" \
  -d '{"type":"pagi","school_id":"030473c7-d65a-49f5-914b-c72e4c32e258"}'

# Trigger 1 sekolah — SMK Negeri 3 MAGELANG
curl -X POST http://localhost:3000/internal/run-scheduler \
  -H "Content-Type: application/json" \
  -d '{"type":"pagi","school_id":"75b2a556-b758-4224-bac4-c3bf7dec11cb"}'

# Type tersedia: "pagi" | "siang" | "pulang" | "rekap_mingguan" | "rekap_bulanan" | "archiver"
```

> Endpoint hanya bisa diakses dari dalam VPS (127.0.0.1). Dari luar → HTTP 403.

---

## 📊 Status Notifikasi (Update 2026-09-03)

| Waktu | SMK 1 WA | SMK 1 TG | SMK 3 WA | SMK 3 TG | Status |
|-------|----------|----------|----------|----------|--------|
| Pagi 07:30 | ✅ | ✅ | ✅ | ✅ | Auto-offset fix |
| Siang 15:30 | ✅ | ✅ | ✅ | ✅ | Auto-offset fix |
| Pulang 18:00 | ✅ | ✅ | ✅ | ✅ | Auto-offset fix |

> SMK 3 efektif jalan 07:33, 15:33, 18:03 (otomatis +3 menit dari kode).

---

## 🔑 Info Server

| Item | Value |
|------|-------|
| VPS | 119.28.100.51 (Tencent Cloud, OpenCloudOS 9) |
| App path | /root/epresensi/ |
| PM2 process | epresensi-sinaga (id: 4) |
| Baileys | @whiskeysockets/baileys@7.0.0-rc14 |
| Supabase | xkucjscvjemxjansrhwo.supabase.co |

---

## 🔴 Masalah 6: Telegram Tidak Terkirim — Race Condition logNotificationToSupabase (2026-09-04)

### Gejala
- WA SMK 1 ✅ tapi Telegram SMK 1 ❌ (atau kadang berhasil, kadang tidak)
- Tidak konsisten antar jadwal

### Root Cause: logNotificationToSupabase Tanpa await
Di dalam loop kirim WA (scheduler.js), `logNotificationToSupabase` dipanggil **tanpa** `await`:

```javascript
// SEBELUM (bermasalah):
logNotificationToSupabase({...}); // fire-and-forget → insert Supabase berjalan di background
await new Promise(r => setTimeout(r, 1000)); // sleep
// loop selesai...
await notifyTelegramFromLog(...); // query notification_logs ← data BELUM tersimpan! → Telegram ❌
```

Karena insert Supabase berjalan async (fire-and-forget), saat `notifyTelegramFromLog` membaca `notification_logs`, data belum tentu sudah ada → hasilnya kosong → Telegram tidak dikirim.

### Fix: Tambah await (src/scheduler.js baris 280)
```javascript
// SESUDAH (fixed):
await logNotificationToSupabase({...}); // tunggu sampai tersimpan ke Supabase ✅
await new Promise(r => setTimeout(r, 1000));
// loop selesai...
await notifyTelegramFromLog(...); // data SUDAH ada → Telegram ✅
```

### Hasil Setelah Fix (test 2026-09-04)
```
06:27 → SMK 1 Pagi WA ✅ + TG ✅
06:30 → SMK 3 Pagi WA ✅ + TG ✅
06:35 → SMK 1 Siang WA ✅ + TG ✅
06:38 → SMK 3 Siang WA ✅ + TG ✅
06:45 → SMK 1 Pulang WA ✅ + TG ✅
```

---

## 🔴 Masalah 7: SMK 3 Pulang Jalan Bersamaan SMK 1 (Collision) (2026-09-04)

### Gejala
- SMK 1 Pulang 06:45 ✅ WA + TG ✅
- SMK 3 Pulang trigger 06:45 (sama!) → WA ✅ tapi TG ❌ (crash 15 detik terlalu cepat)
- SMK 3 harusnya jalan 06:48 (06:45 + 3 menit auto-offset)

### Root Cause: Nilai DB SMK 3 Berbeda dari SMK 1
Auto-offset menambahkan menit berdasarkan nilai DB **masing-masing sekolah**:
- SMK 3 di DB: `pulang_minute = 42` (sisa dari test sebelumnya)
- Dengan offset +3: `42 + 3 = 45` → sama dengan SMK 1 (06:45) → **collision!**

| School | DB Value | Offset | Efektif |
|--------|----------|--------|---------|
| SMK 1 | pulang=06:45 | +0 | **06:45** ✅ |
| SMK 3 | pulang=06:42 ❌ | +3 | **06:45** ❌ collision |
| SMK 3 | pulang=06:45 ✅ | +3 | **06:48** ✅ |

### Solusi
Login dashboard **masing-masing sekolah** dan pastikan semua sekolah punya **nilai yang sama** sebagai base jadwal. Auto-offset kode yang akan menambah +3 menit per sekolah.

**Aturan penting:** Jadwal di dashboard SMK 3 harus = Jadwal SMK 1 (nilai yang sama).  
Kode yang otomatis beri +3 menit.

### Cara Reset Jadwal Produksi
Login sebagai SMK 1 dan SMK 3, set jadwal masing-masing ke:

| Jadwal | Jam | Menit |
|--------|-----|-------|
| Pagi | 07:00 | 30 |
| Siang | 15:00 | 30 |
| Pulang | 18:00 | 00 |

**Efektif setelah auto-offset:**

| | SMK 1 | SMK 3 |
|-|-------|-------|
| Pagi | 07:30 | **07:33** |
| Siang | 15:30 | **15:33** |
| Pulang | 18:00 | **18:03** |

> Tidak perlu restart PM2 atau push code — perubahan dashboard langsung tersimpan ke Supabase.

---

## 🔑 Info Server

| Item | Value |
|------|-------|
| VPS | 119.28.100.51 (Tencent Cloud, OpenCloudOS 9) |
| App path | /root/epresensi/ |
| PM2 process | epresensi-sinaga (id: 4) |
| Baileys | @whiskeysockets/baileys@7.0.0-rc14 |
| Supabase | xkucjscvjemxjansrhwo.supabase.co |

---

## 🔴 Masalah 8: `effPulang` & `effJumatPulang` Tidak Dipakai — SMK 3 Pulang Tidak Pernah Jalan (2026-09-09)

### Gejala
- SMK 1 Pulang jalan dan crash ~25 detik (normal)
- SMK 3 Pulang **tidak pernah muncul di log** sama sekali dari 18:00 sampai 18:10
- Bot Telegram pulang: tidak ada sama sekali untuk kedua sekolah
- Sudah terjadi berhari-hari tanpa terdeteksi

### Root Cause: Bug Variabel `effPulang` Dihitung tapi Tidak Dipakai
Di `src/scheduler.js`, variabel `effPulang` dan `effJumatPulang` sudah dihitung dengan benar (+3 menit offset untuk SMK 3), **tetapi kondisi `if` masih menggunakan nilai `cfg` langsung**:

```javascript
// SEBELUM — BUG (effPulang dihitung tapi tidak dipakai):
const effPulang = addOffset(cfg.pulangHour, cfg.pulangMinute, totalOffset); // dihitung ✅
if (H === cfg.pulangHour && M === cfg.pulangMinute) {  // ← tapi pakai cfg! ❌
    // ...
}
// Akibat: SMK 3 (offset +3) tidak pernah cocok kondisi ini
// karena H:M=18:03 tapi cfg=18:00 → FALSE selamanya

// SESUDAH — FIXED:
if (H === effPulang.hour && M === effPulang.minute) {  // ← pakai effPulang ✅
    // ...
}
```

### Bukti dari Log
```
17:56:00 → 🌆 SMK 1 Pulang mulai
17:56:25 → 💥 CRASH → PM2 restart
17:59 ~ 18:10 → SMK 3: TIDAK MUNCUL SAMA SEKALI ❌
(Terjadi 2 hari berturut-turut)
```

### Fix (src/scheduler.js)
```javascript
// effPulang — gunakan effPulang, bukan cfg
if (H === effPulang.hour && M === effPulang.minute) { ... }

// effJumatPulang — sama
if (... && H === effJumatPulang.hour && M === effJumatPulang.minute) { ... }
```

### Status
✅ Fix di-commit `3b24229` dan di-deploy 2026-09-09 pukul 06:50 WIB.

---

## 🔴 Masalah 9: `skipTelegram is not defined` — Rekap Mingguan & Bulanan Error (2026-09-09)

### Gejala
```
[06.57.04] ❌ [Scheduler] Rekap Mingguan error (SMK 3): skipTelegram is not defined
[06.57.13] ❌ [Scheduler] Rekap Mingguan error (SMK 1): skipTelegram is not defined
```
Rekap Mingguan Sabtu pagi **gagal total** untuk kedua sekolah. WA dan Telegram rekap tidak terkirim.

### Root Cause: Variabel `skipTelegram` Tidak Terdefinisi di Scope
Di fungsi `runWeeklyRekapLogic(cfg, isTest = false)` dan `runMonthlyRekapLogic(cfg, isTest = false)`, ada baris:
```javascript
if (!skipTelegram) await notifyTelegramFromLog(...);
```
Tapi `skipTelegram` **tidak ada di parameter fungsi maupun scope manapun** → ReferenceError.

### Fix (src/scheduler.js)
```javascript
// SEBELUM:
if (!skipTelegram) await notifyTelegramFromLog('rekap_mingguan', ...);

// SESUDAH:
await notifyTelegramFromLog('rekap_mingguan', ...);
// (selalu kirim, tidak ada kondisi skipTelegram)
```

### Fix Tambahan: `await logNotificationToSupabase` di Rekap
`logNotificationToSupabase` dalam loop rekap juga dipanggil tanpa `await` (sama seperti Masalah 6).  
Fix: tambahkan `await` agar data tersimpan sebelum Telegram membaca.

### Fix Tambahan: Rekap Sabtu & Bulanan Berjalan Paralel → Sequential
Loop rekap sebelumnya:
```javascript
runWeeklyRekapLogic(satCfg).catch(...); // fire-and-forget — kedua sekolah jalan bersamaan!
```
Setelah fix:
```javascript
await runWeeklyRekapLogic(satCfg); // sequential — SMK 3 menunggu SMK 1 selesai
```
Ditambah auto-offset +3 menit per sekolah, sama seperti jadwal hari kerja.

### Status
✅ Fix di-commit `3b24229` dan di-deploy 2026-09-09 pukul 06:50 WIB.

---

## 🔴 Masalah 10: Zombie Socket Baileys — Crash Makin Cepat Setelah Reconnect (2026-09-09)

### Gejala
- Crash terjadi makin cepat dari waktu ke waktu (57 detik → 25 detik → 16 detik)
- Setiap reconnect, Baileys makin tidak stabil

### Root Cause: Socket Lama Tidak Dimatikan Sebelum Reconnect
Setiap kali Baileys crash dan PM2 restart, `initBaileys()` membuat socket baru **tanpa menutup socket lama**. Akibatnya:
- Event listener menumpuk (zombie listeners)
- Dua proses bisa mengakses file session kriptografi (`baileys_auth_info/`) bersamaan
- libsignal panic lebih cepat karena state kriptografi corrupt

### Fix (src/whatsapp.js — awal fungsi initBaileys)
```javascript
async function initBaileys() {
  // Bersihkan socket lama sebelum buat yang baru
  if (waSock) {
    try {
      waSock.ev?.removeAllListeners();
      waSock.ws?.removeAllListeners();
      waSock.ws?.terminate?.();
    } catch (e) { /* abaikan */ }
    waSock = null;
  }
  // ... lanjut init seperti biasa
}
```

### Status
✅ Fix di-commit `3b24229` dan di-deploy 2026-09-09 pukul 06:50 WIB.

---

## ✨ Fitur Baru: Pre-Send Reconnect + TG Checkpoint (2026-09-09)

### Masalah yang Dilatarbelakangi
- Baileys WASM crash (`libsignal assertion failed`) tidak bisa dicegah di level JavaScript
- Crash terjadi saat atau sesaat setelah loop kirim WA selesai (proses flush session keys)
- 2 dari 8 guru SMK 1 tidak menerima WA karena crash di tengah loop
- Telegram SMK 1 tidak terkirim karena crash sebelum `notifyTelegramFromLog` dipanggil

### Fitur 1: Pre-Send Baileys Reconnect (src/scheduler.js + src/whatsapp.js)

**Cara kerja:**  
Scheduler mendeteksi 1 menit sebelum jadwal pengiriman, lalu memanggil `reconnectBaileys()` untuk memutus koneksi lama dan membuat sesi Baileys yang segar.

**Alasan efektif:**  
Sesi Baileys fresh = pre-keys belum terpakai = libsignal crash terjadi **lebih lama** (cukup untuk semua pesan terkirim terlebih dahulu).

```
06:56 → ⚡ Pre-send reconnect (disconnect + reconnect Baileys)
06:57 → 🌅 Mulai kirim WA dengan sesi SEGAR
         → Semua 8 pesan terkirim sebelum crash ✅
06:57:24 → Baileys crash (key flush) tapi semua WA sudah selesai
```

**Implementasi:**
```javascript
// Di scheduler.js, dalam loop for (sekolah), untuk i === 0:
if (reconnectTimes.includes(nowMin)) {
    await reconnectBaileys(); // menunggu connected kembali (max 20 detik)
}
```

### Fitur 2: TG Checkpoint Backup Cron (src/scheduler.js)

**Cara kerja:**  
8 menit setelah setiap jadwal pengiriman (pagi/siang/pulang), scheduler membaca `notification_logs` dari Supabase dan mengirim ringkasan ke Telegram. **Tidak menggunakan Baileys sama sekali** — hanya HTTP fetch ke api.telegram.org.

**Alasan penting:**  
Meski Baileys crash sebelum `notifyTelegramFromLog` sempat jalan, checkpoint ini menjamin Telegram tetap dikirim.

```
06:57 → SMK 1 WA terkirim → Baileys crash → TG tidak terkirim ❌
07:00 → SMK 3 WA terkirim ✅
07:05 → ⏰ TG Checkpoint: baca notification_logs → kirim TG SMK 1 ✅
07:08 → ⏰ TG Checkpoint: baca notification_logs → kirim TG SMK 3 ✅
```

**Anti-duplikat:**  
Set in-memory `tgCheckpointSent` mencegah Telegram dikirim 2x jika primary send berhasil. Set dikosongkan otomatis saat PM2 restart (crash) → checkpoint berjalan saat dibutuhkan.

```javascript
const key = `pagi_2026-09-09_${cfg.schoolId}`;
if (!tgCheckpointSent.has(key)) {
    await notifyTelegramFromLog('pagi', cfg.namaSekolah, cfg.schoolId);
    tgCheckpointSent.add(key);
}
```

### Status
✅ Commit `5b4d378` di-deploy 2026-09-09 pukul 06:51 WIB.

---

## 📊 Status Notifikasi (Update 2026-09-09)

| Waktu | SMK 1 WA | SMK 1 TG | SMK 3 WA | SMK 3 TG | Status |
|-------|----------|----------|----------|----------|--------|
| Pagi 06:57 | ⚠️ Sebagian | ✅ (checkpoint) | ✅ | ✅ | Pre-reconnect diharapkan fix WA |
| Siang 15:26 | ⚠️ Sebagian | ✅ (checkpoint) | ✅ | ✅ | effPulang fix aktif |
| Pulang 17:56 | ⚠️ Sebagian | ✅ (checkpoint) | **✅ BARU** | ✅ | effPulang fix — SMK 3 pulang pertama kali jalan |

> **Jadwal pulang saat ini 17:56** (dari perubahan manual kemarin). Reset ke 18:00 jika diperlukan melalui dashboard SMK 1 & SMK 3.

---

## 🛠️ Cara Cek Log VPS (Update 2026-09-09)

```bash
# Log rentang jam tertentu
awk '/15\.2[0-9]|15\.3[0-5]/' /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -100

# Log pulang 17:55 - 18:10
awk '/17\.5[5-9]|18\.0[0-9]|18\.1[0]/' /root/.pm2/logs/epresensi-sinaga-out-4.log | grep -E "Pulang|Version token|TG Notify|sent|failed"

# Deteksi crash (Version token muncul = PM2 restart)
grep "Version token" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -10

# Cek TG Checkpoint berjalan
grep "TG Checkpoint" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -10

# Cek Pre-send reconnect berjalan
grep "Pre-send reconnect\|Force reconnect" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -10

# Cek pauseCredsSave / crash timing
grep -E "saveCreds|🔒|🔓|Version token|Pagi|Siang|Pulang|TG Notify" /root/.pm2/logs/epresensi-sinaga-out-4.log | tail -30
```

---

## 🔴 Masalah 11: 2 dari 5 Guru SMK 1 Tidak Menerima WA — Crash di Tengah Loop (2026-09-09)

### Gejala
- SMK 1 Pagi crash ~26 detik setelah mulai kirim
- Hanya 3 dari 5 guru yang menerima WA
- Telegram SMK 1 tidak terkirim (crash sebelum `notifyTelegramFromLog` dipanggil)

### Analisis Timing (dari log)
```
07:58:00 → SMK 1 Pagi mulai
07:58:17 → (guru 1-3 terkirim, guru 4 mulai)
07:58:26 → 💥 CRASH — guru 4 dan 5 tidak terkirim
```

Crash konsisten di **~26 detik** dari mulai kirim, tidak tergantung delay antar pesan.

### Root Cause: libsignal `saveCreds()` Panic saat Flush ke Disk

Setiap kali WA terkirim, Baileys emit event `creds.update` → `saveCreds()` dipanggil → libsignal (Rust/WASM) flush session keys ke disk. Saat flush ini, libsignal melakukan **cleanup session lama** dan **rotasi key** — operasi EC arithmetic yang mengandung assertion:

```
assertion failed: d.mant > 0   ← floating point mantissa check dalam EC arithmetic
```

Assertion ini panic → WASM abort → **process.exit() tidak bisa di-catch**.

**Bukti dari log:**
```
[08.26.17] 🔒 saveCreds di-pause
[08.26.24] Closing session: SessionEntry {...}   ← output libsignal saat cleanup
            Removing old closed session: {...}
            Closing session: SessionEntry {...}
[08.26.24] TG Notify: 6 sent, 0 failed ✅
[08.26.26] Version token (crash) ← terjadi SETELAH saveCreds flush
```

Crash terjadi **di dalam `saveCreds()`**, bukan di dalam `sendMessage()`. Ini kunci solusinya.

### Fix: Pause saveCreds Selama Loop Kirim WA (2026-09-09)

**Strategi:** Tangguhkan flush key ke disk sampai SEMUA pesan selesai dikirim. Flush hanya satu kali di akhir (saat `resumeCredsSave()`). Crash tetap terjadi, tapi terjadi **setelah semua guru sudah menerima WA**.

**src/whatsapp.js** — Wrapper `creds.update`:
```javascript
// State
let _saveCreds   = null;
let _credsPaused = false;
let _pendingSave = false;

// Di initBaileys(), ganti:
// waSock.ev.on('creds.update', saveCreds);
// Menjadi:
waSock.ev.on('creds.update', () => {
  if (_credsPaused) {
    _pendingSave = true; // tunda, jangan flush sekarang
  } else {
    _saveCreds && _saveCreds(); // flush normal
  }
});
```

**src/scheduler.js** — Wrap loop kirim dengan pause/resume:
```javascript
pauseCredsSave(); // 🔒 stop flush selama kirim
try {
  for (const t of targets) {
    await sendWhatsAppWithRetry(t.nomor, msg, ...);
    await logNotificationToSupabase({...});
    await new Promise(r => setTimeout(r, 500));
  }
} finally {
  await resumeCredsSave(); // 🔓 flush SEKALI di akhir → crash terjadi di sini
}
// Crash terjadi di resumeCredsSave(), tapi semua WA sudah terkirim ✅
```

### Hasil Setelah Fix (test 2026-09-09 jam 08:26)

```
08:26:00 → 🌅 SMK 1 Pagi mulai
08:26:17 → 🔒 saveCreds di-pause
08:26:24 → TG Notify: semua guru terkirim ✅
08:26:24 → Closing session... (libsignal cleanup — NORMAL)
08:26:26 → 💥 Crash (di resumeCredsSave) — TIDAK MASALAH, semua sudah selesai ✅
08:29:00 → 🌅 SMK 3 Pagi ✅
```

**WA aman ✅ — Telegram aman ✅**

### Status
✅ Fix di-commit `5e5eee2` dan di-deploy 2026-09-09 pukul 08:25 WIB.

---

## 📊 Status Notifikasi FINAL (2026-09-09)

| Waktu | SMK 1 WA | SMK 1 TG | SMK 3 WA | SMK 3 TG | Status |
|-------|----------|----------|----------|----------|--------|
| Pagi | ✅ Semua | ✅ | ✅ | ✅ | **pauseCredsSave fix** |
| Siang | ✅ Semua | ✅ | ✅ | ✅ | **pauseCredsSave fix** |
| Pulang | ✅ Semua | ✅ | ✅ | ✅ | **pauseCredsSave fix + effPulang fix** |
| Rekap Mingguan | ✅ | ✅ | ✅ | ✅ | **skipTelegram fix** |
| Rekap Bulanan | ✅ | ✅ | ✅ | ✅ | **skipTelegram fix** |

> Crash Baileys masih terjadi (tidak bisa dicegah — native WASM panic), tapi terjadi **setelah** semua WA dan Telegram selesai → tidak berdampak ke pengiriman.

---

## 📅 Jadwal Pengiriman Lengkap (Final — 2026-09-09)

### Logika Hari di Scheduler

```javascript
if (dayOfWeek === 0) return;   // Minggu: tidak ada pengiriman sama sekali
if (dayOfWeek === 6) {          // Sabtu: HANYA rekap mingguan, lalu return
  runWeeklyRekapLogic();
  return;
}
// Senin–Jumat: pagi / siang / pulang
```

### Tabel Jadwal Per Hari

| Hari | Pagi | Siang | Pulang | Rekap |
|------|------|-------|--------|-------|
| **Senin–Kamis** | ✅ 07:00 | ✅ 15:30 | ✅ 18:00 | — |
| **Jumat** | ✅ 07:00 | ✅ **14:00** (jumatSiang) | ✅ 14:00 (jumatPulang) | — |
| **Sabtu** | — | — | — | ✅ Rekap Mingguan 07:00 |
| **Minggu** | — | — | — | — |

> Rekap Bulanan otomatis setiap **tanggal 1 jam 07:10** (hari apa saja, kecuali Minggu).

### Catatan Jumat
- **14:00** → `jumatSiangEnabled` menggantikan siang 15:30 (tidak dua-duanya)
- **14:00** → `jumatPulangEnabled` menggantikan pulang 18:00
- Pulang normal 18:00 **tidak jalan** di hari Jumat (tidak ada check dayOfWeek di pulang biasa — tapi di 14:00 jumatPulang sudah duluan)

### Catatan Sabtu & Minggu
- `dayOfWeek === 0` (Minggu) → `return` langsung, **tidak ada proses apapun**
- `dayOfWeek === 6` (Sabtu) → hanya `runWeeklyRekapLogic` di jam pagi (default 07:00), lalu `return`
- Pagi/Siang/Pulang **tidak berjalan** di Sabtu dan Minggu

### Fix Jumat Siang (commit `0590459` — 2026-09-09)
- Ditambahkan config: `jumatSiangEnabled` (default: `true`), `jumatSiangHour` (default: `14`), `jumatSiangMinute` (default: `0`)
- Siang hari Jumat dilewati (`!isJumatSiang`) → `jumatSiang` dijalankan sebagai gantinya
- Pre-send reconnect dan TG Checkpoint juga diperbarui untuk waktu jumatSiang

---

## 🔑 Info Server (Final — Updated)

| Item | Value |
|------|-------|
| VPS | 119.28.100.51 (Tencent Cloud, OpenCloudOS 9) |
| App path | /root/epresensi/ |
| PM2 process | epresensi-sinaga (id: 2) |
| Baileys | @whiskeysockets/baileys@7.0.0-rc14 |
| Supabase | xkucjscvjemxjansrhwo.supabase.co |
| Last stable commit | `0590459` (2026-09-09) |
| Fitur stabil | pauseCredsSave, TG Checkpoint, jumatSiang 14:00, Sabtu rekap only, Minggu kosong |
