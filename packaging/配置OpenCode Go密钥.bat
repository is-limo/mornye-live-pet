@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "MORNYE_PACKAGE_DIR=%~dp0"

echo.
echo ========================================
echo      配置 OpenCode Go API Key
echo ========================================
echo.
echo Key 只会写入本机同目录的 .env，不会显示在屏幕上。
echo 请使用你自己的 Key，不要填写别人分享的 Key。
echo.

powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $secure=Read-Host '请输入 OPENCODE_GO_API_KEY' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { $key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }; if ([string]::IsNullOrWhiteSpace($key) -or $key.Contains([char]10) -or $key.Contains([char]13)) { throw 'Key 不能为空' }; $target=Join-Path $env:MORNYE_PACKAGE_DIR '.env'; [IO.File]::WriteAllText($target, ('OPENCODE_GO_API_KEY=' + $key + [Environment]::NewLine), [Text.UTF8Encoding]::new($false)); Write-Host ''; Write-Host '配置完成。请勿上传或转发生成的 .env。' -ForegroundColor Green"

if errorlevel 1 (
  echo.
  echo 配置未完成，没有写入有效 Key。
  pause
  exit /b 1
)

echo.
pause
endlocal
