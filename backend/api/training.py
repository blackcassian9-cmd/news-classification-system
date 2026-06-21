"""模型训练：配置、执行训练（两模型对比）、结果汇总、当前结论。"""
from __future__ import annotations

from flask import Blueprint

import config
from api import err, get_payload, ok
from core import evaluate, services
from db import database as db

bp = Blueprint("training", __name__, url_prefix="/api/training")

_MODEL_DESC = {
    config.MODEL_NB: "基于特征条件独立假设的生成模型，对高维稀疏文本效果表现良好。",
    config.MODEL_LR: "线性分类器，具备概率输出能力，在文本分类中表现稳定可靠。",
}


@bp.get("/config")
def get_config():
    train_p = services._default_train_path()
    test_p = services._default_test_path()
    return ok({
        "models": [
            {"key": config.MODEL_NB, "name": "多项式朴素贝叶斯", "desc": _MODEL_DESC[config.MODEL_NB], "selected": True},
            {"key": config.MODEL_LR, "name": "逻辑回归", "desc": _MODEL_DESC[config.MODEL_LR], "selected": True},
        ],
        "candidate_models": 2,
        "training_settings": {
            "split": "分层抽样", "val_ratio": config.DEFAULT_VAL_RATIO,
            "random_state": config.DEFAULT_RANDOM_STATE,
            "metric": "Macro-F1", "save_best": True,
        },
        "nb_params": config.DEFAULT_NB,
        "lr_params": config.DEFAULT_LR,
        "has_train": bool(train_p), "has_test": bool(test_p),
    })


@bp.post("/run")
def run():
    from api.auth import current_user
    if not current_user():
        return err("请先登录后再训练模型", 401)
    p = get_payload()
    train_p = services._default_train_path()
    test_p = services._default_test_path()
    if not train_p or not test_p:
        return err("缺少训练集或测试集，请先在『数据集管理』上传 train.txt 与 test.txt")

    summary = services.train_and_store(
        train_p, test_p,
        tfidf_params=p.get("tfidf_params"), nb_params=p.get("nb_params"),
        lr_params=p.get("lr_params"), clean_rules=p.get("clean_rules"))

    return ok(_build_result(summary))


@bp.get("/result")
def result():
    run = db.latest_run()
    if not run:
        return ok({"trained": False})
    extra = run.get("extra") or {}
    # 复原成与 /run 一致的结构
    summary = {
        "val_results": run.get("val_results"),
        "val_conclusions": extra.get("val_conclusions"),
        "results": run["results"], "best_model": run["best_model"],
        "best_model_name": config.MODEL_DISPLAY[run["best_model"]],
        "train_count": run["train_count"], "test_count": run["test_count"],
        "val_count": extra.get("val_count"), "split_method": extra.get("split_method"),
        "num_classes": run["num_classes"], "tfidf_params": run["tfidf_params"],
        "nb_params": run["nb_params"], "lr_params": run["lr_params"],
        "conclusions": run["conclusions"], "elapsed_seconds": run["elapsed"],
        "feature_stats": run["feature_stats"], "label_names": run["label_names"],
    }
    out = _build_result(summary)
    out["trained"] = True
    return ok(out)


def _build_result(summary):
    # 模型训练页展示「验证集」指标（与页面"训练结果对比（验证集）"一致）；
    # 没有验证集结果时（兼容旧数据）回退到测试集结果。
    results = summary.get("val_results") or summary["results"]
    nb, lr = results[config.MODEL_NB], results[config.MODEL_LR]
    best = summary["best_model"]

    metrics = [("Accuracy", "accuracy"), ("Precision", "precision"),
               ("Recall", "recall"), ("F1-score", "f1"), ("Macro-F1", "macro_f1")]
    table = []
    for label, key in metrics:
        diff = lr[key] - nb[key]
        table.append({"metric": label, "nb": round(nb[key], 4), "lr": round(lr[key], 4),
                      "improve": f"{'+' if diff >= 0 else ''}{round(diff*100, 2)}%",
                      "improve_up": diff >= 0})
    table.append({"metric": "训练时间", "nb": f"{nb.get('train_seconds', 0)}s",
                  "lr": f"{lr.get('train_seconds', 0)}s",
                  "improve": f"+{round(lr.get('train_seconds',0)-nb.get('train_seconds',0),3)}s",
                  "improve_up": False})

    concl = summary.get("val_conclusions") or summary.get("conclusions") or {}

    # 「较上次」：仅当存在上一次训练（即第 2 次起）才给出，首次为 None → 前端不显示
    prev = db.previous_run()
    deltas = None
    if prev:
        def _di(cur, old):
            d = (cur or 0) - (old or 0)
            return ("无变化" if d == 0 else (("+" if d > 0 else "") + f"{d:,}"))
        prev_best = config.MODEL_DISPLAY.get(prev.get("best_model"), "")
        deltas = {
            "train_count": _di(summary["train_count"], prev.get("train_count")),
            "test_count": _di(summary["test_count"], prev.get("test_count")),
            "random_state": "无变化",
            "candidate_models": "无变化",
            "rounds": "+1 轮",
            "best_model": "无变化" if prev_best == summary["best_model_name"] else f"{prev_best} → {summary['best_model_name']}",
        }

    return {
        "stat_cards": {
            "train_count": summary["train_count"], "test_count": summary["test_count"],
            "val_count": summary.get("val_count"),
            "random_state": config.DEFAULT_RANDOM_STATE, "candidate_models": 2,
            "split_method": summary.get("split_method", "分层抽样"),
            "rounds": "2 / 2", "best_model": summary["best_model_name"],
            "deltas": deltas,
        },
        "results": {"nb": nb, "lr": lr},
        "best_model": best, "best_model_name": summary["best_model_name"],
        "param_details": {
            "nb": summary.get("nb_params", config.DEFAULT_NB),
            "lr": summary.get("lr_params", config.DEFAULT_LR),
        },
        "result_table": table,
        "monitor": {
            "status": "completed",
            "timings": {"nb": nb.get("train_seconds", 0), "lr": lr.get("train_seconds", 0)},
            "macro_f1": {"nb": nb["macro_f1"], "lr": lr["macro_f1"]},
            "steps": ["数据准备", "特征输入", "模型训练", "性能评估", "模型保存"],
        },
        "conclusions": concl.get("bullets", []),
        "recommend": concl.get("recommend"),
        "elapsed": summary.get("elapsed_seconds"),
        "logs": [
            {"ok": True, "msg": "TF-IDF 特征已加载"},
            {"ok": True, "msg": f"朴素贝叶斯训练完成（用时 {nb.get('train_seconds',0)}s）"},
            {"ok": True, "msg": f"逻辑回归训练完成（用时 {lr.get('train_seconds',0)}s）"},
            {"ok": True, "msg": f"最优模型已保存：{summary['best_model_name']}（Macro-F1={results[best]['macro_f1']:.4f}）"},
        ],
    }
