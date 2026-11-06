"""出海罗盘 · 内存任务表（不落盘、不上数据库，服务重启即清空）"""
import time
from uuid import uuid4

# 模块级任务表：task_id -> 任务 dict
TASKS: dict[str, dict] = {}

# 任务上限：超过后清理最老的，防止内存无限增长
MAX_TASKS = 100

# 追问对话历史：key = "task_id:tab" -> messages 列表（每个组合最多保留最近 10 轮）
CHAT_HISTORY: dict[str, list] = {}
MAX_CHAT_ROUNDS = 10


def create_task() -> str:
    """新建任务并返回 task_id；每次新建时顺手清理超限旧任务"""
    task_id = uuid4().hex
    TASKS[task_id] = {
        "status": "running",
        "stage": "",
        "progress": 0,
        "result": {},
        "error": "",
        "created": time.time(),
    }
    cleanup()
    return task_id


def get_task(task_id: str) -> dict | None:
    """读取任务；不存在返回 None（路由层负责转 404）"""
    return TASKS.get(task_id)


def update_task(task_id: str, **kwargs) -> None:
    """更新任务字段；任务不存在时直接返回（只可能是已被 cleanup 清掉）"""
    task = TASKS.get(task_id)
    if task is not None:
        task.update(kwargs)


def append_result(task_id: str, **kwargs) -> None:
    """向任务 result 合并字段（四段流水线累积结果，失败时已完成段保留）"""
    task = TASKS.get(task_id)
    if task is not None:
        task["result"].update(kwargs)


def get_chat_history(task_id: str, tab: str) -> list:
    """读取某任务某页的追问历史（多轮上下文用）"""
    return CHAT_HISTORY.get(task_id + ":" + tab, [])


def append_chat(task_id: str, tab: str, question: str, answer: str) -> None:
    """追加一轮问答并裁剪到最近 10 轮（20 条消息）"""
    msgs = CHAT_HISTORY.setdefault(task_id + ":" + tab, [])
    msgs.append({"role": "user", "content": question})
    msgs.append({"role": "assistant", "content": answer})
    overflow = len(msgs) - MAX_CHAT_ROUNDS * 2
    if overflow > 0:
        del msgs[:overflow]


def cleanup() -> None:
    """任务数超过上限时，按创建时间删掉最老的（含其追问历史）"""
    if len(TASKS) <= MAX_TASKS:
        return
    overflow = len(TASKS) - MAX_TASKS
    oldest = sorted(TASKS.items(), key=lambda item: item[1]["created"])[:overflow]
    for task_id, _ in oldest:
        del TASKS[task_id]
        # 该任务的追问历史一并清掉
        for key in [k for k in CHAT_HISTORY if k.startswith(task_id + ":")]:
            del CHAT_HISTORY[key]