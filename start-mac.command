#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "   出海罗盘 SailCompass"
echo "========================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "没有找到 python3。请先安装 Python 3.10 或以上版本："
  echo "https://www.python.org/downloads/"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "第一次运行，正在创建运行环境..."
  python3 -m venv .venv
fi

echo "正在检查依赖（首次会下载，请稍等）..."
if ! .venv/bin/python -m pip install -q --disable-pip-version-check -r backend/requirements.txt; then
  echo "默认源安装失败，改用清华镜像重试..."
  .venv/bin/python -m pip install -q --disable-pip-version-check -r backend/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
fi

APP_PORT=$(.venv/bin/python pick_port.py)
echo ""
echo "启动后浏览器会自动打开：http://127.0.0.1:${APP_PORT}"
echo "页面左上角应显示「出海罗盘 SailCompass」。"
echo "关闭这个终端窗口就会停止服务。"
echo ""

( sleep 3; open "http://127.0.0.1:${APP_PORT}" 2>/dev/null || xdg-open "http://127.0.0.1:${APP_PORT}" 2>/dev/null ) &
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port "$APP_PORT" --proxy-headers