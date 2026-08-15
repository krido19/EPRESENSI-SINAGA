@echo off
title ePresensi Jateng - Tunnel Online Publik
color 0b

echo ======================================================================
echo    MEMBUAT LINK ONLINE PUBLIK (HTTPS) - 100%% GRATIS
echo ======================================================================
echo.
echo Sedang menghubungkan port 3000 ke Cloudflare / Localtunnel...
echo Link ini dapat dibuka dari HP, tablet, atau luar sekolah!
echo.
echo ======================================================================
echo.

npx -y untun@latest tunnel --port 3000

if %errorlevel% neq 0 (
    echo Mencoba jalur cadangan via localtunnel...
    npx -y localtunnel --port 3000
)

pause
