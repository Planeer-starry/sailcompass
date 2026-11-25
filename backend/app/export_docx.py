"""出海罗盘 SailCompass · Word 导出（python-docx 生成 .docx 二进制流）

路由与文档构建都放在本模块，main.py 只挂一行 include_router，避免主文件越过 400 行红线。
"""
import io
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse, StreamingResponse

from . import task_manager

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
BRAND = RGBColor(0x1E, 0x3A, 0x8A)   # 主色 #1E3A8A
GRAY = RGBColor(0x64, 0x74, 0x8B)    # 页脚灰字 #64748B
FILLS = {"红": "FEF2F2", "黄": "FFFBEB", "绿": "F0FDF4"}
TABLE_HEADERS = ["风险项", "等级", "依据", "整改建议", "需人工核实", "处理状态"]

# 中文字体：Windows 有微软雅黑则用之，否则降级宋体（避免中文显示成方框）
_WIN_FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
_CJK_FONT = "Microsoft YaHei" if (_WIN_FONT_DIR / "msyh.ttc").exists() else "SimSun"


def _style_run(run, size=10.5, bold=False, color=None) -> None:
    """统一设置西文与东亚字体，保证中英文都不出现方框"""
    run.font.name = _CJK_FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rfonts = run._element.get_or_add_rPr().get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
        rfonts.set(qn(attr), _CJK_FONT)


def _init_styles(doc: Document) -> None:
    """Normal 样式统一字体与 10.5pt 字号，正文兜底不靠逐段设置"""
    normal = doc.styles["Normal"]
    normal.font.name = _CJK_FONT
    normal.font.size = Pt(10.5)
    rfonts = normal.element.get_or_add_rPr().get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
        rfonts.set(qn(attr), _CJK_FONT)


def _clean(text: str) -> str:
    """去掉 Markdown 标记符号 # * ` 后返回纯文本"""
    return re.sub(r"[#*`]", "", text or "").strip()


def _add_heading(doc: Document, text: str) -> None:
    """一级章节标题：Heading 1 样式 + 中文字体 16pt 加粗"""
    paragraph = doc.add_heading(text, level=1)
    for run in paragraph.runs:
        _style_run(run, size=16, bold=True)


