# 🚀 Panduan Deploy: GitHub → VPS (ePresensi Sinaga)

Panduan deploy/update **ePresensi Sinaga** dari PC ke VPS via GitHub.

---

## 📋 Info Server

| | Detail |
|---|---|
| **Repo** | `https://github.com/krido19/EPRESENSI-SINAGA.git` |
| **Folder VPS** | `/root/epresensi` |
| **PM2 App Name** | `epresensi-sinaga` |
| **Port** | `3000` |

---

## 🔁 Alur Kerja (Setiap Ada Perubahan)

```
Edit kode di PC (Windows) → Git Push → Git Pull di VPS → PM2 Restart
```

---

## 💻 LANGKAH 1: Push dari PC (Windows)

```powershell
cd "D:\Antigravity\EPRESENSI SKANIGA\EPRESENSI-SINAGA"

git add .
git commit -m "feat: deskripsi perubahan"
git push origin main
```

---

## 🌐 LANGKAH 2: Update di VPS

Masuk ke VPS (via OrcaTerm / SSH), lalu jalankan:

```bash
cd /root/epresensi && git pull origin main && pm2 restart epresensi-sinaga
```

> 🔐 Jika diminta **Username** dan **Password**:
> - Username: `krido19`
> - Password: **Personal Access Token (PAT)** (bukan password GitHub!)

---

## 🔄 Setup Awal VPS (Hanya Sekali)

Jika folder VPS belum dihubungkan ke repo ini:

```bash
# Masuk ke folder project
cd /root/epresensi

# Ganti remote ke repo ePresensi
git remote remove origin
git remote add origin https://github.com/krido19/EPRESENSI-SINAGA.git

# Simpan PAT agar tidak perlu login berulang
git config credential.helper store

# Download dan terapkan kode terbaru
git fetch origin
git checkout -B main
git reset --hard origin/main

# Restart aplikasi
pm2 restart epresensi-sinaga
```

---

## ⚡ Perintah Cepat (Update Rutin)

Cukup 1 baris setelah push dari PC:

```bash
cd /root/epresensi && git pull origin main && pm2 restart epresensi-sinaga
```

---

## ✅ Cek Hasil

Setelah restart, buka di browser:
```
http://119.28.100.51:3000
http://119.28.100.51:3000/health
```

Cek log PM2:
```bash
pm2 logs epresensi-sinaga --lines 30
```

---

## 🆘 Troubleshooting

| Error | Solusi |
|---|---|
| `fatal: couldn't find remote ref main` | Jalankan `git fetch origin` dulu |
| `EADDRINUSE: address already in use :::3000` | `pm2 restart epresensi-sinaga` atau `pm2 kill && pm2 start ecosystem.config.js` |
| Password diminta terus | Jalankan `git config credential.helper store` di dalam folder epresensi |
| `Cannot find module './src/...'` | Pastikan `git pull` sudah dapat folder `src/` terbaru |
| WA tidak connect | Cek `pm2 logs epresensi-sinaga` — scan ulang QR jika diperlukan |

---

## 📦 Struktur Modul (src/)

```
server.js          ← Entry point (170 baris)
src/
├── config.js      ← Config & template WA
├── supabase.js    ← Supabase client
├── logger.js      ← Log & notifikasi
├── auth.js        ← JWT & middleware auth
├── whatsapp.js    ← Baileys & kirim WA
├── epresensi.js   ← Login & scraping
├── scheduler.js   ← Semua jadwal otomatis
└── routes/
    ├── admin.js       ← /api/admin/*
    ├── auth.js        ← /api/auth/*, /api/wa/*, /api/config
    ├── api.js         ← /api/colleagues, /api/send-*, /api/recipients
    └── scheduler.js   ← /api/scheduler/run-now
```
