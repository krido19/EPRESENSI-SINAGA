@echo off
title ePresensi Jateng - Dashboard dan WA Gateway
color 0B

cd /d "%~dp0"

echo ====================================================================
echo   ePresensi Jateng - Monitoring and WhatsApp Gateway Dashboard
echo ====================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js tidak ditemukan di komputer ini!
    echo Silakan install Node.js terlebih dahulu dari: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] Folder node_modules belum ditemukan.
    echo [INFO] Menginstal dependensi aplikasi via npm install...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo [ERROR] Gagal menginstal dependensi npm install.
        echo Periksa koneksi internet Anda lalu coba lagi.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependensi berhasil diinstal!
    echo.
)

echo [INFO] Membuka browser ke http://localhost:3000 ...
start http://localhost:3000

echo [INFO] Menjalankan server aplikasi...
echo [INFO] Tekan Ctrl + C di jendela ini untuk menghentikan aplikasi.
echo ====================================================================
echo.

node server.js

echo.
echo ====================================================================
echo [INFO] Server telah berhenti.
echo ====================================================================
pause
