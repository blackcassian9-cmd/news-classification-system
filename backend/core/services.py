"""服务层：把流水线 + 持久化 + 结论 串起来，供 API 直接调用。

包含：训练并入库、加载模型产物（带缓存）、单条预测、批量预测、
关键词解释、"较上次"增量计算。
"""
from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

import numpy as np

import config
from core import conclusions, data_loader, evaluate, pipeline, preprocess
from db import database as db

# 模型产物缓存：按用户隔离（键为 user_id），训练完成后失效重载
_ARTIFACTS: Dict[Optional[int], Optional[Dict]] = {}


def _model_tag(uid: Optional[int]) -> Optional[str]:
    """每个用户的模型产物独立目录：storage/models/u<uid>/。未登录无产物。"""
    return f"u{uid}" if uid else None


def invalidate_cache(user_id: Optional[int] = None) -> None:
    """失效产物缓存。默认清空全部（登录/退出切换账号用）；传 user_id 只清该用户。"""
    global _ARTIFACTS
    if user_id is None:
        _ARTIFACTS = {}
    else:
        _ARTIFACTS.pop(user_id, None)


def _maybe_llm_conclusions(concl: Dict, summary: Dict) -> Dict:
    """若用户配置了 DeepSeek Key，则用大模型润色结论；否则原样返回规则化结论。"""
    try:
        from core import llm
        return llm.enhance_conclusions(concl, summary)
    except Exception:
        return concl


def ensure_llm_conclusions(run: Dict) -> Dict:
    """页面读取时按需用大模型润色结论：仅在配置了 Key 且尚未润色时调用一次，并回写缓存。

    这样即便用户在训练后才填 Key，首页/评价页也能自动换成大模型结论（只调一次 API）。
    """
    concl = run.get("conclusions") or {}
    try:
        from core import llm
        if not llm.available() or concl.get("source") == "deepseek":
            return concl
        summary = {
            "results": run.get("results"), "best_model": run.get("best_model"),
            "best_model_name": config.MODEL_DISPLAY.get(run.get("best_model")),
            "label_names": run.get("label_names"), "num_classes": run.get("num_classes"),
        }
        enhanced = llm.enhance_conclusions(concl, summary)
        if enhanced.get("source") == "deepseek" and run.get("id"):
            db.update_run_conclusions(run["id"], enhanced)
        return enhanced
    except Exception:  # noqa: BLE001
        return concl


def get_artifacts() -> Optional[Dict]:
    """加载「当前登录用户」的模型产物（带按用户缓存）。未登录返回 None → 空白态。"""
    uid = db.get_active_uid()
    if not uid:
        return None
    if uid not in _ARTIFACTS:
        _ARTIFACTS[uid] = pipeline.load_artifacts(_model_tag(uid))
    return _ARTIFACTS[uid]


def has_trained_model() -> bool:
    # 必须既有磁盘模型产物、又有数据库训练记录，才算"已加载"。
    # 二者都按当前用户隔离：未登录 / 他人模型一律视为空白态。
    return db.latest_run() is not None and get_artifacts() is not None


