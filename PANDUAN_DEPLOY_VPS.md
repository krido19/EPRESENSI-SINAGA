# 🚀 Panduan Deploy: GitHub → VPS

Panduan ini menjelaskan cara men-deploy/mengupdate **Uptime Nineteen** dari repository GitHub ke VPS.

---

## 📋 Prasyarat

| Kebutuhan | Detail |
|---|---|
| Komputer | Node.js v18+, Git, npm |
| VPS | `/root/uptime-kuma` sudah clone dari `krido19/Uptimer-Nineteen` |
| GitHub | Personal Access Token (PAT) dengan scope `repo` |

---

## 🔁 Alur Kerja (Setiap Kali Ada Perubahan)

```
Edit kode di PC → Build di PC → Git Push → Git Pull di VPS → Restart PM2
```

---

## 💻 LANGKAH 1: Edit & Build di PC (Windows)

### 1a. Buat perubahan di kode
Lakukan perubahan di folder `D:\Antigravity\UPTIMER` sesuai kebutuhan.

### 1b. Build frontend (kompilasi Vue → file statis)
```powershell
cd "D:\Antigravity\UPTIMER"
npm run build
```
> ⏳ Proses ini memakan waktu sekitar 1-3 menit. Tunggu sampai selesai dan muncul `✨ Done`.

### 1c. Commit dan push ke GitHub
```powershell
git add .
git commit -m "feat: deskripsi perubahan yang kamu buat"
git push
```

---

## 🌐 LANGKAH 2: Update di VPS

Masuk ke VPS kamu (via OrcaTerm atau SSH), lalu jalankan:

```bash
cd /root/uptime-kuma
git pull origin main
pm2 restart uptime-kuma
```

> 🔐 Jika diminta **Username** dan **Password**, masukkan:
> - Username: `krido19`
> - Password: **Personal Access Token (PAT)** kamu (bukan password GitHub!)

---

## 🔐 Cara Membuat Personal Access Token (PAT)

Jika PAT belum ada atau sudah expired, buat yang baru:

1. Buka: https://github.com/settings/tokens
2. Klik **"Generate new token (classic)"**
3. Isi **Note**: bebas (contoh: `VPS Deploy`)
4. **Expiration**: pilih sesuai kebutuhan
5. **Scope**: centang ✅ **`repo`** (akses penuh ke repo)
6. Scroll bawah → klik **"Generate token"**
7. **Copy token** yang muncul (hanya muncul sekali!)

> 💡 Agar VPS tidak terus-terusan minta token, jalankan sekali ini di VPS:
> ```bash
> cd /root/uptime-kuma
> git config credential.helper store
> ```
> Setelah itu, `git pull` di masa depan tidak akan minta password lagi.

---

## 🔄 Setup Awal VPS (Hanya Sekali)

Jika VPS belum pernah dihubungkan ke repo ini (fresh setup), jalankan urutan berikut:

```bash
# Ganti remote ke repo kamu
cd /root/uptime-kuma
git remote remove origin
git remote add origin https://github.com/krido19/Uptimer-Nineteen.git

# Simpan PAT agar tidak perlu login berulang
git config credential.helper store

# Download dan terapkan kode terbaru
git fetch origin
git checkout -B main
git reset --hard origin/main

# Restart aplikasi
pm2 restart uptime-kuma
```

---

## ⚡ Perintah Cepat (Setelah Setup Selesai)

Cukup 3 baris ini untuk update ke versi terbaru setelah kamu push dari PC:

```bash
cd /root/uptime-kuma && git pull origin main && pm2 restart uptime-kuma
```

---

## ✅ Cek Hasil

Setelah restart, buka di browser:
```
http://119.28.100.51:3001
```

---

## 🆘 Troubleshooting

| Error | Solusi |
|---|---|
| `fatal: couldn't find remote ref main` | Jalankan `git fetch origin` terlebih dahulu |
| `fatal: not in a git directory` | Pastikan kamu sudah `cd /root/uptime-kuma` |
| `Password` diminta terus | Jalankan `git config credential.helper store` di dalam folder uptime-kuma |
| Halaman web tidak berubah | Pastikan kamu sudah `npm run build` di PC sebelum push, lalu `pm2 restart uptime-kuma` di VPS |
