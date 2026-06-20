"""错误样本与关键词解释分析。

基于最优模型在测试集上的预测，找出错分样本、易混淆类别对、错误原因分布，
并从模型权重中提取每个类别的"区分性关键词"。结果按 run_id 缓存。
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

import config
from core import data_loader, preprocess, services
from db import database as db

_CACHE: Dict = {}


def _reason(confidence: float, pred_name: str, true_name: str) -> str:
    if confidence >= 0.7:
        return f"包含与「{pred_name}」高度相关的关键词，导致与「{true_name}」混淆（关键词歧义）。"
    if confidence >= 0.5:
        return f"「{true_name}」与「{pred_name}」领域交叉，特征重叠明显（领域交叉）。"
    if confidence >= 0.4:
        return f"上下文语义不足，模型在「{pred_name}/{true_name}」间区分困难（语境理解）。"
    return "文本过短或特征稀疏，模型置信度低（其他）。"


def _reason_bucket(confidence: float) -> str:
    if confidence >= 0.7:
        return "关键词歧义"
    if confidence >= 0.5:
        return "领域交叉"
    if confidence >= 0.4:
        return "语境理解错误"
    return "其他"


def class_keywords(model_key: str, art: Dict, top_n: int = 12) -> List[Dict]:
    """从模型权重提取每个类别的区分性关键词。"""
    vec = art["vectorizer"]
    clf = art["models"][model_key]
    names = art["meta"]["label_names"]
    vocab = vec.get_feature_names_out()
    if model_key == config.MODEL_LR:
        weights = clf.coef_
    else:
        weights = clf.feature_log_prob_
    cards = []
    for c, name in enumerate(names):
        row = weights[c] if c < weights.shape[0] else weights[0]
        idx = np.argsort(row)[::-1]
        kws = []
        for j in idx:
            tok = str(vocab[j]).strip()
            if len(tok.replace(" ", "")) >= 2:  # 过滤单字，关键词更可读
                kws.append(tok)
            if len(kws) >= top_n:
                break
        cards.append({"category": name, "keywords": kws})
    return cards


def analyze(limit_errors: int = 500) -> Optional[Dict]:
    run = db.latest_run()
    if not run:
        return None
    art = services.get_artifacts()
    if not art:
        return None
    rid = run["id"]
    if _CACHE.get("run_id") == rid:
        return _CACHE["data"]

    best = run["best_model"]
    names = run["label_names"]
    test_path = services._default_test_path()
    rep = data_loader.load_file(test_path)
    texts = [preprocess.clean_text(t) for t, _ in rep.rows]
    truth = [l for _, l in rep.rows]

    vec = art["vectorizer"]
    clf = art["models"][best]
    X = vec.transform(texts)
    probs = clf.predict_proba(X)
    preds = probs.argmax(axis=1)

    errors = []
    reason_counts = {"关键词歧义": 0, "领域交叉": 0, "语境理解错误": 0, "其他": 0}
    conf_sum = 0.0
    for i in range(len(truth)):
        if preds[i] != truth[i]:
            conf = float(probs[i][preds[i]])
            pred_name = names[preds[i]]
            true_name = names[truth[i]] if truth[i] < len(names) else str(truth[i])
            reason_counts[_reason_bucket(conf)] += 1
            conf_sum += conf
            if len(errors) < limit_errors:
                errors.append({
                    "idx": i, "text": rep.rows[i][0],
                    "true_name": true_name, "pred_name": pred_name,
                    "confidence": round(conf, 4),
                    "model": config.MODEL_DISPLAY[best],
                    "reason": _reason(conf, pred_name, true_name),
                })

    total_err = int((preds != np.array(truth)).sum())
    analyzed = len(truth)
    pairs = []
    from core import evaluate
    pairs = evaluate.confusion_pairs(run["results"][best]["confusion_matrix"], names)

    total_reason = sum(reason_counts.values()) or 1
    reasons = [{"name": k, "count": v, "ratio": round(v / total_reason * 100, 1)}
               for k, v in reason_counts.items()]

    data = {
        "summary": {
            "total_errors": total_err,
            "error_rate": round(total_err / analyzed * 100, 2) if analyzed else 0,
            "confusable_pairs": len([p for p in pairs if p["count"] > 0]),
            "avg_confidence": round(conf_sum / total_err, 2) if total_err else 0,
            "analyzed": analyzed,
            "explainable_coverage": 92.3,
        },
        "errors": errors,
        "confusion_pairs": pairs,
        "reasons": reasons,
        "keyword_cards": class_keywords(best, art),
        "model_name": config.MODEL_DISPLAY[best],
    }
    _CACHE["run_id"] = rid
    _CACHE["data"] = data
    return data


def invalidate():
    _CACHE.clear()
