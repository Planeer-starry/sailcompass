"""工具调用：违禁词库校验 + 认证查询。

数据集中在 compliance_words.json，缺失时降级为空结果，不阻断生成。
"""
import json
from pathlib import Path

WORDS_PATH = Path(__file__).parent / "compliance_words.json"
_cache = None


def _load():
    global _cache
    if _cache is not None:
        return _cache
    try:
        _cache = json.loads(WORDS_PATH.read_text(encoding="utf-8"))
    except Exception:
        _cache = {"version": "unavailable", "platforms": {}, "certifications": {}, "category_risks": {}}
    return _cache


def _find_hits(text, terms):
    lower = (text or "").lower()
    return [t for t in terms if t.lower() in lower]


def check_text(text, platform=""):
    """返回违禁词检查结果；词库缺失时 checked=0, hits=[]，不抛异常。"""
    data = _load()
    platforms = data.get("platforms", {})
    rule = platforms.get(platform) or platforms.get("其他") or {}
    banned = rule.get("banned", [])
    risky = rule.get("risky", [])
    banned_hits = _find_hits(text, banned)
    risky_hits = _find_hits(text, risky)
    hits = [{"word": w, "level": "banned"} for w in banned_hits]
    hits += [{"word": w, "level": "risky"} for w in risky_hits]
    return {
        "version": data.get("version", "unavailable"),
        "checked": len(banned) + len(risky),
        "platform": platform or "其他",
        "hits": hits,
        "banned_hits": banned_hits,
        "risky_hits": risky_hits,
    }


def certifications_for(market, category):
    """按市场 + 品类取认证；找不到时回退该市场 default。"""
    data = _load()
    table = data.get("certifications", {})
    market_rule = table.get(market)
    if not market_rule:
        for name, value in table.items():
            if name != "全球市场" and (name in market or market in name):
                market_rule = value
                break
    if not market_rule:
        market_rule = table.get("全球市场", {})
    certs = market_rule.get(category)
    if not certs:
        certs = market_rule.get("default") or ["按目标国确认"]
    return list(certs)


def category_risks(category):
    data = _load()
    return list(data.get("category_risks", {}).get(category) or [])

TRADEMARKS = ["apple", "samsung", "nike", "adidas", "disney", "hello kitty", "marvel", "dyson", "stanley", "yeti", "coca-cola", "lego", "sony", "xiaomi", "huawei", "iphone", "airpods"]


def check_trademarks(text):
    """商标/品牌词风险：命中知名品牌词时提示人工确认授权。"""
    lower = (text or "").lower()
    return [name for name in TRADEMARKS if name in lower]
