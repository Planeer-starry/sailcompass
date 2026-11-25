@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo    SailCompass - 局域网共享模式
echo ========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 没有找到 Python。
  echo 请先安装 Python 3.10 或以上版本：https://www.python.org/downloads/
  echo 安装时勾选 "Add Python to PATH"。
  pause
  exit /b 1
)

if not exist ".venv" (
  echo 第一次运行，正在创建运行环境...
  python -m venv .venv
)

echo 正在检查依赖（首次会下载，请稍等）...
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r backend\requirements.txt
if not errorlevel 1 goto deps_ok
echo 默认源安装失败，改用清华镜像重试...
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 goto pip_fail

:deps_ok
set "APP_PORT=8000"
for /f "delims=" %%p in ('".venv\Scripts\python.exe" pick_port.py') do set "APP_PORT=%%p"

echo.
echo 共享模式。同一 Wi-Fi 下的其他人可以通过下面的地址访问：
echo   http://你的内网IP:%APP_PORT%
echo.
echo 本机 IPv4 地址：
ipconfig | findstr /i "IPv4"
echo.
echo 如果 Windows 防火墙弹窗，请选择允许访问。
echo 关闭这个窗口就会停止服务。
echo.

start "" powershell -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://127.0.0.1:%APP_PORT%'"
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 0.0.0.0 --port %APP_PORT% --proxy-headers

pause
exit /b 0

:pip_fail
echo [错误] 依赖安装失败，请检查网络后重试。
pause
exit /b 1