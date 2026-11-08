"""出海罗盘 · 意图理解（一句话解析产品字段 + 生成/咨询分流）

配置优先级与全局一致：请求头 > .env > 演示模式；密钥不落盘、不写日志。
"""
import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import agents
import llm_config

BASE_DIR = Path(__file__).parent
DEMO_DATA_PATH = BASE_DIR / "prompts" / "demo_answers.json"

MAX_TEXT_LEN = 200

CATEGORIES = (
    "3C电子", "家具家居", "服装鞋帽", "皮具箱包", "户外用品", "美妆个护",
    "母婴玩具", "汽车配件", "五金工具", "食品饮料", "其他",
)
PLATFORMS = (
    "Amazon 美国站", "Amazon 欧洲站", "TikTok Shop", "Shopee 东南亚", "独立站",
)
LANGUAGES = ("English", "Español", "Deutsch", "Français")
INFERRED_FIELDS = ("category", "platform", "languages")
FAIL_NOTE = "解析失败，请手动填写"

router = APIRouter()
_demo_data = None


class ParseIntentRequest(BaseModel):
    """一句话需求描述"""
    text: str = ""


def _load_demo_data() -> dict:
    """读取演示数据（含 intent 预设），首次读取后缓存"""
    global _demo_data
    if _demo_data is None:
        _demo_data = json.loads(DEMO_DATA_PATH.read_text(encoding="utf-8"))
    return _demo_data


def _empty_result(note: str = "") -> dict:
    """全部字段为空；intent 固定 consult，避免前端误跳工作台"""
    return {
        "intent": "consult",
        "product": "",
        "category": "",
        "platform": "",
        "languages": [],
        "selling_points": "",
        "params": "",
        "note": note,
        "inferred": [],
    }


def _clean_str(value) -> str:
    """字符串字段去空白；非字符串一律视为空"""
    return value.strip() if isinstance(value, str) else ""


def _normalize(data: dict) -> dict:
    """字段规整：枚举精确匹配，匹配不上留空，绝不猜测"""
    intent = _clean_str(data.get("intent"))
    if intent not in ("generate", "consult"):
        intent = "consult"
    category = _clean_str(data.get("category"))
    if category not in CATEGORIES:
        category = ""
    platform = _clean_str(data.get("platform"))
    if platform not in PLATFORMS:
        platform = ""
    languages = []
    raw_languages = data.get("languages")
    if isinstance(raw_languages, list):
        for item in raw_languages:
            lang = _clean_str(item)
            if lang in LANGUAGES and lang not in languages:
                languages.append(lang)
    values = {"category": category, "platform": platform, "languages": languages}
    inferred = []
    raw_inferred = data.get("inferred")
    if isinstance(raw_inferred, list):
        for item in raw_inferred:
            field = _clean_str(item)
            # 只保留真正有值的可推断字段，避免「标了推断但字段为空」
            if field in INFERRED_FIELDS and field not in inferred and values.get(field):
                inferred.append(field)
    return {
        "intent": intent,
        "product": _clean_str(data.get("product")),
        "category": category,
        "platform": platform,
        "languages": languages,
        "selling_points": _clean_str(data.get("selling_points")),
        "params": _clean_str(data.get("params")),
        "note": _clean_str(data.get("note")),
        "inferred": inferred,
    }


def _strip_code_fence(text: str) -> str:
    """去掉 ``` 包裹（```json ... ``` 或 ``` ... ```）"""
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    if len(lines) >= 2 and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1])
    return "\n".join(lines[1:])


def _extract_braces(text: str) -> str:
    """截取首个 { 到最后一个 } 之间的内容（应对前后带说明文字）"""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return ""
    return text[start:end + 1]


def _parse_json_object(raw: str) -> dict | None:
    """JSON 四级容错：直解析 → 去 ``` → 截取 {}；全失败返回 None"""
    candidates = [raw.strip(), _strip_code_fence(raw), _extract_braces(raw)]
    for text in candidates:
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(data, dict):
            return data
    return None


def _demo_intent(text: str) -> dict:
    """演示模式最小分流：含生成词 + 产品词才返回预设，其余全空咨询"""
    demo = _load_demo_data()["intent"]
    has_generate = any(word in text for word in demo["generate_keywords"])
    has_product = any(word in text for word in demo["product_keywords"])
    if has_generate and has_product:
        return dict(demo["preset"])
    return _empty_result()


@router.post("/api/parse-intent")
def parse_intent(req: ParseIntentRequest, request: Request):
    """一句话解析：先判演示模式，正常模式调 intent prompt 并做 JSON 容错"""
    text = (req.text or "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "请先输入需求描述"})
    if len(text) > MAX_TEXT_LEN:
        return JSONResponse(status_code=400, content={"error": "描述太长了，请精简到 200 字以内"})

    forced = request.headers.get("X-Force-Mode", "").strip().lower() == "demo"
    cfg = llm_config.resolve_llm_config(request)
    if forced or not llm_config.text_ready(cfg):
        return {**_demo_intent(text), "demo": True}

    agent_cfg = cfg if cfg.get("from_header") else None
    try:
        raw = agents.call_llm(agents.load_prompt("intent"), text, temperature=0, cfg=agent_cfg)
    except Exception:
        # 模型调用失败不抛 500：返回空结果，前端可退回咨询路径
        return _empty_result(FAIL_NOTE)
    data = _parse_json_object(raw)
    if data is None:
        return _empty_result(FAIL_NOTE)
    return _normalize(data)