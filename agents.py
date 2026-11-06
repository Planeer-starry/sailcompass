"""出海罗盘 · Agent 模块（阶段 1：仅实现市场洞察，其余三个占位）"""
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# 启动时加载 .env（变量名：API_BASE_URL / API_KEY / MODEL，与旧版保持一致）
load_dotenv()

# 提示词目录：项目根目录下的 prompts/
PROMPT_DIR = Path(__file__).parent / "prompts"

# OpenAI 客户端惰性单例：首次调用时才创建，保证 /api/health 不依赖 .env 也能用
_client = None


def _get_client() -> OpenAI:
    """获取 OpenAI 客户端；配置缺失时抛出带中文提示的异常，不静默"""
    global _client
    if _client is None:
        base_url = os.getenv("API_BASE_URL")
        api_key = os.getenv("API_KEY")
        if not base_url or not api_key:
            raise RuntimeError("缺少 API_BASE_URL 或 API_KEY，请检查 .env 文件")
        # 超时与重试按已定决策：180 秒、重试 1 次
        _client = OpenAI(base_url=base_url, api_key=api_key, timeout=180, max_retries=1)
    return _client


def call_llm(system: str, user: str) -> str:
    """调用大模型：system 为角色与规则，user 为具体内容；异常原样抛出，由路由层转为错误响应"""
    model = os.getenv("MODEL")
    if not model:
        raise RuntimeError("缺少 MODEL，请检查 .env 文件")
    resp = _get_client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.3,
    )
    text = resp.choices[0].message.content
    if not text or not text.strip():
        raise RuntimeError("模型返回了空内容，请重试")
    return text.strip()


def load_prompt(name: str) -> str:
    """读取 prompts/ 目录下的提示词文件（如 insight.md）"""
    path = PROMPT_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"提示词文件不存在：{path}")
    return path.read_text(encoding="utf-8")


def build_info_text(info: dict) -> str:
    """把六字段产品信息拼成给模型的文本；空字段标注'未提供'，不猜测"""
    languages = info.get("languages") or []
    if isinstance(languages, list):
        languages_text = "、".join(languages)
    else:
        languages_text = str(languages)
    fields = [
        ("产品名称", info.get("product", "")),
        ("核心卖点", info.get("selling_points", "")),
        ("产品参数", info.get("params", "")),
        ("产品类目", info.get("category", "")),
        ("目标平台", info.get("platform", "")),
        ("目标语言", languages_text),
    ]
    lines = []
    for label, value in fields:
        value = (value or "").strip() if isinstance(value, str) else str(value)
        lines.append(f"{label}：{value if value else '未提供'}")
    return "\n".join(lines)


def market_insight(info: dict) -> str:
    """Agent 1 · 市场洞察：输入产品信息，输出六小节洞察文本"""
    system = load_prompt("insight")
    user = build_info_text(info)
    return call_llm(system, user)


def localize_listing(info: dict, insight: str) -> str:
    """Agent 2 · 多语种 Listing：阶段 2 实现"""
    raise NotImplementedError("localize_listing 将在阶段 2 实现")


def compliance_check(info: dict, listing: str) -> tuple[list, str]:
    """Agent 3 · 合规体检：阶段 2 实现，返回 (rows, raw)"""
    raise NotImplementedError("compliance_check 将在阶段 2 实现")


def quality_check(info: dict, insight: str, listing: str, rows: list) -> str:
    """Agent 4 · 交叉质检：阶段 2 实现"""
    raise NotImplementedError("quality_check 将在阶段 2 实现")