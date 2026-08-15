#!/usr/bin/env bash
# ==============================================================================
# Script Instalasi Otomatis ePresensi Jateng di Oracle Cloud VPS (Ubuntu / Debian)
# ==============================================================================

set -e

echo "🚀 [1/6] Memperbarui paket sistem..."
sudo apt update && sudo apt upgrade -y

echo "📦 [2/6] Menginstal Node.js 20 LTS, Git, dan build tools..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential ufw

echo "⚙️ [3/6] Menginstal PM2 Process Manager secara global..."
sudo npm install -g pm2

echo "📥 [4/6] Menginstal dependensi aplikasi..."
if [ ! -f "config.json" ]; then
  echo "📝 Membuat file config.json dari template..."
  cp config.example.json config.json
fi

npm install

echo "🛡️ [5/6] Mengatur firewall (Port 3000, 80, 22)..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 3000/tcp || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
sudo netfilter-persistent save || true

echo "🚀 [6/6] Menjalankan aplikasi dengan PM2 (Auto Start saat reboot)..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u $(whoami) --hp $HOME || true

echo ""
echo "=============================================================================="
echo "🎉 BERHASIL! Aplikasi ePresensi kini berjalan 24/7 di VPS Anda."
echo "🌐 Akses web: http://$(curl -s ifconfig.me):3000"
echo "=============================================================================="
echo "Tips Perintah PM2:"
echo "- Cek Status:  pm2 status"
echo "- Lihat Log:   pm2 logs epresensi-sinaga"
echo "- Restart:     pm2 restart epresensi-sinaga"
echo "=============================================================================="
