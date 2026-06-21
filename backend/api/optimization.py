"""深度学习参数优化：配置、运行、结果（候选排行榜、最优参数、参数重要性）。

目标：用神经网络代理模型，为两个传统模型（朴素贝叶斯 / 逻辑回归）搜索最优超参，
而不是把深度学习当作预测模型。完整搜索逻辑见 core/optimizer（后续步骤接入）。
"""
from __future__ import annotations

from flask import Blueprint

from api import err, get_payload, ok
from core import optimizer
from db import database as db

bp = Blueprint("optimization", __name__, url_prefix="/api/optimization")


@bp.get("/config")
def get_config():
    return ok({"config": optimizer.DEFAULT_OPT_CONFIG, "param_help": optimizer.PARAM_HELP,
               "note": "深度学习仅用于为朴素贝叶斯/逻辑回归搜索最优参数，预测模型仍只有这两个。"})


@bp.get("/result")
def result():
    latest = db.latest_optimization()
    if not latest:
        return ok({"has_result": False, "message": "尚未运行参数优化。点击『开始优化』即可为两个模型搜索最优参数。"})
    return ok({"has_result": True, "stat_cards": _stat_cards(latest), **latest})


@bp.post("/run")
def run():
    from api.auth import current_user
    if not current_user():
        return err("请先登录后再进行参数优化", 401)
    p = get_payload()
    try:
        res = optimizer.run_optimization(p.get("config"))
    except RuntimeError as e:
        return err(str(e), 409)
    res["id"] = db.insert_optimization(res)
    db.add_event("log", f"参数优化完成：最优 {res.get('best_model_name')}（{res.get('objective')}={res.get('best_score')}）")
    return ok({"stat_cards": _stat_cards(res), **res})


def _stat_cards(res: dict) -> dict:
    rounds = res.get("rounds_done") or (res.get("config") or {}).get("rounds")
    return {
        "experiments": len(db.list_optimizations(1000)),
        "random_state": (res.get("config") or {}).get("random_state", 617),
        "candidate_count": res.get("candidate_count") or res.get("n_evaluations"),
        "rounds": f"{rounds} / {rounds}" if rounds else None,
        "best_score": res.get("best_score"),
        "best_model_name": res.get("best_model_name"),
        "baseline": res.get("baseline"),
        "improvement": res.get("improvement"),
    }
