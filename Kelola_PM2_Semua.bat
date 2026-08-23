@echo off
:: ============================================
:: KELOLA PM2 - All Services (Run as Admin)
:: ePresensi Sinaga + Uptime Kuma + Ngrok
:: ============================================

:: Jaga window tetap terbuka apapun yang terjadi
if "%1"=="CHILD" goto :CHECK_ADMIN
cmd /k "%~f0" CHILD
exit

:CHECK_ADMIN
:: Cek apakah sudah run as Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    color 0C
    echo [ERROR] Script ini butuh hak Administrator!
    echo         Klik kanan file ini lalu pilih "Run as administrator"
    echo.
    pause > nul
    exit /b 1
)
color 0B
goto :MENU

:MENU
cls
echo ====================================================================
echo   KELOLA PM2 - All Services
echo   ePresensi (port 3000) + Uptime Kuma (port 3001) + Ngrok
echo ====================================================================
echo.
echo   Status aplikasi saat ini:
echo.
call pm2 list
echo.
echo ====================================================================
echo   Pilih aksi:
echo.
echo   [1] START SEMUA   - Jalankan semua service
echo   [2] STOP SEMUA    - Hentikan semua service
echo   [3] RESTART SEMUA - Restart semua service
echo   ---------------------------------------------------------------
echo   [4] Restart ePresensi saja
echo   [5] Restart Uptime Kuma saja
echo   [6] Restart Ngrok saja
echo   ---------------------------------------------------------------
echo   [7] Log ePresensi  (jendela baru)
echo   [8] Log Uptime Kuma (jendela baru)
echo   [9] Log Ngrok (jendela baru)
echo   ---------------------------------------------------------------
echo   [S] SETUP AWAL - Daftarkan semua ke PM2 (pertama kali)
echo   [B] Buka Dashboard Browser (semua)
echo   ---------------------------------------------------------------
echo   [0] Keluar
echo.
echo ====================================================================
set /p PILIHAN=Masukkan pilihan [0-9]: 

if "%PILIHAN%"=="1" goto START_ALL
if "%PILIHAN%"=="2" goto STOP_ALL
if "%PILIHAN%"=="3" goto RESTART_ALL
if "%PILIHAN%"=="4" goto RESTART_EPRESENSI
if "%PILIHAN%"=="5" goto RESTART_KUMA
if "%PILIHAN%"=="6" goto RESTART_NGROK
if "%PILIHAN%"=="7" goto LOG_EPRESENSI
if "%PILIHAN%"=="8" goto LOG_KUMA
if "%PILIHAN%"=="9" goto LOG_NGROK
if /i "%PILIHAN%"=="S" goto SETUP_AWAL
if /i "%PILIHAN%"=="B" goto BROWSER
if "%PILIHAN%"=="0" goto KELUAR
goto MENU

:: ==========================================
:START_ALL
cls
echo [INFO] Menjalankan semua service...
call pm2 start all
echo.
echo [OK] Semua service berjalan!
timeout /t 2 >nul
goto MENU

:: ==========================================
:STOP_ALL
cls
echo [INFO] Menghentikan semua service...
call pm2 stop all
echo.
echo [OK] Semua service dihentikan.
timeout /t 2 >nul
goto MENU

:: ==========================================
:RESTART_ALL
cls
echo [INFO] Merestart semua service...
call pm2 restart all
echo.
echo [OK] Semua service berhasil direstart!
timeout /t 2 >nul
goto MENU

:: ==========================================
:RESTART_EPRESENSI
cls
echo [INFO] Merestart ePresensi Sinaga...
call pm2 restart epresensi-sinaga
echo.
echo [OK] ePresensi berhasil direstart!
timeout /t 2 >nul
goto MENU

:: ==========================================
:RESTART_KUMA
cls
echo [INFO] Merestart Uptime Kuma...
call pm2 restart uptime-kuma
echo.
echo [OK] Uptime Kuma berhasil direstart!
timeout /t 2 >nul
goto MENU

:: ==========================================
:RESTART_NGROK
cls
echo [INFO] Merestart Ngrok Tunnel...
call pm2 restart ngrok-tunnel
echo.
echo [OK] Ngrok berhasil direstart!
timeout /t 2 >nul
goto MENU

:: ==========================================
:LOG_EPRESENSI
cls
echo [INFO] Membuka log ePresensi di jendela baru...
start "Log - ePresensi Sinaga" powershell -NoExit -Command "Get-Content '%USERPROFILE%\.pm2\logs\epresensi-sinaga-out-0.log' -Wait -Tail 80"
timeout /t 2 >nul
goto MENU

:: ==========================================
:LOG_KUMA
cls
echo [INFO] Membuka log Uptime Kuma di jendela baru...
start "Log - Uptime Kuma" powershell -NoExit -Command "Get-Content '%USERPROFILE%\.pm2\logs\uptime-kuma-out.log' -Wait -Tail 80"
timeout /t 2 >nul
goto MENU

:: ==========================================
:LOG_NGROK
cls
echo [INFO] Membuka log Ngrok di jendela baru...
start "Log - Ngrok Tunnel" powershell -NoExit -Command "Get-Content '%USERPROFILE%\.pm2\logs\ngrok-tunnel-out.log' -Wait -Tail 80"
timeout /t 2 >nul
goto MENU

:: ==========================================
:SETUP_AWAL
cls
echo ====================================================================
echo   SETUP AWAL - Daftarkan semua service ke PM2
echo ====================================================================
echo.
echo [1/5] Reset PM2 lama...
taskkill /F /IM "node.exe" >nul 2>&1
timeout /t 2 >nul
rmdir /s /q "%USERPROFILE%\.pm2" >nul 2>&1
timeout /t 1 >nul
call pm2 kill >nul 2>&1
timeout /t 2 >nul
echo [OK] Reset selesai
echo.

echo [2/5] Mendaftarkan ePresensi Sinaga (port 3000)...
cd /d "D:\Antigravity\EPRESENSI SKANIGA\EPRESENSI-SINAGA"
call pm2 start ecosystem.config.js
echo [OK] ePresensi terdaftar
echo.

echo [3/5] Mendaftarkan Ngrok Tunnel...
call pm2 start ngrok_start.js --name ngrok-tunnel
echo [OK] Ngrok terdaftar
echo.

echo [4/5] Mendaftarkan Uptime Kuma (port 3001)...
cd /d "D:\Antigravity\UPTIMER"
call pm2 start server/server.js --name uptime-kuma
echo [OK] Uptime Kuma terdaftar
echo.

echo [5/5] Menyimpan konfigurasi PM2...
call pm2 save
pm2-startup install >nul 2>&1
echo [OK] Tersimpan dan auto-start dikonfigurasi
echo.

echo ====================================================================
call pm2 list
echo.
echo   ePresensi   : http://localhost:3000
echo   Ngrok       : https://broker-morale-harmony.ngrok-free.dev
echo   Uptime Kuma : http://localhost:3001
echo ====================================================================
echo.
pause
goto MENU

:: ==========================================
:BROWSER
start http://localhost:3000
start http://localhost:3001
start https://broker-morale-harmony.ngrok-free.dev
goto MENU

:: ==========================================
:KELUAR
exit