# -------------------- 训练 --------------------
def train_and_store(train_path: str, test_path: str, *,
                    tfidf_params: Dict = None, nb_params: Dict = None,
                    lr_params: Dict = None, clean_rules: Dict = None,
                    label_names: List[str] = None, delimiter: str = "\t",
                    use_optimized: bool = True) -> Dict:
    # 按用户隔离：训练产物落在该用户专属目录，未登录禁止训练
    uid = db.get_active_uid()
    if not uid:
        raise RuntimeError("请先登录后再训练模型。")
    tag = _model_tag(uid)

    # 自动采用「深度学习参数优化」搜出的最佳参数（若用户未显式传参且优化过）
    opt_used = None
    if use_optimized and not any([tfidf_params, nb_params, lr_params]):
        latest_opt = db.latest_optimization(uid)
        if latest_opt and latest_opt.get("best_params"):
            bp = latest_opt["best_params"]
            tfidf_params = bp.get("tfidf") or None
            nb_params = bp.get("nb") or None
            lr_params = bp.get("lr") or None
            opt_used = latest_opt.get("id")

    db.add_event("log", "TF-IDF 特征提取开始")
    summary = pipeline.run_pipeline(
        train_path, test_path, tfidf_params=tfidf_params, nb_params=nb_params,
        lr_params=lr_params, clean_rules=clean_rules, label_names=label_names,
        delimiter=delimiter, save=True, model_tag=tag)
    summary["nb_params"] = {**config.DEFAULT_NB, **(nb_params or {})}
    summary["lr_params"] = {**config.DEFAULT_LR, **(lr_params or {})}
    summary["clean_rules"] = clean_rules or preprocess.DEFAULT_RULES
    summary["optimized_params_used"] = opt_used

    # 结论（规则化兜底；若配置了 DeepSeek，由 llm 模块润色）
    # —— 总览/评价页用「测试集」结论；模型训练页用「验证集」结论，保证同页数字一致
    best_test = summary["results"][summary["best_model"]]
    pairs = evaluate.confusion_pairs(best_test["confusion_matrix"], summary["label_names"])
    concl = {
        "tip": conclusions.dashboard_tip(summary["results"]),
        "bullets": conclusions.training_conclusions(summary["results"], pairs),
        "recommend": conclusions.recommend_deploy(summary["results"]),
        "source": "rule",
    }
    val_res = summary.get("val_results") or summary["results"]
    summary["val_conclusions"] = {
        "bullets": conclusions.training_conclusions(val_res),
        "recommend": conclusions.recommend_deploy(val_res),
        "source": "rule",
    }

    concl = _maybe_llm_conclusions(concl, summary)
    run_id = db.insert_run(summary, conclusions=concl, user_id=uid)
    summary["run_id"] = run_id
    summary["conclusions"] = concl

    # 事件时间线
    db.add_event("trained", f"模型训练完成：最优 {summary['best_model_name']}（Macro-F1={best_test['macro_f1']:.4f}）")
    db.add_event("visualized", "可视化已生成")
    db.add_event("report_ready", "报告可导出")

    # 为两个模型各记一条实验
    for key in (config.MODEL_NB, config.MODEL_LR):
        m = summary["results"][key]
        db.insert_experiment({
            "name": f"{config.MODEL_DISPLAY[key]}_run{run_id}",
            "model_type": config.MODEL_DISPLAY[key],
            "dataset": "当前数据集",
            "accuracy": m["accuracy"], "f1": m["f1"], "macro_f1": m["macro_f1"],
            "status": "已完成", "run_id": run_id,
            "description": f"TF-IDF + {config.MODEL_DISPLAY[key]}，测试集 Macro-F1={m['macro_f1']:.4f}",
            "params": summary["tfidf_params"],
        }, user_id=uid)

    invalidate_cache(uid)
    return summary


# -------------------- 预测 --------------------
def _topk(probs: np.ndarray, names: List[str], k: int = 3) -> List[Dict]:
    idx = np.argsort(probs)[::-1][:k]
    return [{"label": int(i), "name": names[i], "prob": round(float(probs[i]), 4)} for i in idx]


def _full_distribution(probs: np.ndarray, names: List[str]) -> List[Dict]:
    order = np.argsort(probs)[::-1]
    return [{"label": int(i), "name": names[i], "prob": round(float(probs[i]), 4)} for i in order]


def predict_single(text: str, model_key: str = None, with_keywords: bool = True) -> Dict:
    art = get_artifacts()
    if not art:
        raise RuntimeError("尚未训练模型，请先在『模型训练』完成训练后再预测。")
    meta = art["meta"]
    names = meta["label_names"]
    model_key = model_key or meta.get("best_model", config.MODEL_LR)
    if model_key not in art["models"]:
        raise ValueError(f"模型 {model_key} 不可用（仅支持 nb / lr）")

    clf = art["models"][model_key]
    vec = art["vectorizer"]
    cleaned = preprocess.clean_text(text)
    X = vec.transform([cleaned])
    probs = clf.predict_proba(X)[0]
    pred_label = int(np.argmax(probs))

    result = {
        "text": text,
        "model": model_key,
        "model_name": config.MODEL_DISPLAY[model_key],
        "pred_label": pred_label,
        "pred_name": names[pred_label],
        "confidence": round(float(probs[pred_label]), 4),
        "topk": _topk(probs, names, 3),
        "distribution": _full_distribution(probs, names),
    }
    if with_keywords:
        result["keywords"] = keyword_contributions(cleaned, model_key, art, pred_label)
        result["basis"] = [k["keyword"] for k in result["keywords"][:4]]
    return result


