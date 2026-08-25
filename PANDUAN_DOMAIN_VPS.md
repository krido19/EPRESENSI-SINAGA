# 🌐 Panduan Setting Domain ke VPS — ePresensi Sinaga

**Domain:** `absen-online.xyz` | **VPS IP:** `119.28.100.51` | **OS:** OpenCloudOS 9 | **Port App:** `3000`

---

## 📋 Ringkasan Arsitektur

```
Internet → absen-online.xyz (port 80/443)
         → Nginx (reverse proxy)
         → Node.js ePresensi (port 3000)
```

---

## TAHAP 1 — Setting DNS di Rumahweb

1. Login **Member Area Rumahweb** → https://member.rumahweb.com
2. **Domain** → pilih domain → **Manajemen DNS**
3. **Hapus** semua A Record lama (yang bukan `119.28.100.51`)
4. Tambahkan 2 A Record:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `@` | `119.28.100.51` | 14400 |
| A | `www` | `119.28.100.51` | 14400 |

Verifikasi dari VPS:
```bash
nslookup absen-online.xyz 8.8.8.8
# Harus tampil: Address: 119.28.100.51
```

Cek propagasi global: https://dnschecker.org/#A/absen-online.xyz

---

## TAHAP 2 — Install & Aktifkan Nginx

```bash
dnf install nginx -y

# ⚠️ Khusus Tencent Lighthouse VPS: matikan service bawaan yang pakai port 80
# Cek siapa yang pakai port 80:
# ss -tlnp | grep :80
# Cari service-nya:
# grep -r "lighthouse" /etc/systemd/system/
systemctl stop myapp && systemctl disable myapp

# Aktifkan Nginx
systemctl enable nginx
systemctl start nginx
systemctl status nginx
```

---

## TAHAP 3 — Konfigurasi Nginx (Reverse Proxy)

> ⚠️ `nano` tidak tersedia di OpenCloudOS — gunakan `cat` dengan heredoc

```bash
cat > /etc/nginx/conf.d/epresensi.conf << 'EOF'
server {
    listen 80;
    server_name absen-online.xyz www.absen-online.xyz;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

nginx -t && systemctl reload nginx
```

---

## TAHAP 4 — SSL HTTPS Gratis (Let's Encrypt)

> ⚠️ Pastikan DNS sudah propagasi ke `119.28.100.51` sebelum jalankan certbot!

```bash
dnf install certbot python3-certbot-nginx -y
certbot --nginx -d absen-online.xyz -d www.absen-online.xyz
```

Ikuti instruksi interaktif:
- Masukkan email (Gmail boleh)
- Ketik `Y` untuk Terms of Service
- Ketik `N` untuk share email EFF

```bash
# Verifikasi auto-renewal berjalan
systemctl status certbot.timer
```

---

## TAHAP 5 — Verifikasi

Buka di browser: `https://absen-online.xyz`

Harus muncul ikon gembok 🔒 dan aplikasi ePresensi Sinaga.

---

## 🔥 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `bind() to 0.0.0.0:80 failed (98)` | `systemctl stop myapp && systemctl disable myapp` |
| Certbot error `unauthorized` | DNS belum propagasi — cek `nslookup absen-online.xyz 8.8.8.8` |
| `nano: command not found` | Gunakan `cat > file << 'EOF'` (heredoc) |
| DNS masih IP lama | Hapus A record lama di Rumahweb, tunggu TTL expired |
| Port 80 dipakai proses lain | `ss -tlnp \| grep :80` untuk identifikasi proses |
| Node.js jalan di port 80 bukan 3000 | Cek `ecosystem.config.js` → pastikan `PORT: 3000` |

---

## 📌 Catatan Penting

- SSL berlaku **90 hari** dan **diperpanjang otomatis** oleh `certbot.timer`
- PM2 app berjalan di port **3000** via `ecosystem.config.js`
- Jika ada `.env` berisi `APP_URL`, ubah ke `https://absen-online.xyz`
