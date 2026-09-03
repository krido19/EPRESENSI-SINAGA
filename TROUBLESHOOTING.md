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

