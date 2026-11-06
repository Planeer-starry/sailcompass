"""出海罗盘 SailCompass · 应用入口（阶段 3A：异步任务 + 轮询，只跑市场洞察）"""
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import agents
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

# 静态资源只挂子路径，绝不挂根路径（避免吞掉 /api/* 路由）
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/")
def index():
    """首页：显式路由返回 index.html（不用 StaticFiles 挂根路径）"""
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
def health():
    """健康检查：只检查服务存活，不依赖 .env 配置"""
    return {"ok": True}


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
    """后台流水线：整体 try/except，异常写入任务，不静默"""
    try:
        task_manager.update_task(task_id, stage="insight", progress=1)
        text = agents.market_insight(info)
        task_manager.update_task(task_id, result={"insight": text}, status="done")
    except Exception as e:
        task_manager.update_task(task_id, status="failed", error=str(e))
    # 3B 阶段在此续接：localize_listing → compliance_check → quality_check


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


if __name__ == "__main__":
    # 启动方式：python main.py（内部就是 uvicorn）
    uvicorn.run(app, host="127.0.0.1", port=8000)