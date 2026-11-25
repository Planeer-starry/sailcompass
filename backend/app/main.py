"""出海罗盘 SailCompass · 应用入口（3B：四段流水线 + 小海螺追问 + 阶段 4 识图 + 演示模式）"""
import json
import time
from typing import Optional

import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agents
from . import demo_image
from . import demo_translate
from . import export_docx
from . import export_pdf
from . import image_gen
from . import intent
from . import llm_config
from . import task_manager
from . import tools
from .demo_builder import build_demo_result
from .config import APP_DIR, FRONTEND_DIR

# 应用目录：保证在任意工作目录启动都能找到 prompts / demo_cache
BASE_DIR = APP_DIR

app = FastAPI(title="出海罗盘 SailCompass")

# CORS 兜底：正常从 http://127.0.0.1:8000 访问是同源用不到；留着方便调试期换端口
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# 静态资源（尤其 400KB 的 Tailwind 运行时）启用 gzip：慢网络下页面样式不会加载一半而错位
app.add_middleware(GZipMiddleware, minimum_size=1024)

class NoCacheStaticFiles(StaticFiles):
    """静态文件禁用缓存：开发期改完立即生效，部署后也不会拿到旧版。

    no-cache = 可以缓存但每次使用前必须向服务器确认（有 304 协商，不全量重下）。
    file_response 在本机 starlette 为同步方法，覆盖它可同时给 200 与 304 加头。
    """

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache, must-revalidate"
        return resp


# 静态资源只挂子路径，绝不挂根路径（避免吞掉 /api/* 路由）
app.mount("/static", NoCacheStaticFiles(directory=str(FRONTEND_DIR)), name="static")

# 意图理解路由：一句话解析产品字段 + 生成/咨询分流（实现见 intent.py，守 main.py 行数红线）
app.include_router(intent.router)
# Word 导出路由：文档构建与路由同处 export_docx.py，主文件不涨行数
app.include_router(export_docx.router)
# PDF 导出路由：PyMuPDF 内置中文字体，实现见 export_pdf.py
app.include_router(export_pdf.router)


# 静态资源版本号：进程启动时刻（模块级常量）。重启即变 → 链接变 → 浏览器强制拉新文件；部署本来就要重启，等于"部署即生效"，零维护
BUILD_ID = str(int(time.time()))


# ═══ 演示模式：没配文本模型时使用内置示例数据，零配置也能跑完整流程 ═══
DEMO_DATA_PATH = BASE_DIR / "prompts" / "demo_answers.json"
DEMO_STEP_SECONDS = 0.6      # 每段模拟耗时：四段 2.4 秒，配合前端 1.5 秒轮询可在 3 秒内出结果
_demo_data = None


def _force_demo(request: Request) -> bool:
    """请求头强制演示：X-Force-Mode: demo 时优先于 .env 自动判定"""
    return request.headers.get("X-Force-Mode", "").strip().lower() == "demo"


def _agent_cfg(cfg: dict):
    """请求头触发的配置才透传给 Agent；.env 路径返回 None，沿用原全局单例"""
    return cfg if cfg.get("from_header") else None


def _load_demo_data() -> dict:
    """读取演示问答/识图/模型清单；首次读取后缓存，文件缺失时抛出明确异常"""
    global _demo_data
    if _demo_data is None:
        _demo_data = json.loads(DEMO_DATA_PATH.read_text(encoding="utf-8"))
    return _demo_data


def _demo_ask_answer(question: str) -> str:
    """演示模式首页问答：按关键词返回预置回答，未命中给兜底引导"""
    ask = _load_demo_data()["ask"]
    upper = question.upper()
    if any(keyword.upper() in upper for keyword in ask["cert_keywords"]):
        return ask["cert_answer"]
    if any(keyword in question for keyword in ask["time_keywords"]):
        return ask["time_answer"]
    return ask["fallback_answer"]


