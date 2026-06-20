@echo off
chcp 65001 >nul
rem Chinese News Text Classification System - double-click launcher (calls start.ps1)
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
