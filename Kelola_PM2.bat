@echo off
title Kelola PM2 - ePresensi Jateng
color 0B
cd /d "%~dp0"

:MENU
cls
echo ====================================================================
echo   KELOLA PM2 - ePresensi Jateng
echo ====================================================================
echo.
echo   Status aplikasi saat ini:
echo.
call pm2 list
echo.
echo ====================================================================
echo   Pilih aksi:
echo.
echo   [1] Lihat Log Realtime (jendela baru)
echo   [2] Lihat Log Error (jendela baru)
echo   [3] Restart Server
echo   [4] Stop Server
echo   [5] Start Server (jika sedang stop)
echo   [6] Buka Dashboard Browser
echo   [7] Hapus dari PM2 (unregister)
echo   [8] Daftarkan Ngrok ke PM2 (jika offline)
echo   [0] Keluar
echo.
echo ====================================================================
set /p PILIHAN=Masukkan pilihan [0-8]: 

if "%PILIHAN%"=="1" goto LOG
if "%PILIHAN%"=="2" goto LOG_ERROR
if "%PILIHAN%"=="3" goto RESTART
if "%PILIHAN%"=="4" goto STOP
if "%PILIHAN%"=="5" goto START
if "%PILIHAN%"=="6" goto BROWSER
if "%PILIHAN%"=="7" goto HAPUS
if "%PILIHAN%"=="8" goto DAFTAR_NGROK
if "%PILIHAN%"=="0" goto KELUAR
goto MENU

:LOG
cls
echo [INFO] Membuka log realtime di jendela baru...
start "PM2 Log - ePresensi" powershell -NoExit -Command "Get-Content '%USERPROFILE%\.pm2\logs\epresensi-sinaga-out-0.log' -Wait -Tail 80"
timeout /t 2 >nul
goto MENU

:LOG_ERROR
cls
echo [INFO] Membuka log error di jendela baru...
start "PM2 Error Log" powershell -NoExit -Command "Get-Content '%USERPROFILE%\.pm2\logs\epresensi-sinaga-error-0.log' -Wait -Tail 80"
timeout /t 2 >nul
goto MENU

:RESTART
cls
echo [INFO] Merestart semua service (ePresensi & Ngrok)...
call pm2 restart all
echo.
echo [OK] Server berhasil direstart!
timeout /t 2 >nul
goto MENU

:STOP
cls
echo [INFO] Menghentikan semua service (ePresensi & Ngrok)...
call pm2 stop all
echo.
echo [OK] Server dihentikan. Gunakan pilihan 5 untuk menjalankan kembali.
timeout /t 2 >nul
goto MENU

:START
cls
echo [INFO] Menjalankan semua service (ePresensi & Ngrok)...
call pm2 start all
echo.
echo [OK] Server berjalan kembali!
timeout /t 2 >nul
goto MENU

:BROWSER
start http://localhost:3000
start https://dashboard.uptimerobot.com
goto MENU

:HAPUS
cls
echo [WARNING] Ini akan menghapus epresensi dari PM2.
set /p KONFIRM=Yakin? (ketik YA untuk konfirmasi): 
if /i "%KONFIRM%"=="YA" (
    call pm2 delete epresensi
    call pm2 save
    echo [OK] Berhasil dihapus dari PM2.
) else (
    echo [INFO] Dibatalkan.
)
timeout /t 2 >nul
goto MENU

:DAFTAR_NGROK
cls
echo [INFO] Mendaftarkan dan menjalankan Ngrok tunnel ke PM2...
call pm2 start ngrok_start.js --name ngrok-tunnel
call pm2 save
echo.
echo [OK] Ngrok tunnel berhasil didaftarkan! URL publik akan aktif dalam ~5 detik.
timeout /t 3 >nul
goto MENU

:KELUAR
exit
