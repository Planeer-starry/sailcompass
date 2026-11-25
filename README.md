# 出海罗盘 SailCompass 4.9

面向跨境卖家的出海工作台：输入产品信息，四段流水线依次产出市场洞察、多语种 Listing、合规体检与交叉质检，并支持页面追问、产品识图、场景图生成与 Word 报告导出。

前后端完整项目：FastAPI 后端 + 零依赖前端，可部署到服务器多人共用。模型密钥可放在项目 `.env`，也可只在浏览器设置面板中保存。

## 能力

| 能力 | 说明 |
| --- | --- |
| 一句话解析 | 输入一句需求，自动解析品类、平台、语言，并区分「生成报告 / 咨询」 |
| 市场洞察 | 目标市场、用户画像、卖点方向、竞争与定价参考 |
| 多语种 Listing | 按目标语言生成标题、五点、描述与关键词 |
| 合规体检 | 结构化风险表（等级 / 依据 / 整改建议 / 需人工核实 / 处理状态） |
| 交叉质检 | 独立复核前三段结果的一致性与可执行性 |
| 罗盘追问 | 基于当前页面报告内容多轮追问；首页也支持自由问答 |
| 产品识图 | 上传 JPG / PNG 产品图，自动识别并回填左侧表单 |
| 场景图生成 | 白底 / 户外 / 家居 / 礼品场景图生成 |
| Word 导出 | 一键导出四章节诊断报告 `.docx` |
| 版本历史 | 四段首次直出即写入历史；每次改写或重算新增版本，最新版也在历史里，可回看、按版本导出 |
| 演示模式 | 未配置模型时使用内置示例数据，零配置也能跑完整流程 |

## 版本规则

- 四段报告首次直出时，内容会写入历史记录，作为第 1 版；历史里始终能找到最新版本。
- 市场洞察、上架文案、交叉质检支持改写或重算；每次产生新内容都会新增一个版本并写入历史（第 2 版、第 3 版……），当前最新版也在历史列表中。
- 合规体检为结构化结果，不支持整段改写，保持为第 1 版，但同样提供历史存档、查看与按版本导出。
- 每段最多保留 20 个版本（含最新版）；达到上限后需先删除历史存档再改写，删除存档不影响当前页内容。

## 快速启动

### 本地运行

```bash
cd SailCompass-web-4.9
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

打开 `http://127.0.0.1:8000`。也可以直接执行 `./run.sh` 一键启动；Windows 双击 `start-windows.bat`，macOS 双击 `start-mac.command`。脚本首次运行会自动创建 `.venv` 并安装依赖，默认源失败时自动改用清华镜像；端口优先使用 **8000**，被占用时自动顺延到 8001–8009，窗口里会打印实际地址。需要 **Python 3.10+（推荐 3.12；3.14 可运行，建议先实测）**；解压后约 1MB，首次安装依赖后约 130MB。

> Windows 启动脚本会自动挑一个可用端口（优先 8000）并打开对应地址；页面顶部版本徽标应为 **v4.9**，若不是新界面，说明打开的是旧项目或旧端口。可双击 `诊断.bat` 自查环境。

未配置模型时自动进入演示模式，页面右上角显示「演示模式」标记，全流程可直接体验。

### Docker

```bash
cp .env.example .env        # 按需填写模型信息
docker compose up -d --build
```

生成图目录挂载在 `./frontend/generated`，容器重建不丢图片。

## 接入模型

兼容任意 OpenAI 格式的 `/chat/completions` 接口，两种配置方式。

### 方式一：页面配置（推荐）

右下角「设置」填写文本模型、识图模型、生图模型：

