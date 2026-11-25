"""离线演示生图：Pillow 本地合成，不调用任何生图模型。

函数签名：
    generate_demo_image(product, scene, image_kind, description="")
返回：
    {"url": "/static/generated/文件名.png", "demo": True, "kind": image_kind}
"""
import random
import re
import string
from datetime import datetime

from PIL import Image, ImageDraw, ImageFont

from .config import FRONTEND_DIR

GENERATED_DIR = FRONTEND_DIR / "generated"

SCENE_META = {
    "outdoor": {"label": "OUTDOOR", "cn": "户外", "top": (20, 53, 106), "bottom": (14, 116, 144)},
    "home": {"label": "HOME", "cn": "家居", "top": (120, 53, 15), "bottom": (245, 158, 11)},
    "gift": {"label": "GIFT", "cn": "礼品", "top": (88, 28, 135), "bottom": (192, 38, 211)},
    "studio": {"label": "STUDIO", "cn": "棚拍", "top": (30, 58, 138), "bottom": (15, 23, 42)},
}

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]


def _font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap(draw, text, font, max_width):
    lines = []
    for paragraph in str(text or "").split("\n"):
        line = ""
        for ch in paragraph:
            candidate = line + ch
            if draw.textlength(candidate, font=font) <= max_width or not line:
                line = candidate
            else:
                lines.append(line)
                line = ch
        lines.append(line)
    return lines or [""]


def _draw_gradient(draw, width, height, top, bottom):
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)


def _card(img, box, radius=44, fill=(255, 255, 255, 255)):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    x1, y1, x2, y2 = box
    d.rounded_rectangle((x1 + 10, y1 + 16, x2 + 10, y2 + 16), radius=radius, fill=(15, 23, 42, 70))
    d.rounded_rectangle(box, radius=radius, fill=fill)
    img.alpha_composite(overlay)


def _draw_center(img, text, font, y, fill, max_width, spacer=10):
    d = ImageDraw.Draw(img)
    lines = _wrap(d, text, font, max_width)
    line_h = int(font.size * 1.4) + spacer
    for i, line in enumerate(lines):
        d.text((img.width // 2, y + i * line_h), line, font=font, fill=fill, anchor="ma")
    return y + len(lines) * line_h


def _watermark(img):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.text((img.width - 28, img.height - 24), "演示图 DEMO", font=_font(22), fill=(255, 255, 255, 130), anchor="rs")
    img.alpha_composite(overlay)


def _filename():
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return "demo_" + datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + rand + ".png"


def _section_texts(description, sections, product=""):
    """按关键词把描述句子分到各分区；关键词都没命中时用描述原文兜底，只有完全没描述才用产品名。"""
    parts = [x.strip() for x in re.split(r"[；;。\n]", description) if x.strip()] if description else []
    used = set()
    picked = []
    for _, keywords in sections:
        hit = ""
        for i, part in enumerate(parts):
            if i not in used and any(k in part for k in keywords):
                hit = part
                used.add(i)
                break
        picked.append(hit)
    leftover = [p for i, p in enumerate(parts) if i not in used]
    base = (product or "产品").strip() or "产品"
    filled = []
    for hit in picked:
        if hit:
            filled.append(hit)
        elif leftover:
            filled.append(leftover.pop(0))
        elif description:
            filled.append(description)
        else:
            filled.append(base + "：按实际产品填写")
    return filled


def generate_demo_image(product, scene, image_kind, description=""):
    product = (product or "你的产品").strip() or "你的产品"
    description = (description or "").strip()
    kind = image_kind if image_kind in ("main", "detail", "detail_square", "scene", "other") else "main"
    meta = SCENE_META.get(scene or "studio", SCENE_META["studio"])
    is_long = kind == "detail"
    width, height = (1024, 1792) if is_long else (1024, 1024)

    img = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    _draw_gradient(draw, width, height, meta["top"], meta["bottom"])

    margin = 70 if is_long else 92
    _card(img, (margin, margin, width - margin, height - margin))
    d = ImageDraw.Draw(img)

    label_font = _font(26 if is_long else 24)
    d.text((margin + 42, margin + 40), meta["label"] + "  ·  智能生图演示", font=label_font, fill=(100, 116, 139))

    if not is_long:
        y = _draw_center(img, product, _font(64), 350, (30, 41, 59), width - margin * 2 - 120)
        y = _draw_center(img, meta["cn"] + "场景 · 演示合成", _font(28), y + 12, (71, 85, 105), width - margin * 2 - 160)
        gray = _font(21)
        d.text((width // 2, y + 26), "未调用生图模型", font=gray, fill=(148, 163, 184), anchor="ma")
        d.text((width // 2, y + 58), "配置 IMAGE_API_KEY 后为真实生成", font=gray, fill=(148, 163, 184), anchor="ma")
    else:
        d.text((width // 2, 190), product, font=_font(56), fill=(30, 41, 59), anchor="ma")
        d.text((width // 2, 266), meta["cn"] + "场景 · 演示合成", font=_font(26), fill=(71, 85, 105), anchor="ma")
        section_defs = [
            ("材质与工艺", ("材质", "工艺", "不锈钢", "参数", "规格")),
            ("核心卖点", ("卖点", "保温", "功能", "核心", "优势")),
            ("使用场景", ("场景", "使用", "户外", "家居", "办公", "旅行", "人群")),
        ]
        bodies = _section_texts(description, section_defs, product)
        sections = [(title, body) for (title, _), body in zip(section_defs, bodies)]
        top = 340
        for title, body in sections:
            _card(img, (margin + 38, top, width - margin - 38, top + 300), radius=26, fill=(248, 250, 252, 255))
            d = ImageDraw.Draw(img)
            d.text((margin + 72, top + 38), title, font=_font(32), fill=(30, 58, 138))
            lines = _wrap(d, body, _font(24), width - margin * 2 - 110)
            for i, line in enumerate(lines[:4]):
                d.text((margin + 72, top + 96 + i * 38), line, font=_font(24), fill=(71, 85, 105))
            top += 348
        d.text((width // 2, height - 150), "未调用生图模型 · 配置 IMAGE_API_KEY 后为真实生成", font=_font(20), fill=(148, 163, 184), anchor="ma")

    _watermark(img)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    filename = _filename()
    img.convert("RGB").save(GENERATED_DIR / filename, format="PNG")
    return {"url": "/static/generated/" + filename, "demo": True, "kind": kind}