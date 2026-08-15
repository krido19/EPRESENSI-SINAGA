# 🏢 ePresensi Jateng — Monitoring & Notifikasi WhatsApp Otomatis

Aplikasi Dashboard Monitoring & Bot Notifikasi WhatsApp Otomatis untuk Presensi Pegawai / Guru Pemerintah Provinsi Jawa Tengah (Sinaga / ePresensi BKD Jateng).

Dikembangkan khusus dengan fitur real-time monitoring unit kerja, dual scheduler pengecekan otomatis, template Excel dinamis, dan sistem keamanan dashboard.

---

## ✨ Fitur Utama

- 👤 **Monitoring Presensi Pribadi & Rekan Unit:** Menampilkan status kehadiran, jam masuk, jam pulang, serta riwayat presensi 1 bulan penuh secara akurat.
- ⏰ **Dual Scheduler Otomatis (WIB):**
  - **🌅 Pagi (07:30 WIB):** Otomatis mendeteksi dan mengirim WA ke rekan yang belum absen masuk.
  - **🌆 Sore (18:00 WIB):** Otomatis mendeteksi dan mengirim WA ke rekan yang belum absen pulang.
- ⚡ **Dual-Layer Caching (Instant 0ms Render):** Menggunakan `LocalStorage` browser dan server memory cache 5 menit agar halaman dapat dibuka seketika tanpa jeda *scraping*.
- 📥 **Dynamic Excel Generator:** Unduh template Excel yang otomatis sudah terisi lengkap dengan seluruh daftar nama guru & NIP unit kerja (98 guru).
- ✏️ **Manajemen Kontak WhatsApp (CRUD):** Tambah manual, edit nama & nomor, import file Excel, serta switch aktif/nonaktif kontak.
- 🔒 **Sistem Keamanan Gatekeeper:** Proteksi dashboard menggunakan password akses dinamis yang dapat diubah langsung dari menu pengaturan.
- 📱 **Desain Glassmorphism Responsif & PWA Ready:** Tampilan UI modern berbasis *Plus Jakarta Sans*, *Dark Glassmorphism*, dan kompatibel penuh di desktop maupun smartphone.

---

## 🚀 Cara Menjalankan

### 1. Prasyarat
- Node.js versi 18.x atau lebih baru.
- Akun Fonnte (untuk token WhatsApp API di [fonnte.com](https://fonnte.com)).

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Menjalankan Server
```bash
node server.js
```
Buka browser di: **`http://localhost:3000`**

### 4. Akses Awal
- **Password Akses Default:** `SMK3magelang` (dapat diubah di menu Pengaturan Akun).

---

## 🛠️ Tech Stack
- **Backend:** Node.js, Express.js, `node-cron`, `multer`, `xlsx`
- **Frontend:** Vanilla HTML5, Modern CSS (Glassmorphism, CSS Variables, Responsive Grid), Vanilla JavaScript (ES6+)
- **API WhatsApp:** Fonnte WhatsApp Gateway API
- **Data Source:** Portal Resmi ePresensi BKD Provinsi Jawa Tengah
