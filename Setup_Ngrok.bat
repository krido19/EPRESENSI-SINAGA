@echo off
title Setup Ngrok Tunnel - ePresensi Jateng
color 0B
cd /d "%~dp0"

echo ====================================================================
echo   Menambahkan Ngrok Tunnel ke PM2...
echo ====================================================================
echo.

call pm2 start ngrok_start.js --name ngrok_tunnel
call pm2 save

echo.
echo ====================================================================
echo   [OK] Ngrok berhasil dijalankan di background!
echo   Sekarang Anda bisa memasukkan URL berikut ke UptimeRobot:
echo   https://broker-morale-harmony.ngrok-free.dev/health
echo ====================================================================
echo.
pause
