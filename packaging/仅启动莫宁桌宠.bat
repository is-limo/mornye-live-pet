@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0莫宁桌宠.exe" (
  echo 缺少“莫宁桌宠.exe”，请保留完整文件夹。
  pause
  exit /b 1
)

start "" "%~dp0莫宁桌宠.exe"
exit /b 0
