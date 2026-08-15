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

Dikembangkan secara khusus dengan integrasi **WhatsApp Web Self-Hosted (100% Gratis Selamanya via Baileys Multi-Device)**, pemantauan presensi seluruh rekan guru unit kerja secara *real-time*, dual scheduler otomatis (07:30 & 18:00 WIB), tombol kirim WA instan 1-klik, batch send, serta desain antarmuka **Enterprise Dark Glassmorphism & Crisp Light Mode**.

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

### 🎨 6. Modern Sidebar, Auto-Hide & Theme Switcher
- **🍔 Hamburger & Auto-Hide Sidebar:** Mode ciut (*Icon-Only 78px*) di desktop dengan *auto-expand on hover*, dan *off-canvas drawer* di HP.
- **🌙 Dark Glassmorphism & ☀️ Clean Light Mode:** Tombol sakelar tema di pojok atas.
- **Sleek Custom Scrollbars:** Scrollbar tipis transparan modern.

### 🔒 7. Gatekeeper Security Access
- Proteksi akses dashboard dengan password keamanan dinamis (default: `SMK3magelang`).
- Fitur ganti password dan kunci aplikasi langsung dari menu pengaturan.

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Prasyarat
- [Node.js](https://nodejs.org/) versi 18.x atau yang lebih baru.
- Akun WhatsApp aktif di HP untuk di-scan ke aplikasi.

### 2. Instalasi Dependensi
```bash
git clone https://github.com/krido19/EPRESENSI-SINAGA.git
cd EPRESENSI-SINAGA
npm install
```

### 3. Menjalankan Aplikasi
```bash
node server.js
```
Buka browser dan akses alamat: **`http://localhost:3000`**

### 4. Menghubungkan WhatsApp
1. Buka dashboard di browser dan login dengan password awal: `SMK3magelang`.
2. Masuk ke menu **⚙️ Pengaturan & WhatsApp**.
3. Pada bagian **WhatsApp Gateway**, pilih opsi **WhatsApp Web (Scan QR - Gratis)**.
4. Buka WhatsApp di HP ➡️ **Perangkat Tertaut** ➡️ **Tautkan Perangkat** ➡️ Scan kode QR di layar dashboard.

---

## 📁 Struktur Direktori

```text
epresensi-jateng/
├── server.js               # Express backend, Baileys socket, scraper, scheduler & API endpoints
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
└── baileys_auth_info/      # Direktori sesi WhatsApp Web multi-device (diabaikan oleh .gitignore)
```

---

## 📚 Dokumentasi Terkait
- 📘 **[Panduan & Troubleshooting Baileys (BAILEYS_GUIDE.md)](BAILEYS_GUIDE.md):** Penjelasan mendalam mengenai siklus hidup koneksi WebSocket, penanganan reconnect/logout, pemformatan JID internasional, dan penghindaran konflik gateway.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, `@whiskeysockets/baileys` (Multi-Device WA), `node-cron`, `multer`, `xlsx`, `pino`, `qrcode`.
- **Frontend:** Vanilla HTML5, Modern CSS Variables (Design Tokens, Dark/Light Mode, Glassmorphism), Vanilla JavaScript (ES6+), `Plus Jakarta Sans`, `JetBrains Mono`.
- **Data Provider:** Portal Resmi ePresensi BKD Pemerintah Provinsi Jawa Tengah.

---


