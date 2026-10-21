@echo off
REM Ouvre le tableau de bord d Atelier (Windows) : double-cliquez sur ce fichier.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Telechargez la version LTS sur https://nodejs.org puis relancez ce fichier. & pause & exit /b 1)
start "" http://localhost:3000
node server.js
pause
