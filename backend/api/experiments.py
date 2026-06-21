"""实验记录与模型管理：实验列表、统计卡片、模型版本、最近任务、新建实验。

注意：模型类型只允许"朴素贝叶斯 / 逻辑回归"，不接受深度学习/XGBoost 等。
"""
from __future__ import annotations

import os

from flask import Blueprint, request

import config
from api import err, get_payload, ok
from db import database as db

bp = Blueprint("experiments", __name__, url_prefix="/api/experiments")

ALLOWED_MODELS = {"朴素贝叶斯", "逻辑回归"}


def _uid():
    """当前登录用户 id；未登录返回 None。实验/模型一律按用户隔离。"""
    from api.auth import current_user
    u = current_user()
    return u["id"] if u else None


def _storage_mb(uid=None):
    """只统计当前用户专属模型目录 storage/models/u<uid>/ 的占用。"""
    uid = uid if uid is not None else _uid()
    if not uid:
        return 0.0
    base = os.path.join(config.MODELS_DIR, f"u{uid}")
    total = 0
    for root, _, files in os.walk(base):
        for fn in files:
            total += os.path.getsize(os.path.join(root, fn))
    return round(total / 1024 / 1024, 2)


@bp.get("")
def list_experiments():
    exps = db.list_experiments()
    runs = db.list_runs()
    completed = [e for e in exps if e["status"] == "已完成"]
    best_acc = max([e["accuracy"] for e in exps if e["accuracy"]], default=None)

    # 模型版本：每次训练run = 一个版本
    versions = []
    for i, r in enumerate(runs):
        bm = r["best_model"]
        acc = r["results"][bm]["accuracy"] if r.get("results") else None
        versions.append({
            "version": f"v{len(runs) - i}",
            "file": f"model_{bm}_run{r['id']}.joblib",
            "model_name": config.MODEL_DISPLAY.get(bm, bm),
            "accuracy": acc, "created_at": r["created_at"],
            "description": f"TF-IDF + {config.MODEL_DISPLAY.get(bm, bm)}",
        })

    rows = [{
        "id": e["id"], "name": e["name"], "model_type": e["model_type"],
        "dataset": e["dataset"], "accuracy": e["accuracy"], "f1": e["f1"],
        "macro_f1": e["macro_f1"], "status": e["status"],
        "created_at": e["created_at"], "description": e["description"],
    } for e in exps]

    return ok({
        "stat_cards": {
            "total": len(exps),
            "completed": len(completed),
            "completed_rate": round(len(completed) / len(exps) * 100, 1) if exps else 0,
            "models_trained": len(runs),
            "best_accuracy": best_acc,
            "deployed": 1 if runs else 0,
            "storage_mb": _storage_mb(),
        },
        "list": rows,
        "versions": versions,
        "recent_tasks": [
            {"name": e["name"], "status": e["status"],
             "progress": 100 if e["status"] == "已完成" else (0 if e["status"] == "失败" else 60)}
            for e in exps[:4]
        ],
        "selected": rows[0] if rows else None,
        "allowed_models": sorted(ALLOWED_MODELS),
        "current_dataset": db.get_selected_dataset(),
        "trained": bool(runs),
        "server_time": db.now_str(),
    })


@bp.get("/<int:exp_id>")
def detail(exp_id):
    for e in db.list_experiments(1000):
        if e["id"] == exp_id:
            return ok(e)
    return err("实验不存在", 404)


@bp.post("")
def create():
    p = get_payload()
    model_type = p.get("model_type", "")
    if model_type and model_type not in ALLOWED_MODELS:
        return err(f"模型类型仅支持：{'、'.join(sorted(ALLOWED_MODELS))}（本系统不含深度学习/集成模型）")
    exp_id = db.insert_experiment({
        "name": p.get("name", "未命名实验"),
        "model_type": model_type or "逻辑回归",
        "dataset": p.get("dataset", "当前数据集"),
        "accuracy": p.get("accuracy"), "f1": p.get("f1"), "macro_f1": p.get("macro_f1"),
        "status": p.get("status", "已完成"),
        "description": p.get("description", ""),
        "params": p.get("params"),
    })
    return ok({"id": exp_id})