def _compliance_markdown(rows: list) -> str:
    """把合规风险清单转成 Markdown 表格：直出存档与历史查看共用（不依赖前端）"""
    header = "| 风险项 | 风险等级 | 依据 | 整改建议 | 需人工核实 | 处理状态 |\n|---|---|---|---|---|---|"
    lines = [header]
    for row in rows or []:
        cells = [
            row.get("item", ""), row.get("risk_level", ""), row.get("basis", ""),
            row.get("action", ""), row.get("need_verify", ""), row.get("action_status", "待处理"),
        ]
        lines.append("| " + " | ".join(str(cell).replace("|", "｜") for cell in cells) + " |")
    return "\n".join(lines)


def _render_frontend(frontend_dir):
    """读 index.html 并把 __BUILD_ID__ 占位符替换为启动版本号

    html 本身也加 no-cache（与静态资源同策略）：防止浏览器导航缓存钉住旧版本号链接。
    """
    html = (frontend_dir / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(
        html.replace("__BUILD_ID__", BUILD_ID),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/")
def index():
    """首页：读取 frontend/index.html 并替换构建版本号"""
    return _render_frontend(FRONTEND_DIR)


@app.get("/api/health")
def health(request: Request):
    """健康检查：存活 + 各能力配置状态 + 模式来源（header > .env > 演示模式）"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    text_ok = llm_config.text_ready(cfg)
    return {
        "ok": True,
        "vision_configured": llm_config.vision_ready(cfg),
        "image_configured": llm_config.image_ready(cfg),
        "text_configured": text_ok,
        "demo_mode": forced or not text_ok,
        "mode_source": "forced" if forced else "auto",
        "text_model": cfg["text_model"],
        "vision_model": cfg["vision_model"],
        "image_model": cfg["image_model"],
    }


class GenerateRequest(BaseModel):
    """生成请求：产品六字段，产品名称必填"""
    product: str
    selling_points: str = ""
    params: str = ""
    category: str = ""
    platform: str = ""
    market: str = ""
    languages: list[str] = []


def _to_info(req: GenerateRequest) -> dict:
    """请求模型转 info dict（契约六字段）"""
    return {
        "product": req.product.strip(),
        "selling_points": req.selling_points.strip(),
        "params": req.params.strip(),
        "category": req.category.strip(),
        "platform": req.platform.strip(),
        "market": req.market.strip(),
        "languages": req.languages,
    }


@app.post("/api/generate")
def generate(req: GenerateRequest, background_tasks: BackgroundTasks, request: Request):
    """创建任务并立刻返回 task_id：强制/自动演示走示例数据，否则跑 Agent"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if not req.product.strip():
        # 错误格式统一 {"error": ...}，不用 HTTPException 默认的 {"detail": ...}
        return JSONResponse(status_code=400, content={"error": "请先填写产品名称"})
    info = _to_info(req)
    task_id = task_manager.create_task()
    task_manager.update_task(task_id, info=info)  # 导出 Word 需要产品名与创建时间
    if forced or not llm_config.text_ready(cfg):
        background_tasks.add_task(_run_demo_pipeline, task_id)
    else:
        background_tasks.add_task(_run_pipeline, task_id, info, _agent_cfg(cfg))
    return {"task_id": task_id}


def _run_demo_pipeline(task_id: str) -> None:
    """演示流水线：四段依次推进进度并写入内置示例结果，全程不调用 LLM"""
    try:
        task = task_manager.get_task(task_id) or {}
        info = task.get("info", {}) or {}
        data = build_demo_result(info)
        task_manager.append_result(task_id, demo=True, demo_notice=data.get("demo_notice", ""), tool_trace=data.get("tool_trace", {}))
        rows = [dict(row, action_status="待处理") for row in data.get("compliance", [])]
        steps = [
            ("insight", {"insight": data.get("insight", "")}),
            ("listing", {"listing": data.get("listing", "")}),
            ("compliance", {"compliance": rows, "compliance_raw": data.get("compliance_raw", "")}),
            ("quality", {"quality": data.get("quality", "")}),
        ]
        for index, (stage, patch) in enumerate(steps, start=1):
            task_manager.update_task(task_id, stage=stage, progress=index)
            time.sleep(DEMO_STEP_SECONDS)
            task_manager.append_result(task_id, **patch)
            task_manager.set_section_time(task_id, stage)
            task_manager.set_current_version(task_id, stage, 1)
            first_content = patch.get(stage, "")
            if stage == "compliance":
                first_content = _compliance_markdown(first_content)
            task_manager.add_revision(task_id, stage, first_content, "首次直出", version=1)
        task_manager.update_task(task_id, status="done", stage="")
    except Exception as e:
        # 演示数据缺失/损坏：明确记为失败并保留中文原因，不抛 500
        task_manager.update_task(task_id, status="failed", error=f"演示数据不可用：{e}")


def _run_pipeline(task_id: str, info: dict, cfg=None) -> None:
    """后台四段流水线：任一段失败即停并记 error，已完成结果保留"""
    try:
        # 第 1 段：市场洞察
        task_manager.update_task(task_id, stage="insight", progress=1)
        insight = agents.market_insight(info, cfg=cfg)
        task_manager.append_result(task_id, insight=insight)
        task_manager.set_section_time(task_id, "insight")
        task_manager.set_current_version(task_id, "insight", 1)
        task_manager.add_revision(task_id, "insight", insight, "首次直出", version=1)

        # 第 2 段：上架文案（中文）
        task_manager.update_task(task_id, stage="listing", progress=2)
        listing = agents.localize_listing(info, insight, cfg=cfg)
        word_result = tools.check_text(listing, info.get("platform", ""))
        task_manager.append_result(task_id, listing=listing, tool_trace={
            "word_check": word_result, "vision": False, "image": False, "export": False,
        })
        task_manager.set_section_time(task_id, "listing")
        task_manager.set_current_version(task_id, "listing", 1)
        task_manager.add_revision(task_id, "listing", listing, "首次直出", version=1)

        # 第 3 段：合规体检（rows 结构化 + raw 原文留证）
        task_manager.update_task(task_id, stage="compliance", progress=3)
        rows, raw = agents.compliance_check(info, listing, cfg=cfg, word_result=word_result)
        task_manager.append_result(task_id, compliance=rows, compliance_raw=raw)
        task_manager.set_section_time(task_id, "compliance")
        task_manager.set_current_version(task_id, "compliance", 1)
        task_manager.add_revision(task_id, "compliance", _compliance_markdown(rows), "首次直出", version=1)

        # 第 4 段：交叉质检
        task_manager.update_task(task_id, stage="quality", progress=4)
        quality = agents.quality_check(info, insight, listing, rows, cfg=cfg)
        task_manager.append_result(task_id, quality=quality)
        task_manager.set_section_time(task_id, "quality")
        task_manager.set_current_version(task_id, "quality", 1)
        task_manager.add_revision(task_id, "quality", quality, "首次直出", version=1)

        task_manager.update_task(task_id, status="done", stage="")
    except Exception as e:
        task_manager.update_task(task_id, status="failed", error=str(e))


@app.get("/api/task/{task_id}")
def get_task_status(task_id: str):
    """轮询端点：前端每 1.5 秒查一次"""
    task = task_manager.get_task(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    return {
        "status": task["status"],
        "stage": task["stage"],
        "progress": task["progress"],
        "result": task["result"],
        "error": task["error"],
    }


class ChatRequest(BaseModel):
    """追问请求：某个任务某个 Tab 的一句提问"""
    task_id: str
    tab: str
    question: str


def _build_chat_context(result: dict, tab: str) -> str:
    """把当前 Tab 对应的报告内容拼成追问上下文（compliance = rows + raw）"""
    if tab == "compliance":
        rows = json.dumps(result.get("compliance", []), ensure_ascii=False, indent=2)
        raw = result.get("compliance_raw", "")
        return "【风险清单】\n" + rows + "\n\n【模型原文】\n" + raw
    return str(result.get(tab, ""))


@app.post("/api/chat")
def chat(req: ChatRequest, request: Request):
    """小海螺追问：只依据当前页报告内容回答；异常明文返回，不静默"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if req.tab not in ("insight", "listing", "compliance", "quality"):
        return JSONResponse(status_code=400, content={"error": "未知的页面：" + req.tab})
    if not req.question.strip():
        return JSONResponse(status_code=400, content={"error": "问题不能为空"})
    task = task_manager.get_task(req.task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    if forced or not llm_config.text_ready(cfg):
        # 演示模式不读报告上下文、不调模型，返回固定说明
        return {"answer": _load_demo_data()["chat_answer"], "demo": True}
    context = _build_chat_context(task["result"], req.tab)
    if not context.strip():
        return JSONResponse(status_code=400, content={"error": "本页暂无报告内容，请先生成"})
    try:
        answer = agents.answer_question(req.task_id, req.tab, context, req.question.strip(), cfg=_agent_cfg(cfg))
        return {"answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"回答失败：{e}"})


class AskRequest(BaseModel):
    """首页自由问答请求：问题 + 前端维护的最近对话历史"""
    question: str
    history: list[dict] = []


@app.post("/api/ask")
def ask(req: AskRequest, request: Request):
    """小海螺自由问答：无需任务/报告，纯常识问答；历史只取最近 3 轮（6 条）防 token 膨胀"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if not req.question.strip():
        return JSONResponse(status_code=400, content={"error": "请先输入问题"})
    if len(req.question) > 200:
        return JSONResponse(status_code=400, content={"error": "问题太长了，请精简到 200 字以内"})
    if forced or not llm_config.text_ready(cfg):
        # 演示模式：不调模型，按关键词命中预置回答，未命中给兜底引导
        return {"answer": _demo_ask_answer(req.question.strip()), "demo": True}
    try:
        answer = agents.ask_conch(req.question.strip(), req.history[-6:], cfg=_agent_cfg(cfg))
        return {"answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"回答失败：{e}"})


def _demo_translation(doc_type: str, languages: list, text: str) -> str:
    """演示模式：不调模型，生成每种语言的中文对照示例"""
    lines = [f"（演示模式：以下为「{doc_type}」的翻译示例，接入模型后会按原文逐段翻译）", ""]
    for lang in languages:
        lines.append(f"## {lang}")
        lines.append("")
        lines.append(f"（演示译文：{doc_type}）")
        lines.append("")
        lines.append("### 中文对照")
        lines.append("")
        lines.append(text[:300] if text else "（未提供原文）")
        lines.append("")
    return "\n".join(lines)


class TranslateRequest(BaseModel):
    """05 多语翻译请求：材料类型 + 原文 + 目标语言 + 可选术语"""
    text: str = ""
    doc_type: str = "商品上架文案"
    languages: list[str] = []
    terms: str = ""


@app.post("/api/translate")
def translate(req: TranslateRequest, request: Request):
    """独立于四项流水线的多语翻译；保留型号、参数、单位、认证编号"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    text = (req.text or "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "请先粘贴要翻译的原文"})
    if len(text) > 12000:
        return JSONResponse(status_code=400, content={"error": "原文太长了，请控制在 12000 字以内"})
    languages = [x.strip() for x in (req.languages or []) if x.strip()]
    if not languages:
        return JSONResponse(status_code=400, content={"error": "请选择至少 1 种目标语言"})
    if forced or not llm_config.text_ready(cfg):
        return {"translation": demo_translate.generate_demo_translation(text, req.doc_type, languages, (req.terms or "").strip()), "demo": True}
    try:
        result = agents.translate_text(
            text, req.doc_type, languages, (req.terms or "").strip(), cfg=_agent_cfg(cfg)
        )
        return {"translation": result}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"翻译失败：{e}"})


class ReviseRequest(BaseModel):
    task_id: str
    section: str
    instruction: str


class RevisionDeleteRequest(BaseModel):
    versions: list[int] = []


@app.post("/api/revise")
def revise(req: ReviseRequest, request: Request):
    """协商改写：只改当前段；insight/listing 只重跑第 4 段质检，不重跑前两段"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if req.section not in ("insight", "listing", "quality"):
        if req.section == "compliance":
            return JSONResponse(status_code=400, content={"ok": False, "error": "合规表是结构化结果，不支持整段改写；可修改上架文案后重新生成"})
        return JSONResponse(status_code=400, content={"ok": False, "error": "未知段落：" + req.section})
    demo_rewrite = forced or not llm_config.text_ready(cfg)
    if not req.instruction.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "请先写一句要怎么改"})
    task = task_manager.get_task(req.task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "任务不存在"})
    result = task.get("result", {})
    current = result.get(req.section, "")
    if not current:
        return JSONResponse(status_code=400, content={"ok": False, "error": "这一段还没有生成内容"})
    current_version = task_manager.get_current_version(req.task_id, req.section)
    section_time = task_manager.get_section_time(req.task_id, req.section) or task.get("created")
    # 当前版本被从历史删除时先补存：保证“所有版本都在历史里”
    if not any(item.get("version") == current_version for item in task_manager.get_revisions(req.task_id, req.section)):
        task_manager.add_revision(
            req.task_id, req.section, current, "当前版本补存",
            time_value=section_time, version=current_version,
        )
    if len(task_manager.get_revisions(req.task_id, req.section)) >= task_manager.MAX_REVISIONS:
        return JSONResponse(status_code=400, content={
            "ok": False,
            "error": f"这一段已达到 {task_manager.MAX_REVISIONS} 个版本，请先删除历史存档再改写",
        })
    try:
        quality = result.get("quality", "") if req.section != "quality" else ""
        quality_history_full = False
        if demo_rewrite:
            new_content = current + "\n\n> \U0001F527 演示改写（未调用模型）：已收到你的要求「" + req.instruction.strip() + "」。配置文本模型后会真实重写；这里保留原文便于对比。"
            quality = new_content if req.section == "quality" else result.get("quality", "")
        else:
            new_content = agents.revise_section(req.section, current, req.instruction.strip(), task.get("info", {}), cfg=_agent_cfg(cfg))
            quality = new_content if req.section == "quality" else result.get("quality", "")
            if req.section in ("insight", "listing"):
                insight = new_content if req.section == "insight" else result.get("insight", "")
                listing = new_content if req.section == "listing" else result.get("listing", "")
                quality = agents.quality_check(task.get("info", {}), insight, listing, result.get("compliance", []), cfg=_agent_cfg(cfg))
                old_quality = result.get("quality", "")
                if old_quality:
                    quality_version = task_manager.get_current_version(req.task_id, "quality")
                    if not any(item.get("version") == quality_version for item in task_manager.get_revisions(req.task_id, "quality")):
                        task_manager.add_revision(
                            req.task_id, "quality", old_quality, "当前版本补存",
                            time_value=task_manager.get_section_time(req.task_id, "quality") or task.get("created"),
                            version=quality_version,
                        )
                    quality_new_version = quality_version + 1
                    if len(task_manager.get_revisions(req.task_id, "quality")) < task_manager.MAX_REVISIONS:
                        task_manager.add_revision(
                            req.task_id, "quality", quality,
                            f"随「{req.section}」改写自动重算",
                            version=quality_new_version,
                        )
                    else:
                        quality_history_full = True
                    task_manager.set_current_version(req.task_id, "quality", quality_new_version)
        new_version = current_version + 1
        task_manager.add_revision(
            req.task_id, req.section, new_content, req.instruction.strip(),
            version=new_version,
        )
        task_manager.set_current_version(req.task_id, req.section, new_version)
        task_manager.append_result(req.task_id, **{req.section: new_content, "quality": quality})
        task_manager.set_section_time(req.task_id, req.section)
        if req.section in ("insight", "listing") and not demo_rewrite:
            task_manager.set_section_time(req.task_id, "quality")
        return {
            "ok": True,
            "section": req.section,
            "content": new_content,
            "quality": quality,
            "previous": current_version,
            "revision": new_version,
            "quality_revision": task_manager.get_current_version(req.task_id, "quality"),
            "quality_history_full": quality_history_full,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": f"改写失败：{e}"})


@app.get("/api/revisions/{task_id}/{section}")
def list_revisions(task_id: str, section: str):
    """读取某段当前内容与历史版本列表（历史只存旧版，当前版在 result 里）"""
    task = task_manager.get_task(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "任务不存在"})
    result = task.get("result", {})
    current_version = task_manager.get_current_version(task_id, section)
    return {
        "ok": True,
        "section": section,
        "current": result.get(section, ""),
        "current_time": task_manager.get_section_time(task_id, section) or task.get("created"),
        "current_version": current_version,
        "history": task_manager.get_revisions(task_id, section),
        "limit": task_manager.MAX_REVISIONS,
    }


@app.post("/api/revisions/{task_id}/{section}/delete")
def delete_revisions(task_id: str, section: str, req: RevisionDeleteRequest):
    """删除指定历史版本（可多选）；当前版本不在历史里，不受影响"""
    task = task_manager.get_task(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "任务不存在"})
    if not req.versions:
        return JSONResponse(status_code=400, content={"ok": False, "error": "请先勾选要删除的历史版本"})
    removed = task_manager.delete_revisions(task_id, section, req.versions)
    return {"ok": True, "removed": removed, "history": task_manager.get_revisions(task_id, section)}


