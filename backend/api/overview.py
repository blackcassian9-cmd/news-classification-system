"""首页总览：统计卡片、性能对比、类别分布、最优参数、运行状态时间线、提示语。"""
from __future__ import annotations

from flask import Blueprint

import config
from api import ok, stat_with_delta
from core import services
from db import database as db

bp = Blueprint("overview", __name__, url_prefix="/api/overview")

_STATUS_LABELS = {
    "dataset_loaded": "数据集已加载",
    "trained": "模型训练完成",
    "visualized": "可视化已生成",
    "report_ready": "报告可导出",
}


@bp.get("")
def overview():
    latest = db.latest_run()
    prev = db.previous_run()

    if not latest:
        return ok({
            "trained": False,
            "datasets": db.count_datasets(),
            "status_timeline": _timeline(),
            "message": "尚未训练模型。请先在『数据集管理』确认数据，再到『模型训练』开始训练。",
        })

    results = latest["results"]
    best = latest["best_model"]
    best_metrics = results[best]
    prev_best = prev["results"][prev["best_model"]] if prev else None

    stat_cards = {
        "train_count": stat_with_delta(latest["train_count"],
                                       prev["train_count"] if prev else None, mode="relative"),
        "test_count": stat_with_delta(latest["test_count"],
                                      prev["test_count"] if prev else None, mode="relative"),
        "num_classes": stat_with_delta(latest["num_classes"],
                                       prev["num_classes"] if prev else None, mode="abs"),
        "best_model": {"value": config.MODEL_DISPLAY[best], "updated": latest["created_at"]},
        "accuracy": stat_with_delta(best_metrics["accuracy"],
                                    prev_best["accuracy"] if prev_best else None, mode="points"),
        "macro_f1": stat_with_delta(best_metrics["macro_f1"],
                                    prev_best["macro_f1"] if prev_best else None, mode="points"),
    }

    metrics = ["accuracy", "precision", "recall", "f1", "macro_f1"]
    perf = {
        "metrics": ["Accuracy", "Precision", "Recall", "F1-score", "Macro-F1"],
        "nb": [round(results[config.MODEL_NB][m] * 100, 2) for m in metrics],
        "lr": [round(results[config.MODEL_LR][m] * 100, 2) for m in metrics],
    }

    fs = latest.get("feature_stats") or {}
    concl = services.ensure_llm_conclusions(latest)

    return ok({
        "trained": True,
        "stat_cards": stat_cards,
        "perf_comparison": perf,
        "category_distribution": fs.get("train_distribution", []),
        "f1_per_class": best_metrics["per_class"],
        "confusion_matrix": best_metrics["confusion_matrix"],
        "best_params": {
            "tfidf": latest.get("tfidf_params"),
            "nb": latest.get("nb_params"),
            "lr": latest.get("lr_params"),
            "random_state": config.DEFAULT_RANDOM_STATE,
        },
        "tip": concl.get("tip"),
        "conclusions": concl.get("bullets"),
        "status_timeline": _timeline(),
        "run_id": latest["id"],
        "created_at": latest["created_at"],
    })


def _timeline():
    out = []
    for kind, label in _STATUS_LABELS.items():
        ev = db.latest_event(kind)
        out.append({"kind": kind, "label": label,
                    "time": ev["ts"] if ev else None,
                    "done": ev is not None})
    return out
