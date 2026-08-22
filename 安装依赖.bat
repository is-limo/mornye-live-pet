@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 (
  echo.
  echo 依赖安装失败，请保留本窗口中的错误信息。
  pause
  exit /b 1
)
echo.
echo 依赖安装完成，可以启动莫宁桌宠。
pause
endlocal
