---
title: ePresensi Sinaga
emoji: 🏫
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🏢 ePresensi Jateng — Monitoring & WhatsApp Gateway Dashboard

Aplikasi **Dashboard Monitoring Presensi & WhatsApp Multi-Device Gateway Otomatis** untuk Pegawai / Guru Pemerintah Provinsi Jawa Tengah (*Sinaga / ePresensi BKD Jateng*).

Dikembangkan secara khusus dengan integrasi **WhatsApp Web Self-Hosted (100% Gratis Selamanya via Baileys Multi-Device)**, pemantauan presensi seluruh rekan guru unit kerja secara *real-time*, dual scheduler otomatis (07:30 & 18:00 WIB), scraping DOM andal berbasis **Cheerio**, keamanan berlapis (**HMAC Token + Environment Secrets**), serta desain antarmuka **Enterprise Dark Glassmorphism & Crisp Light Mode**.

---

## ✨ Fitur Utama Aplikasi

### 📱 1. Dual WhatsApp Gateway (Self-Hosted Baileys & Fonnte)
- **100% Gratis Tanpa Pihak Ketiga:** Integrasi `@whiskeysockets/baileys` untuk menghubungkan nomor WhatsApp langsung dari dashboard via **Scan QR Code WhatsApp Web**.
- **Auto-Priority Dispatcher:** Otomatis memprioritaskan sesi WhatsApp Web yang aktif untuk pengiriman tanpa batasan kuota.
- **Opsi Fonnte API:** Tetap mendukung token Fonnte sebagai gateway cadangan.
- 📖 *Untuk arsitektur dan dokumentasi troubleshooting Baileys, lihat [BAILEYS_GUIDE.md](BAILEYS_GUIDE.md).*

### 👥 2. Monitoring Presensi Rekan Guru Real-Time
- **Daftar Lengkap Rekan Kerja (98 Guru):** Memantau status kehadiran (*Hadir, Belum Hadir, Libur, Sakit, Izin*), jam masuk, dan jam pulang rekan satu instansi (SMKN 3 Magelang).
- **Riwayat Presensi 1 Bulan Penuh:** Rekapan absensi lengkap dari tanggal 1 hingga akhir bulan untuk setiap guru.
- **Scraping Andal & Cepat:** Menggunakan parser DOM **Cheerio** yang tangguh terhadap perubahan markup ePresensi.
- **Dynamic Colorful Avatars:** Inisial nama dengan gradasi warna cerdas untuk tiap guru.
- **SVG Circular Donut Chart:** Metrik persentase kehadiran visual dengan indikator warna dinamis.

### ⚡ 3. Pengiriman WhatsApp Cepat & Batch Multi-Select
- **1-Click Direct WA Send:** Tombol **`💬 Kirim WA`** di samping setiap guru untuk notifikasi instan.
- **Multi-Select Checkboxes:** Memilih beberapa guru tertentu untuk mengirim pesan massal sekaligus via *Floating Action Bar*.
- **Quick Send Unabsent:** Tombol cepat untuk mengirim pengingat ke seluruh rekan yang belum absen hari ini.

### ⏰ 4. Dual Scheduler Engine Otomatis (WIB)
- **🌅 Pagi (07:30 WIB):** Bot otomatis memeriksa presensi dan mengirim pengingat masuk ke rekan yang belum absen.
- **🌆 Pulang (18:00 WIB):** Bot otomatis memeriksa presensi dan mengirim pengingat pulang ke rekan yang belum absen.
- **Live Countdown Timer:** Penghitung mundur waktu riil menuju jadwal eksekusi bot berikutnya.

### 📊 5. Dynamic Excel Importer & Template Generator
- **Unduh Template Otomatis:** Menyiapkan file Excel yang terisi seluruh **98 Nama Guru & NIP** SMKN 3 Magelang.
- **Smart Column Detection & Phone Normalization:** Deteksi kolom pintar dan konversi format nomor telepon otomatis (`858...` ➡️ `0858...`).

### 🔒 6. Keamanan & Stabilitas Tingkat Enterprise
- **Environment Configuration (`.env`):** Pemisahan kredensial sensitif dari kode sumber via `dotenv`.
- **HMAC Token + Timing-Safe Verification:** Mencegah serangan *timing attack* pada autentikasi sesi.
- **Auto-Backup & Atomic Storage:** Mem-backup `config.json` secara otomatis dan melakukan *auto-restore* jika file korup. Mencegah kerusakan file saat *power loss*.
- **Anti-Crash Guard & Process Manager:** Global error listener (`uncaughtException`), serta dilengkapi script **PM2** (`Setup_PM2.bat` / `Kelola_PM2.bat`) untuk *auto-restart* di background.

### 📈 7. Monitoring & Reliabilitas Pengiriman (Baru!)
- **Health Check Endpoint (`/health`):** Endpoint khusus untuk memonitor status server, koneksi WhatsApp, dan scheduler. Siap diintegrasikan dengan *UptimeRobot* (24/7).
- **Persistent Logs via Supabase:** Riwayat pengiriman WhatsApp dicatat permanen ke database Supabase (`notification_logs`), sehingga data tidak hilang saat restart.
- **Smart Retry Mechanism:** Jika pengiriman WhatsApp gagal (timeout sesaat), sistem otomatis mengulang 3x dengan *exponential backoff* (2s ➡️ 4s ➡️ 8s).
- **WhatsApp Disconnect Alert:** Sistem otomatis mengirimkan pesan peringatan ke nomor Admin jika koneksi WhatsApp terputus lebih dari 5 menit.
- **Smart Cache Invalidation:** Memastikan bot mengambil data presensi paling aktual (force refresh) saat eksekusi otomatis tanpa terjebak *cache* lama.

