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
echo   [1] Lihat Log (realtime)
echo   [2] Restart Server
echo   [3] Stop Server
echo   [4] Start Server (jika sedang stop)
echo   [5] Buka Dashboard Browser
echo   [6] Hapus dari PM2 (unregister)
echo   [0] Keluar
echo.
echo ====================================================================
set /p PILIHAN=Masukkan pilihan [0-6]: 

if "%PILIHAN%"=="1" goto LOG
if "%PILIHAN%"=="2" goto RESTART
if "%PILIHAN%"=="3" goto STOP
if "%PILIHAN%"=="4" goto START
if "%PILIHAN%"=="5" goto BROWSER
if "%PILIHAN%"=="6" goto HAPUS
if "%PILIHAN%"=="0" goto KELUAR
goto MENU

:LOG
cls
echo [INFO] Menampilkan log realtime... (Ctrl+C untuk kembali ke menu)
echo.
call pm2 logs epresensi
goto MENU

:RESTART
cls
echo [INFO] Merestart server...
call pm2 restart epresensi
echo.
echo [OK] Server berhasil direstart!
timeout /t 2 >nul
goto MENU

:STOP
cls
echo [INFO] Menghentikan server...
call pm2 stop epresensi
echo.
echo [OK] Server dihentikan. Gunakan pilihan 4 untuk menjalankan kembali.
timeout /t 2 >nul
goto MENU

:START
cls
echo [INFO] Menjalankan server...
call pm2 start epresensi
echo.
echo [OK] Server berjalan kembali!
timeout /t 2 >nul
goto MENU

:BROWSER
start http://localhost:3000
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

:KELUAR
exit