def _add_markdown(doc: Document, text: str) -> None:
    """简易 Markdown 转换：标题降为 Heading 2，列表转项目符号/编号段落，其余为正文"""
    for raw in (text or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            paragraph = doc.add_heading(_clean(heading.group(2)), level=2)
            for run in paragraph.runs:
                _style_run(run, size=13, bold=True)
            continue
        elif re.match(r"^[-*]\s+", line):
            paragraph = doc.add_paragraph(_clean(re.sub(r"^[-*]\s+", "", line)), style="List Bullet")
        elif re.match(r"^\d+[.、]\s+", line):
            paragraph = doc.add_paragraph(_clean(re.sub(r"^\d+[.、]\s+", "", line)), style="List Number")
        else:
            paragraph = doc.add_paragraph(_clean(line))
            continue
        for run in paragraph.runs:
            _style_run(run, size=10.5)


def _shade(cell, fill: str) -> None:
    """单元格底色：红/黄/绿风险等级用 w:shd 填充"""
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    cell._tc.get_or_add_tcPr().append(shd)


def _write_cell(cell, text: str, bold=False) -> None:
    """写入单元格文本并统一字体（覆盖表格默认样式）"""
    cell.text = ""
    run = cell.paragraphs[0].add_run(str(text or ""))
    _style_run(run, size=10, bold=bold)


def _add_compliance_table(doc: Document, rows: list) -> None:
    """合规风险清单转 Word 表格：等级列按红/黄/绿着色，表后附红黄处理统计"""
    table = doc.add_table(rows=1, cols=len(TABLE_HEADERS))
    table.style = "Table Grid"
    for index, header in enumerate(TABLE_HEADERS):
        _write_cell(table.rows[0].cells[index], header, bold=True)
    red_total = red_done = yellow_total = yellow_done = 0
    for row in rows or []:
        level = str(row.get("risk_level", "")).strip()
        status = row.get("action_status") or "待处理"
        done = status != "待处理"
        if level == "红":
            red_total, red_done = red_total + 1, red_done + int(done)
        elif level == "黄":
            yellow_total, yellow_done = yellow_total + 1, yellow_done + int(done)
        values = [row.get("item"), level, row.get("basis"), row.get("action"),
                  row.get("need_verify"), status]
        cells = table.add_row().cells
        for index, value in enumerate(values):
            _write_cell(cells[index], value)
        if level in FILLS:
            _shade(cells[1], FILLS[level])
    summary = doc.add_paragraph()
    _style_run(summary.add_run(
        "红项 %d 条，已处理 %d 条；黄项 %d 条，已处理 %d 条"
        % (red_total, red_done, yellow_total, yellow_done)), size=10.5)


def _add_footer(doc: Document) -> None:
    """页脚灰字 9pt：AI 生成声明 + 团队署名"""
    run = doc.add_paragraph().add_run(
        "本报告由 AI 生成，仅供参考。所有风险项需人工复核后方可对外使用。\n"
        "出海罗盘 SailCompass · 信风队 Tradewind")
    _style_run(run, size=9, color=GRAY)


def build_report_docx(result: dict, info: dict, sections=None) -> bytes:
    """按所选章节生成 .docx 字节流；sections 为空表示四段全导"""
    doc = Document()
    _init_styles(doc)
    created = info.get("created") or time.time()
    product = str(info.get("product") or "").strip() or "未命名产品"

    _style_run(doc.add_paragraph().add_run("出海罗盘 · 出海诊断报告"),
               size=20, bold=True, color=BRAND)
    stamp = time.strftime("%Y-%m-%d %H:%M", time.localtime(created))
    _style_run(doc.add_paragraph().add_run(
        "%s · %s · 信风队 Tradewind" % (product, stamp)), size=10.5, color=GRAY)
    _style_run(doc.add_paragraph().add_run("—" * 40), size=10.5, color=GRAY)

    selected = set(sections or ["insight", "listing", "compliance", "quality"])
    added = 0
    if "insight" in selected and result.get("insight"):
        _add_heading(doc, "一、市场洞察")
        _add_markdown(doc, result.get("insight", ""))
        added += 1
    if "listing" in selected and result.get("listing"):
        _add_heading(doc, "二、上架文案（中文）")
        _add_markdown(doc, result.get("listing", ""))
        added += 1
    if "compliance" in selected and result.get("compliance"):
        _add_heading(doc, "三、合规体检")
        comp = result.get("compliance")
        if isinstance(comp, list):
            _add_compliance_table(doc, comp)
        else:
            _add_markdown(doc, str(comp))
        added += 1
    if "quality" in selected and result.get("quality"):
        _add_heading(doc, "四、交叉质检")
        _add_markdown(doc, result.get("quality", ""))
        added += 1
    if "translate" in selected and result.get("translate"):
        _add_heading(doc, "多语翻译")
        _add_markdown(doc, result.get("translate", ""))
        added += 1
    if added == 0:
        raise ValueError("所选部分还没有生成结果")
    _add_footer(doc)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _safe_filename(name: str) -> str:
    """文件名安全化：Windows 非法字符一律替换为下划线"""
    cleaned = re.sub(r'[/\\:*?"<>|]', "_", name or "").strip()
    return cleaned or "未命名产品"


router = APIRouter()


@router.get("/api/export-docx/{task_id}")
def export_docx_route(task_id: str, sections: str = ""):
    """按任务已生成结果导出 Word；sections=insight,listing,... 可只导所选段"""
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
        data = build_report_docx(result, info, picked or None)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    filename = "出海罗盘报告_%s_%s.docx" % (
        _safe_filename(info.get("product")),
        time.strftime("%Y%m%d", time.localtime(info["created"])))
    headers = {"Content-Disposition": "attachment; filename*=UTF-8''%s" % quote(filename)}
    return StreamingResponse(iter([data]), media_type=DOCX_MIME, headers=headers)


@router.post("/api/export-docx/{task_id}")
def export_docx_with_contents(task_id: str, payload: dict = Body(default={})):
    """按前端选定的版本内容导出 Word；contents 优先于任务当前结果

    多语翻译是独立功能，可能没有生成任务：此时允许仅凭 contents 导出。
    """
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
        data = build_report_docx(result, info, picked or None)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    filename = "出海罗盘报告_%s_%s.docx" % (
        _safe_filename(info.get("product")),
        time.strftime("%Y%m%d", time.localtime(info["created"])))
    headers = {"Content-Disposition": "attachment; filename*=UTF-8''%s" % quote(filename)}
    return StreamingResponse(iter([data]), media_type=DOCX_MIME, headers=headers)