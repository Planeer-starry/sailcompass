"""出海罗盘 · PDF 导出（PyMuPDF 内置简体中文字体，不依赖系统字体文件）"""
import time
from urllib.parse import quote

import fitz
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse, StreamingResponse

from . import task_manager

PDF_MIME = "application/pdf"
PAGE_W, PAGE_H = 595, 842
LEFT, RIGHT, TOP, BOTTOM = 50, 545, 52, 800
TITLE_COLOR = (0.12, 0.23, 0.54)
TEXT_COLOR = (0.12, 0.16, 0.23)
MUTED_COLOR = (0.39, 0.45, 0.55)


def _safe_filename(product: str) -> str:
    cleaned = "".join(c for c in str(product or "") if c not in '\\/:*?"<>|').strip()
    return cleaned[:24] or "report"


class _Writer:
    def __init__(self):
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = TOP

    def _new_page(self):
        self.page = self.doc.new_page(width=PAGE_W, height=PAGE_H)
        self.y = TOP

    def text(self, text, size=10.5, color=TEXT_COLOR, gap=5, indent=0):
        text = (text or "").rstrip()
        if not text:
            self.y += gap
            return
        if self.y + size * 1.6 > BOTTOM:
            self._new_page()
        rect = fitz.Rect(LEFT + indent, self.y, RIGHT, BOTTOM)
        try:
            rc = self.page.insert_textbox(rect, text, fontsize=size, fontname="china-s", color=color)
        except ValueError:
            rc = -1
        if rc < 0:
            self._new_page()
            rect = fitz.Rect(LEFT + indent, self.y, RIGHT, BOTTOM)
            try:
                rc = self.page.insert_textbox(rect, text, fontsize=size, fontname="china-s", color=color)
            except ValueError:
                rc = -1
            if rc < 0:
                # 单块超过整页：拆行/切块逐次写入，避免导出直接失败
                parts = text.splitlines() or [text]
                if len(parts) == 1:
                    parts = [text[i:i + 200] for i in range(0, len(text), 200)]
                for part in parts:
                    self.text(part, size=size, color=color, gap=gap, indent=indent)
                return
        used = (BOTTOM - rect.y0) - max(rc, 0)
        self.y += max(used, size * 1.5) + gap

    def markdown(self, content):
        for raw in (content or "").splitlines():
            line = raw.rstrip()
            if not line.strip():
                self.y += 5
                continue
            if line.startswith("### "):
                self.text(line[4:], size=11.5, color=TITLE_COLOR, gap=4)
            elif line.startswith("## "):
                self.text(line[3:], size=13, color=TITLE_COLOR, gap=5)
            elif line.startswith("# "):
                self.text(line[2:], size=16, color=TITLE_COLOR, gap=8)
            elif line.startswith("|"):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if all(set(c) <= set("-: ") for c in cells):
                    continue
                self.text("  |  ".join(cells), size=9.5, gap=3)
            elif line.lstrip().startswith(("- ", "* ")):
                self.text("• " + line.lstrip()[2:], size=10.5, gap=3, indent=10)
            else:
                self.text(line, size=10.5, gap=4)

    def save(self):
        return self.doc.tobytes(garbage=4, clean=True)


def build_report_pdf(result, info, sections=None) -> bytes:
    writer = _Writer()
    created = info.get("created") or time.time()
    product = str(info.get("product") or "").strip() or "未命名产品"
    stamp = time.strftime("%Y-%m-%d %H:%M", time.localtime(created))
    writer.text("出海罗盘 · 出海诊断报告", size=18, color=TITLE_COLOR, gap=4)
    writer.text("%s · %s · 信风队 Tradewind" % (product, stamp), size=9.5, color=MUTED_COLOR, gap=12)

    selected = set(sections or ["insight", "listing", "compliance", "quality"])
    added = 0
    if "insight" in selected and result.get("insight"):
        writer.text("一、市场洞察", size=14, color=TITLE_COLOR, gap=6)
        writer.markdown(result.get("insight"))
        added += 1
    if "listing" in selected and result.get("listing"):
        writer.text("二、上架文案（中文）", size=14, color=TITLE_COLOR, gap=6)
        writer.markdown(result.get("listing"))
        added += 1
    comp = result.get("compliance")
    if "compliance" in selected and comp:
        writer.text("三、合规体检", size=14, color=TITLE_COLOR, gap=6)
        if isinstance(comp, list):
            for row in comp:
                writer.text("%s｜%s｜%s" % (row.get("item", ""), row.get("risk_level", ""), row.get("action", "")), size=10, gap=2)
                if row.get("basis"):
                    writer.text("依据：" + str(row.get("basis")), size=9.5, gap=1, indent=10)
                if row.get("need_verify"):
                    writer.text("需人工核实：" + str(row.get("need_verify")), size=9.5, gap=3, indent=10)
        else:
            writer.markdown(str(comp))
        added += 1
    if "quality" in selected and result.get("quality"):
        writer.text("四、交叉质检", size=14, color=TITLE_COLOR, gap=6)
        writer.markdown(result.get("quality"))
        added += 1
    if "translate" in selected and result.get("translate"):
        writer.text("多语翻译", size=14, color=TITLE_COLOR, gap=6)
        writer.markdown(result.get("translate"))
        added += 1
    if not added:
        raise ValueError("所选部分还没有生成结果")
    return writer.save()


router = APIRouter()


def _serve(data: bytes, info: dict):
    filename = "出海罗盘报告_%s_%s.pdf" % (
        _safe_filename(info.get("product")),
        time.strftime("%Y%m%d", time.localtime(info["created"])),
    )
    headers = {"Content-Disposition": "attachment; filename*=UTF-8''%s" % quote(filename)}
    return StreamingResponse(iter([data]), media_type=PDF_MIME, headers=headers)


@router.get("/api/export-pdf/{task_id}")
def export_pdf_get(task_id: str, sections: str = ""):
    task = task_manager.get_task(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    result = task.get("result") or {}
    if not result:
        return JSONResponse(status_code=400, content={"error": "还没有生成结果"})
    info = dict(task.get("info") or {})
    info["created"] = task.get("created") or time.time()
    allowed = {"insight", "listing", "compliance", "quality", "translate"}
    picked = [x.strip() for x in sections.split(",") if x.strip() in allowed]
    try:
        data = build_report_pdf(result, info, picked or None)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return _serve(data, info)


@router.post("/api/export-pdf/{task_id}")
def export_pdf_post(task_id: str, payload: dict = Body(default={})):
    """多语翻译可能没有生成任务：允许仅凭 contents 导出"""
    task = task_manager.get_task(task_id)
    result = dict(task.get("result") or {}) if task else {}
    allowed = {"insight", "listing", "compliance", "quality", "translate"}
    contents = payload.get("contents") or {}
    for key in allowed:
        value = contents.get(key)
        if value:
            result[key] = value
    if not result:
        return JSONResponse(status_code=400, content={"error": "还没有生成结果"})
    picked = [x for x in (payload.get("sections") or []) if x in allowed]
    info = dict(task.get("info") or {}) if task else {"product": "多语翻译"}
    info["created"] = (task.get("created") if task else None) or time.time()
    try:
        data = build_report_pdf(result, info, picked or None)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return _serve(data, info)