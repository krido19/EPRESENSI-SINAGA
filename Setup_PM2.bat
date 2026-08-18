@echo off
title Setup PM2 - ePresensi Jateng
color 0B
cd /d "%~dp0"

echo ====================================================================
echo   SETUP PM2 - ePresensi Jateng
echo   Process Manager agar aplikasi jalan otomatis dan tidak crash
echo ====================================================================
echo.

:: Cek Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js tidak ditemukan!
    echo Silakan install dari: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Cek npm dependencies
if not exist "node_modules\" (
    echo [INFO] Menginstal dependensi aplikasi...
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Gagal npm install. Periksa koneksi internet.
        pause
        exit /b 1
    )
    echo [OK] Dependensi berhasil diinstal!
    echo.
)

:: Install PM2 secara global
echo [INFO] Menginstal PM2 (process manager)...
call npm install -g pm2
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Gagal install PM2. Periksa koneksi internet.
    pause
    exit /b 1
)
echo [OK] PM2 berhasil diinstal!
echo.

:: Hentikan instance lama jika ada
echo [INFO] Menghentikan instance lama (jika ada)...
call pm2 delete epresensi >nul 2>nul

:: Jalankan dengan PM2
echo [INFO] Menjalankan server dengan PM2...
call pm2 start server.js --name epresensi --time
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Gagal menjalankan server via PM2.
    pause
    exit /b 1
)

:: Simpan konfigurasi PM2 agar auto-start jika Windows restart
echo [INFO] Menyimpan konfigurasi PM2...
call pm2 save

echo.
echo ====================================================================
echo   [OK] Server berhasil dijalankan dengan PM2!
echo.
echo   Gunakan Kelola_PM2.bat untuk monitor, restart, atau stop.
echo ====================================================================
echo.

:: Buka browser
start http://localhost:3000

:: Buka log secara langsung
echo [INFO] Membuka log... (tekan Ctrl+C untuk keluar dari log, server tetap jalan)
echo.
call pm2 logs epresensi

pause
