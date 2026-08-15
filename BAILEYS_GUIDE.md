# 🛠️ Panduan Teknis & Troubleshooting: @whiskeysockets/baileys

Dokumen ini berisi dokumentasi mendalam mengenai integrasi **WhatsApp Web Multi-Device Gateway Self-Hosted** menggunakan library `@whiskeysockets/baileys` pada aplikasi **ePresensi Jateng**, arsitektur socket, serta tantangan teknis yang dihadapi dan solusinya.

---

## 🎯 Tujuan Integrasi
Pada versi awal, pengiriman notifikasi WhatsApp mengandalkan gateway pihak ketiga (Fonnte API) yang memiliki batasan kuota. Dengan mengintegrasikan `@whiskeysockets/baileys`, sistem kini dapat:
1. Menghubungkan nomor WhatsApp instansi/pribadi secara langsung melalui **Scan QR Code Multi-Device**.
2. **100% Gratis Selamanya** tanpa ketergantungan pada pihak ketiga.
3. Mendukung pengiriman pesan instan 1-klik, pengiriman massal (*batch send*), dan dual scheduler otomatis (07:30 & 18:00 WIB).

---

## 🏗️ Arsitektur Integrasi Baileys

```text
┌─────────────────────────┐          ┌───────────────────────────┐
│   Dashboard Frontend    │ ───HTTP──▶   Express Server (API)    │
│  (Scan QR & Send WA)    │          │  (/api/wa/*, /api/send-*) │
└─────────────────────────┘          └─────────────┬─────────────┘
                                                   │
                                     makeWASocket()│ (WebSocket)
                                                   ▼
┌─────────────────────────┐          ┌───────────────────────────┐
│  baileys_auth_info/     │ ◀─────── │  @whiskeysockets/baileys  │
│  (Session Keys/Creds)   │          │  WhatsApp Multi-Device    │
└─────────────────────────┘          └─────────────┬─────────────┘
                                                   │
                                                   ▼ (TLS Encrypted)
                                     ┌───────────────────────────┐
                                     │   WhatsApp Web Servers    │
                                     └───────────────────────────┘
```

---

## ⚠️ Masalah yang Dihadapi & Solusinya

Berikut adalah catatan *troubleshooting* lengkap dari kendala teknis yang diselesaikan selama proses implementasi:

### 1. Unhandled Disconnect & Reconnect Lifecycle Crash
* **Gejala Masalah:**  
  Ketika koneksi internet terputus sesaat atau sesi WhatsApp di-logout dari smartphone, server mengalami *crash* (`Unhandled Promise Rejection`) atau berhenti membangkitkan QR Code baru.
* **Akar Masalah:**  
  Event `connection.update` pada Baileys mengembalikan kode status diskoneksi (*Boom HTTP status*) yang jika tidak ditangani secara spesifik akan memutus event loop Node.js.
* **💡 Solusi:**  
  - Menggunakan `useMultiFileAuthState('baileys_auth_info')` untuk persistensi multi-device.
  - Menangkap `lastDisconnect?.error?.output?.statusCode` dan membedakan antara diskoneksi sementara (*network drop*) dengan *logout* permanen.
  - Jika diskoneksi sementara: Server otomatis memanggil `initBaileysSocket()` ulang setelah 3 detik.
  - Jika logout resmi (`DisconnectReason.loggedOut`): Server menghapus folder sesi `baileys_auth_info/` dan mereset status menjadi `qr_ready` agar QR baru muncul.

```javascript
waSock.ev.on('connection.update', async (update) => {
  const { connection, lastDisconnect, qr } = update;
  if (qr) {
    waQrCode = await qrcode.toDataURL(qr);
    waConnectionStatus = 'qr_ready';
  }
  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) {
      setTimeout(initBaileysSocket, 3000);
    } else {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      initBaileysSocket();
    }
  }
});
```

---

### 2. Gateway Dispatcher Conflict ("Gagal kirim: Terjadi kesalahan")
* **Gejala Masalah:**  
  Setelah perangkat WhatsApp berhasil ditautkan via QR Code, saat user menekan tombol kirim pesan muncul notifikasi *"Gagal kirim: Terjadi kesalahan"*.
* **Akar Masalah:**  
  Fungsi pengiriman pesan (`sendWhatsApp`) masih mengutamakan API Fonnte yang token-nya belum diisi atau tidak aktif, dan belum mendeteksi status sesi Baileys yang telah aktif (`connected`).
* **💡 Solusi:**  
  Membangun **Smart Auto-Priority Dispatcher** di `server.js`:
  1. Mengecek status sesi Baileys (`waSock && waConnectionStatus === 'connected'`).
  2. Jika Baileys terhubung, pesan **langsung dikirim melalui WhatsApp Web socket**.
  3. Jika Baileys tidak aktif, sistem baru melakukan *fallback* ke token Fonnte.

```javascript
async function sendWhatsApp(target, message) {
  // Prioritas 1: WhatsApp Web Baileys (Self-hosted & Gratis)
  if (waSock && waConnectionStatus === 'connected') {
    let cleanNumber = target.replace(/[^0-9]/g, '');
    if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.substring(1);
    else if (cleanNumber.startsWith('8')) cleanNumber = '62' + cleanNumber;
    const jid = `${cleanNumber}@s.whatsapp.net`;
    await waSock.sendMessage(jid, { text: message });
    return { success: true, gateway: 'baileys' };
  }

  // Prioritas 2: Fallback ke Fonnte API
  if (config.fonnteToken) {
    // Dispatch via Fonnte HTTP POST
  }

  return { success: false, error: 'Tidak ada WhatsApp gateway yang aktif.' };
}
```

---

### 3. Normalisasi Format Nomor Telepon & JID WhatsApp
* **Gejala Masalah:**  
  Pesan gagal terkirim jika nomor guru yang di-import dari Excel berformat lokal (`0858...`), diawali angka `8` (`858...`), atau memiliki spasi dan tanda hubung (`0858-6873-3378`).
* **Akar Masalah:**  
  Baileys mewajibkan target pengiriman berformat **JID Internasional murni** (`628xxx@s.whatsapp.net`).
* **💡 Solusi:**  
  Menambahkan pembersih nomor otomatis dengan regex yang menghapus semua karakter non-angka dan menyematkan kode negara `62`:
  - `085868733378` ➡️ `6285868733378@s.whatsapp.net`
  - `85868733378`  ➡️ `6285868733378@s.whatsapp.net`
  - `+62 858-6873-3378` ➡️ `6285868733378@s.whatsapp.net`

---

### 4. Isolasi Kunci Sesi Kriptografi (.gitignore)
* **Gejala Masalah:**  
  Folder `baileys_auth_info/` berisi private keys, pre-keys, dan app state sync. Jika ter-commit ke GitHub, akun WhatsApp dapat dibajak oleh pihak luar.
* **💡 Solusi:**  
  - Mendaftarkan `baileys_auth_info/` ke `.gitignore`.
  - Menyediakan endpoint `/api/wa/logout` untuk menghapus token sesi secara aman langsung dari UI.

---

### 5. Pengendalian Noise Log (Pino Silent Logger)
* **Gejala Masalah:**  
  Baileys secara *default* mencetak log frame WebSocket dan binary protocol yang sangat masif di terminal console, mengaburkan log aktivitas presensi dan bot.
* **💡 Solusi:**  
  Mengonfigurasi logger Baileys dengan level `silent` via library `pino`:
  ```javascript
  const pino = require('pino');
  const waSock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['ePresensi Jateng', 'Chrome', '1.0.0']
  });
  ```
