"""出海罗盘 · 内存任务表（不落盘、不上数据库，服务重启即清空）"""
import time
from uuid import uuid4

# 模块级任务表：task_id -> 任务 dict
TASKS: dict[str, dict] = {}

# 任务上限：超过后清理最老的，防止内存无限增长
MAX_TASKS = 100


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


def cleanup() -> None:
    """任务数超过上限时，按创建时间删掉最老的"""
    if len(TASKS) <= MAX_TASKS:
        return
    overflow = len(TASKS) - MAX_TASKS
    oldest = sorted(TASKS.items(), key=lambda item: item[1]["created"])[:overflow]
    for task_id, _ in oldest:
        del TASKS[task_id]