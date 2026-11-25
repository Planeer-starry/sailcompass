"""出海罗盘 · 请求级模型配置（header > .env > 演示模式）与连通测试

配置只来自请求头或 .env，不落盘、不写日志、不进入全局变量。
"""
import os
import time

from openai import OpenAI


def _header(request, name: str) -> str:
    """读取请求头并去空白；缺失返回空串"""
    return (request.headers.get(name, "") or "").strip()


def resolve_llm_config(request) -> dict:
    """解析请求级配置：header 有值优先，缺失字段逐项回落 .env

    vision/image 额外保留 .env 专用地址与密钥，避免破坏现有独立识图/生图配置。
    from_header 标记本轮是否由请求头触发，供端点决定是否把 cfg 透传给 Agent。
    """
    base_url = _header(request, "X-LLM-Base-Url")
    api_key = _header(request, "X-LLM-Key")
    text_model = _header(request, "X-LLM-Model")
    vision_model = _header(request, "X-Vision-Model")
    image_model = _header(request, "X-Image-Model")

    text_base = base_url or os.getenv("API_BASE_URL", "")
    text_key = api_key or os.getenv("API_KEY", "")
    from_header = any((base_url, api_key, text_model, vision_model, image_model))

    # 内部回退：header > .env 专用；仅当请求带 header 时才继续回落文本，
    # 保证不带 header 时 vision/image 判定与 .env 原行为完全一致
    vision_base = base_url or os.getenv("VISION_BASE_URL", "")
    vision_key = api_key or os.getenv("VISION_API_KEY", "")
    image_base = base_url or os.getenv("IMAGE_BASE_URL", "")
    image_key = api_key or os.getenv("IMAGE_API_KEY", "")
    if from_header:
        vision_base = vision_base or text_base
        vision_key = vision_key or text_key
        image_base = image_base or text_base
        image_key = image_key or text_key

    return {
        "base_url": text_base,
        "api_key": text_key,
        "text_model": text_model or os.getenv("MODEL", ""),
        "vision_model": vision_model or os.getenv("VISION_MODEL", ""),
        "image_model": image_model or os.getenv("IMAGE_MODEL", ""),
        "vision_base_url": vision_base,
        "vision_api_key": vision_key,
        "image_base_url": image_base,
        "image_api_key": image_key,
        "from_header": from_header,
    }


def text_ready(cfg: dict) -> bool:
    """文本三件套是否齐全（header 或 .env 任一路径）"""
    return bool(cfg.get("base_url") and cfg.get("api_key") and cfg.get("text_model"))


def vision_ready(cfg: dict) -> bool:
    """识图三件套是否齐全（优先专用 vision 地址/密钥）"""
    return bool(cfg.get("vision_base_url") and cfg.get("vision_api_key") and cfg.get("vision_model"))


def image_ready(cfg: dict) -> bool:
    """生图三件套是否齐全（优先专用 image 地址/密钥）"""
    return bool(cfg.get("image_base_url") and cfg.get("image_api_key") and cfg.get("image_model"))


def test_llm_config(base_url: str, api_key: str, model: str) -> dict:
    """极小请求测试连通：成功返回延迟，失败返回原因；不打印密钥"""
    base_url = (base_url or "").strip()
    api_key = (api_key or "").strip()
    model = (model or "").strip()
    if not base_url or not api_key or not model:
        return {"ok": False, "error": "请填写 base_url、api_key 和 model"}
    started = time.time()
    try:
        client = OpenAI(base_url=base_url, api_key=api_key, timeout=20, max_retries=0)
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "回复 OK"}],
            temperature=0,
        )
    except Exception as e:
        return {"ok": False, "error": (f"{type(e).__name__}: {e}")[:300]}
    return {"ok": True, "latency_ms": int((time.time() - started) * 1000)}