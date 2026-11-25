@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 出海罗盘 SailCompass

echo ========================================
echo   出海罗盘 SailCompass
echo   项目目录：%CD%
echo ========================================
echo.

if not exist "frontend\index.html" goto no_project
if not exist ".venv\Scripts\python.exe" goto make_venv
goto install

:no_project
echo [错误] 当前文件夹里找不到 frontend\index.html
echo 请确认你解压后进入的是 sailcompass-web 文件夹。
echo.
pause
exit /b 1

:make_venv
echo [1/3] 第一次运行，创建运行环境...
python -m venv .venv
if errorlevel 1 goto venv_fail
goto install

:install
echo [2/3] 检查依赖（第一次会下载，请稍等）...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r backend\requirements.txt
if not errorlevel 1 goto ready
echo.
echo [提示] 默认源安装失败，改用清华镜像重试...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 goto pip_fail

:ready
echo [3/3] 选择可用端口并启动服务...
set "APP_PORT=8000"
for /f "delims=" %%p in ('".venv\Scripts\python.exe" pick_port.py') do set "APP_PORT=%%p"
echo.
echo 浏览器地址：http://127.0.0.1:%APP_PORT%
echo 标签页标题必须是：出海罗盘 SailCompass · v4.9
echo 如果页面不是 v4.9 新界面，说明打开的是旧版服务。
echo.
start "" http://127.0.0.1:%APP_PORT%
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 127.0.0.1 --port %APP_PORT% --proxy-headers
echo.
echo 服务已停止。
pause
exit /b 0

:venv_fail
echo [错误] 创建虚拟环境失败。
echo 请重装 Python 3.10 以上版本，并勾选 Add Python to PATH。
echo.
pause
exit /b 1

:pip_fail
echo [错误] 依赖安装失败，通常是网络问题。
echo 请复制下面这行到命令窗口重试：
echo .venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
echo.
pause
exit /b 1