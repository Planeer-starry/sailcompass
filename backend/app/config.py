"""出海罗盘 · 路径与环境配置

统一项目路径，并在进程启动时加载项目根目录下的 .env。
环境变量优先级高于 .env（load_dotenv 默认不覆盖已有变量）。
"""
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"

load_dotenv(PROJECT_DIR / ".env")