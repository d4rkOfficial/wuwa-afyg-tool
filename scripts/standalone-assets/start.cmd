@echo off
rem Local preview only. See the readme file in this folder for details.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install it from https://nodejs.org/ and run this file again.
    echo Or serve this folder with any static web server.
    pause
    exit /b 1
)
start "" http://localhost:8080/
node serve.mjs 8080
pause
