"""出海罗盘 · 场景图生成模块（阶段 5：智谱 CogView 的 OpenAI 兼容层文生图）

与 agents.py 解耦：agents 保持「四 Agent + 识图」职责，生图独立成模块。
调用链：SDK images.generate 优先 → 失败降级底层 post 直打 /images/generations。
"""
import logging
import os
import urllib.request
import uuid

from openai import OpenAI

# 独立 logger：自带 handler 直接打 stderr，不依赖 uvicorn 日志配置，实测排查方便
logger = logging.getLogger("image_gen")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("[image_gen] %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)

# 场景词映射：键即路由层白名单（outdoor / home / gift），值进生图 prompt
SCENE_WORDS = {
    "outdoor": "户外自然场景，如草地、山野，自然光线明亮",
    "home": "温馨家居场景，如木桌、客厅一角，光线柔和",
    "gift": "礼品场景，精美礼盒与丝带点缀，节日氛围",
}

# 生成图落盘目录：远程 URL 带 Expires（实测 7 天过期）且浏览器下载会被 CORS 拦，必须本地留存
GEN_DIR = os.path.join(os.path.dirname(__file__), "static", "generated")

# 生图客户端惰性单例：与文本 / vision 客户端分开（IMAGE_* 三项独立配置）
_image_client = None


def image_configured() -> bool:
    """生图是否可用：IMAGE_* 三项任一缺失即视为未配置"""
    return bool(os.getenv("IMAGE_BASE_URL") and os.getenv("IMAGE_API_KEY") and os.getenv("IMAGE_MODEL"))


def _get_image_client(cfg=None) -> OpenAI:
    """获取生图客户端：cfg 有专用地址/密钥时用临时 client；否则沿用原单例"""
    global _image_client
    if cfg and cfg.get("image_base_url") and cfg.get("image_api_key"):
        return OpenAI(
            base_url=cfg["image_base_url"],
            api_key=cfg["image_api_key"],
            timeout=120,
            max_retries=1,
        )
    if _image_client is None:
        if not image_configured():
            raise RuntimeError("生图未配置")
        _image_client = OpenAI(
            base_url=os.getenv("IMAGE_BASE_URL"),
            api_key=os.getenv("IMAGE_API_KEY"),
            timeout=120,
            max_retries=1,
        )
    return _image_client


def _build_prompt(product: str, scene: str) -> str:
    """生图提示词：电商场景图；画面禁止文字 / 品牌 logo / 人脸"""
    return (
        f"一张电商产品场景图：{product}，{SCENE_WORDS[scene]}。"
        "画面为白底或真实场景，构图干净、突出产品本身；"
        "不要出现任何文字，不要出现品牌 logo，不要出现人脸。"
    )


def _sniff_image_ext(head: bytes) -> str:
    """按文件头嗅探真实格式：JPEG 头 → .jpg，PNG 头与其余 → .png（实测 URL 叫 .png 内容却是 JPEG）"""
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    return ".png"


def _download_generated_image(url: str) -> str:
    """下载远程生成图到 static/generated/，文件名按真实内容嗅探；异常由调用方降级处理"""
    os.makedirs(GEN_DIR, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as resp:
        content = resp.read()
    fname = uuid.uuid4().hex + _sniff_image_ext(content[:8])
    with open(os.path.join(GEN_DIR, fname), "wb") as f:
        f.write(content)
    return fname


def _normalize_image_response(data: dict) -> dict:
    """响应归一：url 通道落盘返 image_path；b64_json 拼 data URL；异常降级透远程 url"""
    items = data.get("data") if isinstance(data, dict) else None
    if not items or not isinstance(items[0], dict):
        return {"error": "生图接口返回里没有图片数据"}
    first = items[0]
    if first.get("url"):
        url = str(first["url"])
        try:
            fname = _download_generated_image(url)
            return {"image_path": "/static/generated/" + fname}
        except Exception as dl_err:
            # 落盘失败降级：img.src 仍能显示远程图，但会过期且下载可能被 CORS 拦
            logger.warning("生成图落盘失败，降级返回远程 URL（Expires 过后为裂图）：%s", dl_err)
            return {"image_url": url}
    b64 = first.get("b64_json")
    if b64:
        prefix = os.getenv("IMAGE_URL_PREFIX", "data:image/png;base64,")
        return {"image_b64": prefix + str(b64)}
    return {"error": "生图接口返回里既没有 url 也没有 b64_json"}


def _call_images_api(body: dict, cfg=None) -> dict:
    """两级降级：先 SDK images.generate；失败则底层 post 直打兼容层同一路径"""
    try:
        resp = _get_image_client(cfg).images.generate(
            model=body["model"], prompt=body["prompt"], size=body["size"],
        )
        return resp.model_dump()
    except Exception as sdk_err:
        logger.warning("SDK images.generate 不可用（%s），降级为底层 post 直连", sdk_err)
        data = _get_image_client(cfg).post("/images/generations", cast_to=object, body=body)
        return data if isinstance(data, dict) else {"data": []}


def generate_scene_image(product: str, scene: str, cfg=None) -> dict:
    """生图主入口：未配置抛 RuntimeError；接口失败返回 {"error": ...}，不抛 500"""
    if cfg:
        ready = bool(cfg.get("image_base_url") and cfg.get("image_api_key") and cfg.get("image_model"))
    else:
        ready = image_configured()
    if not ready:
        raise RuntimeError("生图未配置")
    body = {
        "model": (cfg or {}).get("image_model") or os.getenv("IMAGE_MODEL"),
        "prompt": _build_prompt(product, scene),
        "size": "1024x1024",
    }
    try:
        data = _call_images_api(body, cfg=cfg)
    except Exception as raw_err:
        return {"error": f"生图失败：{raw_err}"}
    # 原始响应（截断 800 字符；key 只在请求头，响应体不含）落日志，方便排查兼容层差异
    logger.info("生图接口原始响应（截断）：%s", str(data)[:800])
    return _normalize_image_response(data)