| 字段 | 示例 |
| --- | --- |
| Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-...` |
| 模型名 | `deepseek-chat` |

配置只保存在浏览器 `localStorage`，请求时通过 `X-LLM-*` 请求头传给后端；后端不落盘、不写日志。换浏览器或清理缓存后需要重新填写。

### 方式二：环境变量

复制 `.env.example` 为 `.env`：

```bash
API_BASE_URL=https://api.deepseek.com/v1
API_KEY=sk-...
MODEL=deepseek-chat
VISION_BASE_URL=https://api.deepseek.com/v1
VISION_API_KEY=sk-...
VISION_MODEL=deepseek-flash
IMAGE_BASE_URL=https://open.bigmodel.cn/api/paas/v4
IMAGE_API_KEY=...
IMAGE_MODEL=cogview-3-flash
```

页面里保存的配置优先于 `.env`。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 工作台页面 |
| GET | `/api/health` | 健康检查与三类模型配置状态 |
| POST | `/api/parse-intent` | 一句话解析产品字段与意图 |
| POST | `/api/generate` | 创建生成任务，返回 `task_id` |
| GET | `/api/task/{task_id}` | 轮询任务状态与四段结果 |
| POST | `/api/chat` | 基于当前页面报告的追问 |
| POST | `/api/ask` | 首页自由问答 |
| POST | `/api/test-config` | 模型连通性测试 |
| POST | `/api/analyze-image` | 上传产品图识图 |
| POST | `/api/generate-image` | 生成场景图 |
| POST | `/api/revise` | 改写单段：旧内容进入历史，当前版本 +1 |
| POST | `/api/recheck-quality` | 重算交叉质检：旧内容进入历史，当前版本 +1 |
| GET | `/api/revisions/{task_id}/{section}` | 读取当前版本号、当前内容与历史旧版 |
| POST | `/api/revisions/{task_id}/{section}/delete` | 删除指定历史旧版（不影响当前版） |
| GET | `/api/export-docx/{task_id}` | 导出 Word 报告 |
| GET | `/api/export-pdf/{task_id}` | 导出 PDF 报告 |

生成请求体：

```json
{
  "product": "316 不锈钢保温杯",
  "selling_points": "24 小时保温、食品级内胆",
  "params": "500ml",
  "category": "户外用品",
  "platform": "Amazon 美国站",
  "languages": ["English", "Deutsch"]
}
```

请求头 `X-Force-Mode: demo` 可强制走演示模式；`X-LLM-Base-Url`、`X-LLM-Key`、`X-LLM-Model` 等用于传递页面配置。

## 目录结构

```
SailCompass-web-4.9/
  backend/
    requirements.txt
    app/
      main.py        应用入口、路由、静态资源挂载
      agents.py      四个 Agent、识图、追问
      intent.py      一句话解析路由
      export_docx.py Word 报告构建与导出路由
      image_gen.py   场景图生成
      llm_config.py  请求级模型配置与连通测试
      task_manager.py 内存任务表与追问历史
      config.py      路径与环境变量加载
      prompts/       提示词与演示问答数据
  frontend/
    index.html       页面结构
    *.css / *.js     样式、路由、渲染、设置、识图等模块
    vendor/          Tailwind 与 Markdown 渲染库
    demo_images/     演示场景图
    generated/       运行时生成的图片
  Dockerfile
  docker-compose.yml
  run.sh
  start-windows.bat
  start-share-windows.bat
  start-mac.command
  .env.example
```

## 上线前必须处理

1. **密钥管理**：`.env` 含明文密钥，不要提交到仓库；页面配置只存在用户浏览器。
2. **CORS**：当前允许所有来源，正式环境改成自己的域名。
3. **任务存储**：任务表与追问历史存进程内存，重启即清空；多实例部署时同一任务不跨实例共享。
4. **生成图**：场景图落在 `frontend/generated`，需要定期清理；Docker 部署已挂载该目录。
5. **并发与超时**：识图、生图为同步调用，耗时较长；放在反向代理后时请把读超时调大。
6. **合规声明**：报告由 AI 生成，规格、认证、法规与平台政策必须人工复核，不能直接作为终稿使用。

## Linux 中文字体

离线演示生图使用 Pillow 合成中文图片。Linux 部署请安装：

```bash
apt install -y fonts-noto-cjk
```

Windows 会优先使用 `C:/Windows/Fonts/msyh.ttc`。
