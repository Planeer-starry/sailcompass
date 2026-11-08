"""出海罗盘 SailCompass · 应用入口（3B：四段流水线 + 小海螺追问 + 阶段 4 识图 + 演示模式）"""
import json
import os
import time
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import agents
import image_gen
import intent
import llm_config
import task_manager

# 项目根目录：保证在任意工作目录启动都能找到 static / prompts
BASE_DIR = Path(__file__).parent

app = FastAPI(title="出海罗盘 SailCompass")

# CORS 兜底：正常从 http://127.0.0.1:8000 访问是同源用不到；留着方便调试期换端口
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.mount("/static", NoCacheStaticFiles(directory=str(BASE_DIR / "static")), name="static")

# 意图理解路由：一句话解析产品字段 + 生成/咨询分流（实现见 intent.py，守 main.py 行数红线）
app.include_router(intent.router)


# 静态资源版本号：进程启动时刻（模块级常量）。重启即变 → 链接变 → 浏览器强制拉新文件；部署本来就要重启，等于"部署即生效"，零维护
BUILD_ID = str(int(time.time()))


# ═══ 演示模式：没配文本模型时使用内置示例数据，零配置也能跑完整流程 ═══
DEMO_RESULT_PATH = BASE_DIR / "demo_cache" / "保温杯_完整结果.json"
DEMO_DATA_PATH = BASE_DIR / "prompts" / "demo_answers.json"
DEMO_STEP_SECONDS = 0.6      # 每段模拟耗时：四段 2.4 秒，配合前端 1.5 秒轮询可在 3 秒内出结果
_demo_data = None


def text_configured() -> bool:
    """文本模型三件套是否齐全：任一为空即视为未配置（进入演示模式）"""
    return bool(os.getenv("API_BASE_URL") and os.getenv("API_KEY") and os.getenv("MODEL"))


def demo_mode() -> bool:
    """演示模式：没有文本模型配置时启用内置示例数据，不调用任何 LLM"""
    return not text_configured()


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


@app.get("/")
def index():
    """首页：读 index.html 并把 __BUILD_ID__ 占位符替换为启动版本号

    html 本身也加 no-cache（与静态资源同策略）：防止浏览器导航缓存钉住旧版本号链接。
    """
    html = (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(
        html.replace("__BUILD_ID__", BUILD_ID),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


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
    languages: list[str] = []


def _to_info(req: GenerateRequest) -> dict:
    """请求模型转 info dict（契约六字段）"""
    return {
        "product": req.product.strip(),
        "selling_points": req.selling_points.strip(),
        "params": req.params.strip(),
        "category": req.category.strip(),
        "platform": req.platform.strip(),
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
    task_id = task_manager.create_task()
    if forced or not llm_config.text_ready(cfg):
        background_tasks.add_task(_run_demo_pipeline, task_id)
    else:
        background_tasks.add_task(_run_pipeline, task_id, _to_info(req), _agent_cfg(cfg))
    return {"task_id": task_id}


def _run_demo_pipeline(task_id: str) -> None:
    """演示流水线：四段依次推进进度并写入内置示例结果，全程不调用 LLM"""
    try:
        data = json.loads(DEMO_RESULT_PATH.read_text(encoding="utf-8"))
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

        # 第 2 段：多语种 Listing
        task_manager.update_task(task_id, stage="listing", progress=2)
        listing = agents.localize_listing(info, insight, cfg=cfg)
        task_manager.append_result(task_id, listing=listing)

        # 第 3 段：合规体检（rows 结构化 + raw 原文留证）
        task_manager.update_task(task_id, stage="compliance", progress=3)
        rows, raw = agents.compliance_check(info, listing, cfg=cfg)
        task_manager.append_result(task_id, compliance=rows, compliance_raw=raw)

        # 第 4 段：交叉质检
        task_manager.update_task(task_id, stage="quality", progress=4)
        quality = agents.quality_check(info, insight, listing, rows, cfg=cfg)
        task_manager.append_result(task_id, quality=quality)

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
def analyze_image(request: Request, file: UploadFile | None = File(None)):
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
    """场景图生成请求：产品名 + 场景（白名单 outdoor / home / gift）"""
    product: str
    scene: str


IMAGE_SCENES = ("outdoor", "home", "gift")  # 与 image_gen.SCENE_WORDS 键保持一致


@app.post("/api/generate-image")
def generate_image(req: GenerateImageRequest, request: Request):
    """场景图生成：同步路由（生图约 10–30 秒，放线程池执行，不阻塞事件循环）"""
    forced = _force_demo(request)
    cfg = llm_config.resolve_llm_config(request)
    if req.scene not in IMAGE_SCENES:
        return JSONResponse(status_code=400, content={"error": "非法场景：" + req.scene})
    if not req.product.strip():
        return JSONResponse(status_code=400, content={"error": "请先填写产品名称"})
    if forced or not llm_config.text_ready(cfg):
        # 演示模式：不调生图模型，按场景返回内置示例图
        return {"image_path": f"/static/demo_images/{req.scene}.png", "demo": True}
    if not llm_config.image_ready(cfg):
        return JSONResponse(
            status_code=400,
            content={"error": "生图未配置，请在设置里填写生图模型"},
        )
    try:
        return image_gen.generate_scene_image(req.product.strip(), req.scene, cfg=_agent_cfg(cfg))
    except RuntimeError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})



if __name__ == "__main__":
    # 启动方式：python main.py（内部就是 uvicorn）
    # 绑 0.0.0.0：部署到云服务器后外网（浏览器）才能访问；绑 127.0.0.1 只有服务器自己能访问
    uvicorn.run(app, host="0.0.0.0", port=8000)