### 🎨 8. Modern Sidebar, Auto-Hide & Theme Switcher
- **🍔 Hamburger & Auto-Hide Sidebar:** Mode ciut (*Icon-Only 78px*) di desktop dengan *auto-expand on hover*, dan *off-canvas drawer* di HP.
- **🌙 Dark Glassmorphism & ☀️ Clean Light Mode:** Tombol sakelar tema di pojok atas.
- **Sleek Custom Scrollbars:** Scrollbar tipis transparan modern.

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Prasyarat
- [Node.js](https://nodejs.org/) versi 18.x atau yang lebih baru (Rekomendasi Node.js 20+).
- Akun WhatsApp aktif di HP untuk di-scan ke aplikasi.

### 2. Instalasi Dependensi
```bash
git clone https://github.com/krido19/EPRESENSI-SINAGA.git
cd EPRESENSI-SINAGA
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` menjadi `.env`:
```bash
# Di Windows PowerShell:
Copy-Item .env.example .env

# Di Linux / macOS:
cp .env.example .env
```
Sesuaikan variabel di dalam `.env` jika diperlukan (port, password akses aplikasi, secret key, akun ePresensi).

### 4. Menjalankan Aplikasi

**Rekomendasi (Menggunakan PM2 - Background Process):**
Karena aplikasi ini harus berjalan 24 jam untuk pengiriman pesan jadwal (*scheduler*), kami sangat menyarankan menggunakan **PM2**.
1. Klik kanan pada **`Setup_PM2.bat`** lalu pilih **Run as Administrator** (hanya perlu dilakukan sekali).
2. Untuk memantau server, melihat log, atau menyalakan/mematikan aplikasi, gunakan **`Kelola_PM2.bat`** sebagai *remote control* Anda.

**Alternatif (Menjalankan Manual di CMD):**
Jika hanya untuk *testing* / pengembangan:
```bash
npm start
```
Buka browser dan akses alamat: **`http://localhost:3000`**

### 5. Menghubungkan WhatsApp
1. Buka dashboard di browser dan login dengan password awal: `SMK3magelang` (atau sesuai `APP_PASSWORD` di `.env`).
2. Masuk ke menu **⚙️ Pengaturan & WhatsApp**.
3. Pada bagian **WhatsApp Gateway**, pilih opsi **WhatsApp Web (Scan QR - Gratis)**.
4. Buka WhatsApp di HP ➡️ **Perangkat Tertaut** ➡️ **Tautkan Perangkat** ➡️ Scan kode QR di layar dashboard.

---

## 📁 Struktur Direktori

```text
epresensi-jateng/
├── server.js               # Express backend, Baileys socket, Cheerio scraper, scheduler & API endpoints
├── .env.example            # Template variabel lingkungan untuk konfigurasi rahasia
├── .env                    # File konfigurasi lokal (diabaikan oleh git)
├── config.json             # File konfigurasi cookie, credentials & gateway state
├── recipients.json         # Database lokal nomor kontak guru/penerima WhatsApp
├── logs.json               # Catatan log aktivitas bot dan pengiriman pesan
├── package.json            # Daftar dependensi & metadata proyek
├── README.md               # Dokumentasi umum & panduan penggunaan aplikasi
├── BAILEYS_GUIDE.md        # Dokumentasi teknis, arsitektur & troubleshooting Baileys
├── public/
│   ├── index.html          # Layout antarmuka dashboard, sidebar, modal, dan gatekeeper
│   ├── style.css           # Desain Glassmorphism, Theme Tokens (Dark & Light), dan Scrollbar CSS
│   └── app.js              # Logika frontend, event handler, avatar generator, dan polling WA
├── graphify-out/           # Knowledge graph & visualisasi arsitektur kode
└── baileys_auth_info/      # Direktori sesi WhatsApp Web multi-device (diabaikan oleh .gitignore)
```

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, `@whiskeysockets/baileys` (Multi-Device WA), `cheerio` (DOM Scraper), `node-cron`, `dotenv`, `multer`, `xlsx`, `pino`, `qrcode`.
- **Frontend:** Vanilla HTML5, Modern CSS Variables (Design Tokens, Dark/Light Mode, Glassmorphism), Vanilla JavaScript (ES6+), `Plus Jakarta Sans`, `JetBrains Mono`.
- **Data Provider:** Portal Resmi ePresensi BKD Pemerintah Provinsi Jawa Tengah.

---

## 📚 Dokumentasi Terkait
- 📘 **[Panduan & Troubleshooting Baileys (BAILEYS_GUIDE.md)](BAILEYS_GUIDE.md):** Penjelasan mendalam mengenai siklus hidup koneksi WebSocket, penanganan reconnect/logout, pemformatan JID internasional, dan penghindaran konflik gateway.
