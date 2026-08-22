@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 尚未安装依赖，请先双击“安装依赖.bat”。
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" . --simulate-live --offline-ai
endlocal
