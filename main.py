"""出海罗盘 SailCompass · 应用入口（3B：四段流水线 + 小海螺追问 + 阶段 4 识图）"""
import json
import time
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import agents
import image_gen
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


# 静态资源版本号：进程启动时刻（模块级常量）。重启即变 → 链接变 → 浏览器强制拉新文件；部署本来就要重启，等于"部署即生效"，零维护
BUILD_ID = str(int(time.time()))


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
def health():
    """健康检查：存活 + 各能力配置状态（前端据此禁用未配置的功能，阶段 6 可复用）"""
    return {
        "ok": True,
        "vision_configured": agents.vision_configured(),
        "image_configured": image_gen.image_configured(),
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
def generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    """创建任务并立刻返回 task_id，流水线在后台跑（本轮只跑第一段）"""
    if not req.product.strip():
        # 错误格式统一 {"error": ...}，不用 HTTPException 默认的 {"detail": ...}
        return JSONResponse(status_code=400, content={"error": "请先填写产品名称"})
    task_id = task_manager.create_task()
    background_tasks.add_task(_run_pipeline, task_id, _to_info(req))
    return {"task_id": task_id}


def _run_pipeline(task_id: str, info: dict) -> None:
    """后台四段流水线：任一段失败即停并记 error，已完成结果保留"""
    try:
        # 第 1 段：市场洞察
        task_manager.update_task(task_id, stage="insight", progress=1)
        insight = agents.market_insight(info)
        task_manager.append_result(task_id, insight=insight)

        # 第 2 段：多语种 Listing
        task_manager.update_task(task_id, stage="listing", progress=2)
        listing = agents.localize_listing(info, insight)
        task_manager.append_result(task_id, listing=listing)

        # 第 3 段：合规体检（rows 结构化 + raw 原文留证）
        task_manager.update_task(task_id, stage="compliance", progress=3)
        rows, raw = agents.compliance_check(info, listing)
        task_manager.append_result(task_id, compliance=rows, compliance_raw=raw)

        # 第 4 段：交叉质检
        task_manager.update_task(task_id, stage="quality", progress=4)
        quality = agents.quality_check(info, insight, listing, rows)
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
def chat(req: ChatRequest):
    """小海螺追问：只依据当前页报告内容回答；异常明文返回，不静默"""
    if req.tab not in ("insight", "listing", "compliance", "quality"):
        return JSONResponse(status_code=400, content={"error": "未知的页面：" + req.tab})
    if not req.question.strip():
        return JSONResponse(status_code=400, content={"error": "问题不能为空"})
    task = task_manager.get_task(req.task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"error": "任务不存在"})
    context = _build_chat_context(task["result"], req.tab)
    if not context.strip():
        return JSONResponse(status_code=400, content={"error": "本页暂无报告内容，请先生成"})
    try:
        answer = agents.answer_question(req.task_id, req.tab, context, req.question.strip())
        return {"answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"回答失败：{e}"})



ALLOWED_IMAGE_TYPES = ("image/jpeg", "image/png")  # 只收 JPG / PNG
MAX_IMAGE_BYTES = 20 * 1024 * 1024                 # 大小上限 20MB


@app.post("/api/analyze-image")
def analyze_image(file: UploadFile | None = File(None)):
    """识图：multipart 接收 file 字段，调 vision 模型识别并返回结构化产品信息

    同步路由（与 /api/chat 一致）：vision 调用最长 180 秒，放线程池执行，不阻塞事件循环。
    """
    if not agents.vision_configured():
        return JSONResponse(
            status_code=400,
            content={"error": "识图未配置，请在 .env 填写 VISION_* 三项"},
        )
    if file is None:
        return JSONResponse(status_code=400, content={"error": "请选择要识别的图片"})
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        return JSONResponse(status_code=400, content={"error": "只支持 JPG / PNG 图片"})
    image_bytes = file.file.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return JSONResponse(status_code=400, content={"error": "图片超过 20MB，请压缩后重试"})
    try:
        result = agents.analyze_product_image(image_bytes, file.content_type)
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
def generate_image(req: GenerateImageRequest):
    """场景图生成：同步路由（生图约 10–30 秒，放线程池执行，不阻塞事件循环）"""
    if req.scene not in IMAGE_SCENES:
        return JSONResponse(status_code=400, content={"error": "非法场景：" + req.scene})
    if not req.product.strip():
        return JSONResponse(status_code=400, content={"error": "请先填写产品名称"})
    if not image_gen.image_configured():
        return JSONResponse(
            status_code=400,
            content={"error": "生图未配置，请在设置里填写 IMAGE_*"},
        )
    try:
        return image_gen.generate_scene_image(req.product.strip(), req.scene)
    except RuntimeError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})



if __name__ == "__main__":
    # 启动方式：python main.py（内部就是 uvicorn）
    uvicorn.run(app, host="127.0.0.1", port=8000)