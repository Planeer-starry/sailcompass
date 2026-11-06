"""出海罗盘 · Agent 模块（3B：四个 Agent 全部实现）"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

import task_manager

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


def call_llm(system: str, user: str, temperature: float = 0.3) -> str:
    """两条消息的便捷封装（四段流水线用）"""
    return call_llm_messages(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature,
    )


def call_llm_messages(messages: list, temperature: float = 0.3) -> str:
    """底层：完整 messages 列表调用大模型；异常原样抛出，由路由层转为错误响应"""
    model = os.getenv("MODEL")
    if not model:
        raise RuntimeError("缺少 MODEL，请检查 .env 文件")
    resp = _get_client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
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


# ---------- Agent 1 · 市场洞察 ----------
def market_insight(info: dict) -> str:
    """输入产品信息，输出六小节洞察文本"""
    system = load_prompt("insight")
    user = build_info_text(info)
    return call_llm(system, user)


# ---------- Agent 2 · 多语种 Listing ----------
def localize_listing(info: dict, insight: str) -> str:
    """根据产品信息与市场洞察，为每种目标语言生成 Listing 文案"""
    system = load_prompt("listing")
    user = build_info_text(info) + "\n\n===== 市场洞察 =====\n" + insight
    return call_llm(system, user)


# ---------- Agent 3 · 合规体检 ----------
def compliance_check(info: dict, listing: str) -> tuple[list, str]:
    """对产品与 Listing 做合规体检，返回 (rows, raw)；JSON 解析失败不抛异常"""
    system = load_prompt("compliance")
    user = build_info_text(info) + "\n\n===== Listing 文案 =====\n" + listing
    raw = call_llm(system, user)
    rows = _parse_compliance_rows(raw)
    return rows, raw


def _strip_code_fence(text: str) -> str:
    """去掉 ``` 包裹（```json ... ``` 或 ``` ... ```）"""
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    if len(lines) >= 2 and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1])
    return "\n".join(lines[1:])


def _extract_brackets(text: str) -> str:
    """截取首个 [ 到最后一个 ] 之间的内容（应对模型输出前后带说明文字）"""
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return ""
    return text[start:end + 1]


def _fix_row(row: dict) -> dict:
    """逐条修补：risk_level 缺/非法→黄，need_verify 缺/非法→是，其余缺→空串；条目一律保留"""
    level = str(row.get("risk_level", "")).strip()
    if level not in ("红", "黄", "绿"):
        level = "黄"
    verify = str(row.get("need_verify", "")).strip()
    if verify not in ("是", "否"):
        verify = "是"
    return {
        "item": str(row.get("item", "")).strip(),
        "risk_level": level,
        "basis": str(row.get("basis", "")).strip(),
        "action": str(row.get("action", "")).strip(),
        "need_verify": verify,
    }


def _parse_compliance_rows(raw: str) -> list:
    """JSON 四级容错：直解析 → 去``` → 截取[] → 单对象包列表；全失败返回 []，不抛异常"""
    candidates = [raw.strip(), _strip_code_fence(raw), _extract_brackets(raw)]
    for text in candidates:
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(data, list):
            return [_fix_row(r) for r in data if isinstance(r, dict)]
        if isinstance(data, dict):
            return [_fix_row(data)]
    return []


# ---------- Agent 4 · 交叉质检 ----------
def quality_check(info: dict, insight: str, listing: str, rows: list) -> str:
    """独立交叉审核：核对前三份结果的一致性；temperature=0.2 求稳"""
    system = load_prompt("quality")
    user = (
        build_info_text(info)
        + "\n\n===== 市场洞察 =====\n" + insight
        + "\n\n===== Listing 文案 =====\n" + listing
        + "\n\n===== 合规体检（摘要）=====\n" + _format_rows_brief(rows)
    )
    return call_llm(system, user, temperature=0.2)


def _format_rows_brief(rows: list) -> str:
    """合规行摘要：只给 item + risk_level，末尾附红项 action 原文（质检要判断红项是否有可执行改法）"""
    if not rows:
        return "合规结果为空或解析失败，无法交叉校验风险项；请在结论中说明此项未能校验"
    lines = []
    for r in rows:
        lines.append("- " + str(r.get("item", "")) + "｜" + str(r.get("risk_level", "")))
    red_actions = [str(r.get("action", "")).strip() for r in rows
                   if r.get("risk_level") == "红" and str(r.get("action", "")).strip()]
    if red_actions:
        lines.append("")
        lines.append("红项整改建议原文：")
        for a in red_actions:
            lines.append("- " + a)
    return "\n".join(lines)

# ---------- 小海螺 · 追问助手 ----------
CHAT_SYSTEM_PROMPT = (
    "你是出海罗盘的助手小海螺，基于给定的报告内容回答用户追问，"
    "只依据报告内容回答，不知道就说不知道，不要编造。"
    "回答用简体中文，简洁直接，必要时引用报告原文。"
)


def answer_question(task_id: str, tab: str, context: str, question: str) -> str:
    """小海螺：基于当前页报告内容回答追问；多轮历史存内存，每个 task_id+tab 最多保留最近 10 轮"""
    system = CHAT_SYSTEM_PROMPT + "\n\n===== 当前页面报告内容 =====\n" + context
    messages = [{"role": "system", "content": system}]
    messages += task_manager.get_chat_history(task_id, tab)
    messages.append({"role": "user", "content": question})
    answer = call_llm_messages(messages, temperature=0.3)
    task_manager.append_chat(task_id, tab, question, answer)
    return answer