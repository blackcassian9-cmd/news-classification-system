"""模型评价：整体指标、每类指标、混淆矩阵、分类报告。"""
from __future__ import annotations

from typing import Dict, List

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)


def evaluate(y_true, y_pred, label_names: List[str]) -> Dict:
    labels_idx = list(range(len(label_names)))

    acc = accuracy_score(y_true, y_pred)
    # weighted 指标对应前端 Precision/Recall/F1-score；macro 对应 Macro-F1
    prec_w = precision_score(y_true, y_pred, average="weighted", zero_division=0)
    rec_w = recall_score(y_true, y_pred, average="weighted", zero_division=0)
    f1_w = f1_score(y_true, y_pred, average="weighted", zero_division=0)
    macro_f1 = f1_score(y_true, y_pred, average="macro", zero_division=0)

    per_class_p = precision_score(y_true, y_pred, labels=labels_idx, average=None, zero_division=0)
    per_class_r = recall_score(y_true, y_pred, labels=labels_idx, average=None, zero_division=0)
    per_class_f1 = f1_score(y_true, y_pred, labels=labels_idx, average=None, zero_division=0)

    cm = confusion_matrix(y_true, y_pred, labels=labels_idx)
    support = cm.sum(axis=1)

    per_class = []
    for i, name in enumerate(label_names):
        per_class.append({
            "label": i,
            "name": name,
            "precision": round(float(per_class_p[i]), 4),
            "recall": round(float(per_class_r[i]), 4),
            "f1": round(float(per_class_f1[i]), 4),
            "support": int(support[i]),
        })

    return {
        "accuracy": round(float(acc), 4),
        "precision": round(float(prec_w), 4),
        "recall": round(float(rec_w), 4),
        "f1": round(float(f1_w), 4),
        "macro_f1": round(float(macro_f1), 4),
        "per_class": per_class,
        "confusion_matrix": cm.astype(int).tolist(),
        "support_total": int(support.sum()),
    }


def confusion_pairs(cm: List[List[int]], label_names: List[str], top_k: int = 8) -> List[Dict]:
    """从混淆矩阵中提取最容易混淆的类别对（非对角线最大的若干项）。"""
    arr = np.array(cm)
    pairs = []
    n = arr.shape[0]
    total_errors = int(arr.sum() - np.trace(arr))
    for i in range(n):
        for j in range(n):
            if i != j and arr[i, j] > 0:
                pairs.append((i, j, int(arr[i, j])))
    pairs.sort(key=lambda x: x[2], reverse=True)
    out = []
    for i, j, c in pairs[:top_k]:
        out.append({
            "true": label_names[i],
            "pred": label_names[j],
            "count": c,
            "ratio": round(c / total_errors * 100, 1) if total_errors else 0.0,
        })
    return out