class RecheckRequest(BaseModel):
    task_id: str


@app.post("/api/recheck-quality")
def recheck_quality(req: RecheckRequest, request: Request):
    """只重算第 4 段质检，不改前两段。"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    demo = forced or not llm_config.text_ready(cfg)
    task = task_manager.get_task(req.task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "任务不存在"})
    result = task.get("result", {})
    if not result.get("insight") or not result.get("listing"):
        return JSONResponse(status_code=400, content={"ok": False, "error": "前两段还没有生成，无法重算质检"})
    current_quality = result.get("quality", "")
    current_version = task_manager.get_current_version(req.task_id, "quality")
    if current_quality and not any(item.get("version") == current_version for item in task_manager.get_revisions(req.task_id, "quality")):
        task_manager.add_revision(
            req.task_id, "quality", current_quality, "当前版本补存",
            time_value=task_manager.get_section_time(req.task_id, "quality") or task.get("created"),
            version=current_version,
        )
    if demo:
        quality = (
            "# 交叉质检（演示）\n\n"
            "> 🔧 演示模式：未调用模型，以下为结构占位结论；接入模型后会逐条核对前三段。\n\n"
            "## 一、一致性\n- 市场洞察与上架文案的核心卖点方向一致（演示占位）\n\n"
            "## 二、可执行性\n- 合规表中标「需人工核实」的项需要逐条补依据（演示占位）\n\n"
            "## 三、建议\n- 导出前先处理红色风险项，再核对标题与五点的参数是否一致（演示占位）\n"
        )
    else:
        try:
            quality = agents.quality_check(task.get("info", {}), result.get("insight", ""), result.get("listing", ""), result.get("compliance", []), cfg=_agent_cfg(cfg))
        except Exception as e:
            return JSONResponse(status_code=500, content={"ok": False, "error": f"重算质检失败：{e}"})
    history_full = False
    if current_quality:
        current_version += 1
        if len(task_manager.get_revisions(req.task_id, "quality")) < task_manager.MAX_REVISIONS:
            task_manager.add_revision(
                req.task_id, "quality", quality,
                "重算质检", version=current_version,
            )
        else:
            history_full = True
        task_manager.set_current_version(req.task_id, "quality", current_version)
    task_manager.append_result(req.task_id, quality=quality)
    task_manager.set_section_time(req.task_id, "quality")
    return {"ok": True, "quality": quality, "revision": current_version, "demo": demo, "history_full": history_full}


class TestConfigRequest(BaseModel):
    """连通测试请求：不落盘、不记录密钥"""
    base_url: str = ""
    api_key: str = ""
    model: str = ""


@app.post("/api/test-config")
def test_config(req: TestConfigRequest):
    """连通测试：HTTP 200 返回 ok/error，失败原因明文返回"""
    return llm_config.test_llm_config(req.base_url, req.api_key, req.model)



ALLOWED_IMAGE_TYPES = ("image/jpeg", "image/png")  # 只收 JPG / PNG
MAX_IMAGE_BYTES = 20 * 1024 * 1024                 # 大小上限 20MB


@app.post("/api/analyze-image")
def analyze_image(request: Request, file: Optional[UploadFile] = File(None)):
    """识图：multipart 接收 file 字段，调 vision 模型识别并返回结构化产品信息

    同步路由（与 /api/chat 一致）：vision 调用最长 180 秒，放线程池执行，不阻塞事件循环。
    """
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    demo = forced or not llm_config.text_ready(cfg)
    if not demo and not llm_config.vision_ready(cfg):
        return JSONResponse(
            status_code=400,
            content={"error": "识图未配置，请在设置里填写视觉模型"},
        )
    if file is None:
        return JSONResponse(status_code=400, content={"error": "请选择要识别的图片"})
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        return JSONResponse(status_code=400, content={"error": "只支持 JPG / PNG 图片"})
    if demo:
        # 演示模式：不读图、不调 vision，直接返回内置识别结果
        return {**_load_demo_data()["image_result"], "demo": True}
    image_bytes = file.file.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return JSONResponse(status_code=400, content={"error": "图片超过 20MB，请压缩后重试"})
    try:
        result = agents.analyze_product_image(image_bytes, file.content_type, cfg=_agent_cfg(cfg))
    except RuntimeError as e:
        # 「识图未配置」等运行时异常：按约定转 400 明文提示，不静默
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        # vision 调用失败等：不抛 500，明文返回错误原因
        return JSONResponse(content={"error": f"识图失败：{e}"})
    return result


class GenerateImageRequest(BaseModel):
    """02 生图请求：商品主图 / 详情长图 / 场景图，可带描述和参考图"""
    product: str
    scene: str = "outdoor"
    description: str = ""
    image_kind: str = "scene"
    reference_image: str = ""
    count: int = 1


IMAGE_SCENES = ("outdoor", "home", "gift")
IMAGE_KINDS = ("main", "detail", "detail_square", "scene", "other")


@app.post("/api/generate-image")
def generate_image(req: GenerateImageRequest, request: Request):
    """02 生图：同步路由（约 10–30 秒，放线程池执行，不阻塞事件循环）"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if req.scene not in IMAGE_SCENES:
        return JSONResponse(status_code=400, content={"error": "非法场景：" + req.scene})
    if req.image_kind not in IMAGE_KINDS:
        return JSONResponse(status_code=400, content={"error": "非法图片类型：" + req.image_kind})
    if not req.product.strip():
        return JSONResponse(status_code=400, content={"error": "请先填写产品名称"})
    count = max(1, min(6, req.count))
    if forced or not llm_config.image_ready(cfg):
        images = []
        for _ in range(count):
            images.append(demo_image.generate_demo_image(
                req.product.strip(), req.scene, req.image_kind, req.description.strip()
            ))
        return {"images": images, "demo": True}
    try:
        results = []
        for _ in range(count):
            item = image_gen.generate_scene_image(
                req.product.strip(),
                req.scene,
                req.description.strip(),
                req.image_kind,
                req.reference_image,
                cfg=_agent_cfg(cfg),
            )
            if isinstance(item, dict):
                item.setdefault("url", item.get("image_path") or item.get("image_url") or item.get("image_b64") or "")
            results.append(item)
        return {"images": results}
    except RuntimeError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})



if __name__ == "__main__":
    # 启动方式（在项目根目录执行）：python -m backend.app.main
    # 绑 0.0.0.0：部署到云服务器后外网（浏览器）才能访问；绑 127.0.0.1 只有服务器自己能访问
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000)