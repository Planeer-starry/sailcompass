"""出海罗盘 SailCompass · 应用入口（阶段 1：骨架 + 市场洞察单 Agent）"""
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import agents

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


class InsightRequest(BaseModel):
    """阶段 1 请求体：产品名称必填，核心卖点可填"""
    product: str
    selling_points: str = ""


def _fill_info(req: InsightRequest) -> dict:
    """补全 info 六字段：阶段 1 只收两个字段，其余传空值，契约不漂移"""
    return {
        "product": req.product.strip(),
        "selling_points": req.selling_points.strip(),
        "params": "",
        "category": "",
        "platform": "",
        "languages": [],
    }


@app.post("/api/insight")
def insight(req: InsightRequest):
    """市场洞察：同步调用 Agent，最长约 3 分钟；异常明文返回，不静默"""
    if not req.product.strip():
        raise HTTPException(status_code=400, detail="产品名称不能为空")
    info = _fill_info(req)
    try:
        text = agents.market_insight(info)
        return {"ok": True, "insight": text}
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败：{e}")


if __name__ == "__main__":
    # 启动方式：python main.py（内部就是 uvicorn）
    uvicorn.run(app, host="127.0.0.1", port=8000)