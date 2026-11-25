"""出海罗盘 · 内存任务表（不落盘、不上数据库，服务重启即清空）"""
import time
from typing import Optional
from uuid import uuid4

# 模块级任务表：task_id -> 任务 dict
TASKS: dict[str, dict] = {}

# 任务上限：超过后清理最老的，防止内存无限增长
MAX_TASKS = 100

# 追问对话历史：key = "task_id:tab" -> messages 列表（每个组合最多保留最近 10 轮）
CHAT_HISTORY: dict[str, list] = {}
MAX_CHAT_ROUNDS = 10

# 改写历史版本：每段最多保留 20 个旧版本（超出需先删除再改写）
MAX_REVISIONS = 20


def set_current_version(task_id: str, section: str, version: int) -> None:
    """登记某段当前版本号；直出完成时记 1，之后每次产生新内容递增"""
    task = TASKS.get(task_id)
    if task is None:
        return
    task.setdefault("current_versions", {})[section] = max(int(version), 1)


def get_current_version(task_id: str, section: str) -> int:
    """读取当前版本号：未登记时回退为历史最大版本 + 1，历史为空则为 1（直出即第 1 版）"""
    task = TASKS.get(task_id) or {}
    recorded = (task.get("current_versions") or {}).get(section)
    if recorded:
        return max(int(recorded), 1)
    history = get_revisions(task_id, section)
    return max((item.get("version", 0) for item in history), default=0) + 1


def create_task() -> str:
    """新建任务并返回 task_id；每次新建时顺手清理超限旧任务"""
    task_id = uuid4().hex
    TASKS[task_id] = {
        "status": "running",
        "stage": "",
        "progress": 0,
        "result": {},
        "revisions": {},
        "current_versions": {},
        "section_times": {},
        "error": "",
        "created": time.time(),
    }
    cleanup()
    return task_id


def get_task(task_id: str) -> Optional[dict]:
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


def add_revision(task_id: str, section: str, content: str, instruction: str = "", time_value: Optional[float] = None, version: Optional[int] = None) -> Optional[int]:
    """把一次更新前的旧内容存为历史版本，返回版本号；version 缺省时按历史最大版本 + 1"""
    task = TASKS.get(task_id)
    if task is None or not content:
        return None
    history = task.setdefault("revisions", {}).setdefault(section, [])
    for item in history:
        if version is not None and item.get("version") == version:
            return version
    if version is None:
        version = max((item.get("version", 0) for item in history), default=0) + 1
    history.append({
        "version": int(version),
        "content": content,
        "instruction": instruction,
        "time": time_value or time.time(),
    })
    return int(version)


def set_section_time(task_id: str, section: str, time_value: Optional[float] = None) -> None:
    """记录某段当前内容的生成时间（用于版本时间对齐）"""
    task = TASKS.get(task_id)
    if task is None:
        return
    task.setdefault("section_times", {})[section] = time_value or time.time()


def get_section_time(task_id: str, section: str) -> Optional[float]:
    """读取某段当前内容的生成时间"""
    task = TASKS.get(task_id) or {}
    return (task.get("section_times") or {}).get(section)


def get_revisions(task_id: str, section: str) -> list:
    """读取某段的历史版本（旧版在前，按版本号升序）"""
    task = TASKS.get(task_id) or {}
    return sorted((task.get("revisions") or {}).get(section, []), key=lambda item: item.get("version", 0))


def delete_revisions(task_id: str, section: str, versions: list) -> int:
    """删除某段指定版本，返回实际删除数量"""
    task = TASKS.get(task_id)
    if task is None:
        return 0
    history = (task.get("revisions") or {}).get(section, [])
    wanted = set(int(v) for v in versions)
    kept = [item for item in history if item.get("version") not in wanted]
    removed = len(history) - len(kept)
    task.setdefault("revisions", {})[section] = kept
    return removed


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