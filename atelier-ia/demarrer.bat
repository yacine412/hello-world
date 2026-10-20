@echo off
REM Lance Atelier IA (Windows) : double-cliquez sur ce fichier.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Telechargez la version LTS sur https://nodejs.org puis relancez ce fichier. & pause & exit /b 1)
if not exist node_modules call npm install --omit=dev
start "" http://localhost:3000
call npm start
pause
