"""系统级接口：通知中心（供顶部铃铛使用）。

通知来源是真实的系统事件（events 表）：数据集导入、训练完成、可视化生成、
报告可导出、参数优化、用户登录等，按时间倒序返回。未读判断放在前端
（用 localStorage 记录上次查看时间），后端只负责提供真实事件流。
"""
from __future__ import annotations

from flask import Blueprint

from api import ok
from core import services
from db import database as db

bp = Blueprint("system", __name__, url_prefix="/api/system")

_KIND_LABEL = {
    "dataset_loaded": "数据集",
    "trained": "模型训练",
    "visualized": "可视化",
    "report_ready": "报告",
    "log": "系统",
}
_KIND_ICON = {
    "dataset_loaded": "i-db",
    "trained": "i-brain",
    "visualized": "i-chart",
    "report_ready": "i-file",
    "log": "i-bell",
}


@bp.get("/notifications")
def notifications():
    events = db.recent_events(20)
    items = [{
        "ts": e["ts"],
        "kind": e["kind"],
        "label": _KIND_LABEL.get(e["kind"], "系统"),
        "icon": _KIND_ICON.get(e["kind"], "i-bell"),
        "message": e["message"],
    } for e in events]
    return ok({
        "items": items,
        "total": len(items),
        "trained": services.has_trained_model(),
    })