def predict_texts(texts: List[str], model_key: str = None) -> Tuple[List[Dict], Dict]:
    """批量预测：返回每条结果 + 类别分布统计。"""
    art = get_artifacts()
    if not art:
        raise RuntimeError("尚未训练模型，请先完成训练后再批量预测。")
    meta = art["meta"]
    names = meta["label_names"]
    model_key = model_key or meta.get("best_model", config.MODEL_LR)
    clf = art["models"][model_key]
    vec = art["vectorizer"]

    cleaned = [preprocess.clean_text(t) for t in texts]
    X = vec.transform(cleaned)
    probs = clf.predict_proba(X)
    preds = probs.argmax(axis=1)

    rows = []
    for i, t in enumerate(texts):
        rows.append({
            "text": t,
            "pred_label": int(preds[i]),
            "pred_name": names[int(preds[i])],
            "confidence": round(float(probs[i][preds[i]]), 4),
        })

    # 类别分布
    dist = []
    total = len(preds)
    counts = np.bincount(preds, minlength=len(names))
    for i, name in enumerate(names):
        dist.append({"label": i, "name": name, "count": int(counts[i]),
                     "ratio": round(counts[i] / total * 100, 2) if total else 0.0})
    dist.sort(key=lambda x: x["count"], reverse=True)
    return rows, {"total": total, "distribution": dist,
                  "model": model_key, "model_name": config.MODEL_DISPLAY[model_key]}


def predict_testset(model_key: str = None, limit: Optional[int] = None) -> Tuple[List[Dict], Dict]:
    """对测试集批量预测（带真实标签，可统计正确率）。"""
    test_path = _default_test_path()
    if not test_path or not os.path.exists(test_path):
        raise RuntimeError("未找到测试集，请先上传 test.txt。")
    rep = data_loader.load_file(test_path)
    rows_in = rep.rows[:limit] if limit else rep.rows
    texts = [t for t, _ in rows_in]
    truth = [l for _, l in rows_in]
    rows, stats = predict_texts(texts, model_key)
    art = get_artifacts()
    names = art["meta"]["label_names"]
    correct = 0
    for r, y in zip(rows, truth):
        r["true_label"] = int(y)
        r["true_name"] = names[y] if y < len(names) else str(y)
        r["correct"] = (r["pred_label"] == y)
        correct += r["correct"]
    stats["accuracy"] = round(correct / len(rows), 4) if rows else 0.0
    stats["with_truth"] = True
    return rows, stats


# -------------------- 关键词解释 --------------------
def keyword_contributions(cleaned_text: str, model_key: str, art: Dict,
                          pred_label: int, top_n: int = 10) -> List[Dict]:
    """对预测类别贡献最大的若干特征（关键词解释）。"""
    vec = art["vectorizer"]
    clf = art["models"][model_key]
    X = vec.transform([cleaned_text])
    if X.nnz == 0:
        return []
    feature_names = vec.get_feature_names_out()
    cols = X.indices
    vals = X.data

    if model_key == config.MODEL_LR:
        weights = clf.coef_[pred_label] if clf.coef_.shape[0] > 1 else clf.coef_[0]
    else:  # NB
        weights = clf.feature_log_prob_[pred_label]

    contribs = []
    for col, v in zip(cols, vals):
        w = float(weights[col])
        contribs.append((feature_names[col], v, w * v))
    # 取贡献为正、且最大的若干
    contribs.sort(key=lambda x: x[2], reverse=True)
    top = [c for c in contribs if c[2] > 0][:top_n]
    if not top:
        top = contribs[:top_n]
    total = sum(abs(c[2]) for c in top) or 1.0

    out = []
    for kw, weight, contrib in top:
        pos = cleaned_text.find(kw.replace(" ", ""))
        out.append({
            "keyword": kw.strip(),
            "weight": round(float(weight), 3),
            "contribution": round(abs(contrib) / total * 100, 2),
            "position": pos if pos >= 0 else 0,
        })
    return out


# -------------------- 工具 --------------------
def _default_test_path() -> Optional[str]:
    # 仅使用用户已上传的最近 test 数据集（空白启动：无内置兜底）
    for d in db.list_datasets():
        if d["dtype"] == "test" and d.get("path") and os.path.exists(d["path"]):
            return d["path"]
    return None


def _default_train_path() -> Optional[str]:
    for d in db.list_datasets():
        if d["dtype"] == "train" and d.get("path") and os.path.exists(d["path"]):
            return d["path"]
    return None


def pct_delta(curr: float, prev: Optional[float]) -> Optional[Dict]:
    """计算'较上次'增量；prev 为空（首次）时返回 None —— 前端不显示。"""
    if prev is None:
        return None
    diff = curr - prev
    return {"diff": round(diff, 4), "pct": round(diff * 100, 2), "up": diff >= 0}
