"""API 蓝图注册与共享工具。"""
from __future__ import annotations

from typing import Optional

from flask import Flask, jsonify, request


def get_payload() -> dict:
    return request.get_json(silent=True) or {}


def ok(data=None, **extra):
    body = {"ok": True}
    if data is not None:
        body["data"] = data
    body.update(extra)
    return jsonify(body)


def err(message: str, code: int = 400):
    return jsonify({"ok": False, "error": message}), code


def stat_with_delta(value, prev=None, *, mode: str = "relative", unit: str = "") -> dict:
    """构造带'较上次'的统计卡片数据；prev 为空时 delta=None（首次不显示）。

    mode:
      relative —— 相对变化百分比（用于计数类，如训练集样本数 +2.35%）；
      points   —— 百分点差（用于比率指标，如 Accuracy 0.9104 vs 0.9036 → +0.68%）；
      abs      —— 绝对差（用于耗时等，如 -0.12s）。
    """
    card = {"value": value, "delta": None}
    if prev is None:
        return card
    diff = value - prev
    if mode == "points":
        text = f"{'+' if diff >= 0 else ''}{round(diff * 100, 2)}%"
    elif mode == "abs":
        text = f"{'+' if diff >= 0 else ''}{round(diff, 4)}{unit}"
    else:  # relative
        pct = (diff / prev * 100) if prev else 0.0
        text = f"{'+' if diff >= 0 else ''}{round(pct, 2)}%"
    card["delta"] = {"diff": round(diff, 4), "text": text, "up": diff >= 0}
    return card


def register_blueprints(app: Flask) -> None:
    from api.overview import bp as overview_bp
    from api.datasets import bp as datasets_bp
    from api.preview import bp as preview_bp
    from api.features_api import bp as features_bp
    from api.training import bp as training_bp
    from api.evaluation import bp as evaluation_bp
    from api.prediction import bp as prediction_bp
    from api.errors_api import bp as errors_bp
    from api.experiments import bp as experiments_bp
    from api.optimization import bp as optimization_bp
    from api.reports import bp as reports_bp

    for bp in (overview_bp, datasets_bp, preview_bp, features_bp, training_bp,
               evaluation_bp, prediction_bp, errors_bp, experiments_bp,
               optimization_bp, reports_bp):
        app.register_blueprint(bp)
