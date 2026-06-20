"""错误样本与关键词解释：错分样本列表、易混淆类别对、错误原因分布、类别关键词。"""
from __future__ import annotations

from flask import Blueprint, request

from api import ok
from core import error_analysis

bp = Blueprint("errors", __name__, url_prefix="/api/errors")


@bp.get("")
def errors():
    data = error_analysis.analyze()
    if not data:
        return ok({"trained": False, "message": "尚未训练模型，无法分析错误样本。"})

    # 过滤
    q = request.args.get("q", "").strip()
    f_true = request.args.get("true", "")
    f_pred = request.args.get("pred", "")
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, int(request.args.get("page_size", 10)))

    rows = data["errors"]
    if q:
        rows = [r for r in rows if q in r["text"]]
    if f_true:
        rows = [r for r in rows if r["true_name"] == f_true]
    if f_pred:
        rows = [r for r in rows if r["pred_name"] == f_pred]

    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start:start + page_size]

    return ok({
        "trained": True,
        "summary": data["summary"],
        "errors": page_rows,
        "total": total, "page": page, "page_size": page_size,
        "confusion_pairs": data["confusion_pairs"],
        "reasons": data["reasons"],
        "keyword_cards": data["keyword_cards"],
        "model_name": data["model_name"],
    })


@bp.post("/report")
def report():
    data = error_analysis.analyze()
    if not data:
        return ok({"ok": False, "message": "尚未训练模型。"})
    return ok({"generated": True, "summary": data["summary"]})
