@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 出海罗盘 诊断

echo ========================================
echo   出海罗盘 诊断
echo ========================================
echo   项目目录：%CD%
echo ========================================
echo.

echo [1] 页面标题（必须是 出海罗盘 SailCompass）
findstr /i title frontend\index.html
echo.

echo [2] Python
where python
python --version
echo.

echo [3] 依赖
if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" -c "import fastapi,uvicorn,openai,docx;print('deps ok')"
echo.

echo [4] 8000 端口占用
netstat -ano | findstr ":8000"
echo.

echo [5] 8000 当前返回的标题
curl -s http://127.0.0.1:8000/ | findstr /i title
echo.

echo ========================================
echo 请把整个窗口截图发给我。
echo ========================================
pause