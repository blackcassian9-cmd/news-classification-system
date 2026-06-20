"""模型评价与可视化：指标卡片、性能对比、各类别F1、混淆矩阵、分类报告、结论、图表图片。"""
from __future__ import annotations

import os

from flask import Blueprint, send_from_directory

import config
from api import err, ok
from core import conclusions as concl_mod
from core import evaluate, services, viz
from db import database as db

bp = Blueprint("evaluation", __name__, url_prefix="/api/evaluation")


@bp.get("")
def evaluation():
    run = db.latest_run()
    prev = db.previous_run()
    if not run:
        return ok({"trained": False, "message": "尚未训练模型。"})

    results = run["results"]
    best = run["best_model"]
    bm = results[best]
    names = run["label_names"]
    pbest = prev["results"][prev["best_model"]] if prev else None

    def card(key, mode="points"):
        from api import stat_with_delta
        return stat_with_delta(bm[key], pbest[key] if pbest else None, mode=mode)

    metric_cards = {
        "accuracy": card("accuracy"), "precision": card("precision"),
        "recall": card("recall"), "f1": card("f1"),
        "macro_f1": card("macro_f1"),
        "auc": {"value": bm.get("auc")},
    }

    metrics = ["accuracy", "precision", "recall", "f1", "macro_f1"]
    comparison = {
        "metrics": ["Accuracy", "Precision", "Recall", "F1-score", "Macro-F1"],
        "nb": [round(results[config.MODEL_NB][m] * 100, 2) for m in metrics],
        "lr": [round(results[config.MODEL_LR][m] * 100, 2) for m in metrics],
    }

    pairs = evaluate.confusion_pairs(bm["confusion_matrix"], names)
    concl = services.ensure_llm_conclusions(run)
    bullets = concl.get("bullets") or concl_mod.training_conclusions(results, pairs)

    # 生成图表 PNG（带 run_id，避免缓存串图）
    rid = run["id"]
    charts = _ensure_charts(run, rid)

    return ok({
        "trained": True,
        "metric_cards": metric_cards,
        "comparison": comparison,
        "f1_per_class": bm["per_class"],
        "confusion": {
            "nb": results[config.MODEL_NB]["confusion_matrix"],
            "lr": results[config.MODEL_LR]["confusion_matrix"],
            "labels": names,
        },
        "classification_report": bm["per_class"],
        "support_total": bm["support_total"],
        "confusion_pairs": pairs,
        "conclusions": bullets,
        "charts": charts,
        "best_model": best, "best_model_name": config.MODEL_DISPLAY[best],
        "train_distribution": (run.get("feature_stats") or {}).get("train_distribution", []),
        "test_distribution": (run.get("feature_stats") or {}).get("test_distribution", []),
    })


def _ensure_charts(run, rid):
    results = run["results"]
    names = run["label_names"]
    best = run["best_model"]
    files = {
        "comparison": f"perf_{rid}.png",
        "f1": f"f1_{rid}.png",
        "confusion_nb": f"cm_nb_{rid}.png",
        "confusion_lr": f"cm_lr_{rid}.png",
        "category": f"cat_{rid}.png",
    }
    # 仅在不存在时生成
    if not os.path.exists(os.path.join(config.CHARTS_DIR, files["comparison"])):
        viz.perf_comparison_png(results, files["comparison"])
        viz.per_class_f1_png(results[best]["per_class"], files["f1"])
        viz.confusion_matrix_png(results[config.MODEL_NB]["confusion_matrix"], names, "朴素贝叶斯", files["confusion_nb"])
        viz.confusion_matrix_png(results[config.MODEL_LR]["confusion_matrix"], names, "逻辑回归", files["confusion_lr"])
        dist = (run.get("feature_stats") or {}).get("train_distribution", [])
        if dist:
            viz.category_distribution_png(dist, files["category"], "训练集类别分布")
    return {k: f"/api/evaluation/charts/{v}" for k, v in files.items()}


@bp.get("/charts/<path:filename>")
def chart_file(filename):
    path = os.path.join(config.CHARTS_DIR, filename)
    if not os.path.exists(path):
        return err("图表不存在或尚未生成，请先完成训练。", 404)
    return send_from_directory(config.CHARTS_DIR, filename)
