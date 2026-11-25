#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[错误] 未找到 python3，请先安装 Python 3.10 或以上版本。"
  echo "https://www.python.org/downloads/"
  exit 1
fi

if [ ! -d .venv ]; then
  echo "首次运行，正在创建运行环境..."
  python3 -m venv .venv
fi

. .venv/bin/activate
echo "正在检查依赖（首次会下载，请稍等）..."
if ! python -m pip install -q --disable-pip-version-check -r backend/requirements.txt; then
  echo "默认源安装失败，改用清华镜像重试..."
  python -m pip install -q --disable-pip-version-check -r backend/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
fi

APP_PORT="${PORT:-$(python pick_port.py)}"
echo "服务地址：http://127.0.0.1:${APP_PORT}"
exec python -m uvicorn backend.app.main:app --host 0.0.0.0 --port "$APP_PORT"