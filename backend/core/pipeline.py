"""训练流水线编排：读取 -> 清洗 -> TF-IDF -> 训练两模型 -> 评估 -> 持久化。

供 API 层调用，也供命令行验证脚本调用。
"""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

import joblib
from sklearn.model_selection import train_test_split

import config
from core import data_loader, evaluate, features, models, preprocess


def _label_names(num_classes: int, provided: Optional[List[str]] = None) -> List[str]:
    if provided and len(provided) >= num_classes:
        return list(provided[:num_classes])
    if num_classes <= len(config.DEFAULT_LABEL_NAMES):
        return list(config.DEFAULT_LABEL_NAMES[:num_classes])
    return [f"类别{i}" for i in range(num_classes)]


def run_pipeline(train_path: str,
                 test_path: str,
                 tfidf_params: Dict = None,
                 nb_params: Dict = None,
                 lr_params: Dict = None,
                 clean_rules: Dict = None,
                 label_names: Optional[List[str]] = None,
                 delimiter: str = "\t",
                 val_ratio: Optional[float] = None,
                 save: bool = True,
                 model_tag: str = "current") -> Dict:
    t0 = time.time()

    # 1) 读取（自动探测标签列，绝不读反）
    train_rep = data_loader.load_file(train_path, delimiter=delimiter)
    test_rep = data_loader.load_file(test_path, delimiter=delimiter)
    tr_texts, tr_labels = data_loader.split_texts_labels(train_rep.rows)
    te_texts, te_labels = data_loader.split_texts_labels(test_rep.rows)

    num_classes = max(train_rep.num_classes, test_rep.num_classes)
    names = _label_names(num_classes, label_names)

    # 2) 清洗
    tr_texts, tr_labels, tr_clean_stats = preprocess.clean_dataset(tr_texts, tr_labels, clean_rules)
    te_texts, te_labels, te_clean_stats = preprocess.clean_dataset(te_texts, te_labels, clean_rules)

    # 3) 训练集内部再切「验证集」：模型选择/调参只看验证集；test 只用于最终评估，避免泄漏
    ratio = float(val_ratio if val_ratio is not None else config.DEFAULT_VAL_RATIO)
    try:
        tr_x, val_x, tr_y, val_y = train_test_split(
            tr_texts, tr_labels, test_size=ratio,
            stratify=tr_labels, random_state=config.DEFAULT_RANDOM_STATE)
        split_method = "分层抽样"
    except ValueError:
        tr_x, val_x, tr_y, val_y = train_test_split(
            tr_texts, tr_labels, test_size=ratio,
            random_state=config.DEFAULT_RANDOM_STATE)
        split_method = "随机抽样"

    # 4) TF-IDF（仅在训练子集上 fit；验证集 / 测试集只 transform）
    t_feat = time.time()
    vectorizer = features.build_vectorizer(tfidf_params)
    X_tr = vectorizer.fit_transform(tr_x)
    X_val = vectorizer.transform(val_x)
    X_test = vectorizer.transform(te_texts)
    feat_seconds = round(time.time() - t_feat, 2)

    # 5) 训练两个模型：验证集指标用于「模型训练页」与模型选择；测试集指标用于「评价/总览页」
    def _auc(clf, X, y):
        try:
            from sklearn.metrics import roc_auc_score
            return round(float(roc_auc_score(
                y, clf.predict_proba(X), multi_class="ovr", average="macro")), 4)
        except Exception:
            return None

    val_results, results, timings, fitted = {}, {}, {}, {}
    for key in (config.MODEL_NB, config.MODEL_LR):
        params = nb_params if key == config.MODEL_NB else lr_params
        clf = models.build_model(key, params)
        t_fit = time.time()
        clf.fit(X_tr, tr_y)
        fit_seconds = round(time.time() - t_fit, 3)

        val_m = evaluate.evaluate(val_y, clf.predict(X_val), names)
        val_m["train_seconds"] = fit_seconds
        val_m["auc"] = _auc(clf, X_val, val_y)

        test_m = evaluate.evaluate(te_labels, clf.predict(X_test), names)
        test_m["train_seconds"] = fit_seconds
        test_m["auc"] = _auc(clf, X_test, te_labels)

        val_results[key] = val_m
        results[key] = test_m
        timings[key] = fit_seconds
        fitted[key] = clf

    # 选最优：依据「验证集」Macro-F1（绝不看 test，避免信息泄漏）
    best_key = max(val_results, key=lambda k: val_results[k]["macro_f1"])

    # 训练/测试集类别分布（按完整训练集 / 测试集，供首页/数据集页的分布图）
    def _dist(labels):
        counts = [0] * num_classes
        for y in labels:
            if 0 <= y < num_classes:
                counts[y] += 1
        total = len(labels) or 1
        return [{"label": i, "name": names[i], "count": counts[i],
                 "ratio": round(counts[i] / total * 100, 2)} for i in range(num_classes)]

    train_distribution = _dist(tr_labels)
    test_distribution = _dist(te_labels)

    summary = {
        "label_names": names,
        "num_classes": num_classes,
        "train_count": len(tr_labels),
        "val_count": len(val_y),
        "test_count": len(te_labels),
        "split_method": split_method,
        "val_ratio": ratio,
        "train_report": {
            "total_lines": train_rep.total_lines,
            "parsed": train_rep.parsed,
            "skipped": train_rep.skipped,
            "label_position": train_rep.label_position,
        },
        "test_report": {
            "total_lines": test_rep.total_lines,
            "parsed": test_rep.parsed,
            "skipped": test_rep.skipped,
            "label_position": test_rep.label_position,
        },
        "clean_stats": {"train": tr_clean_stats, "test": te_clean_stats},
        "feature_seconds": feat_seconds,
        "feature_stats": {
            "train": features.matrix_stats(X_tr),
            "test": features.matrix_stats(X_test),
            "type_breakdown": features.feature_type_breakdown(vectorizer),
            "train_distribution": train_distribution,
            "test_distribution": test_distribution,
        },
        "train_distribution": train_distribution,
        "test_distribution": test_distribution,
        "val_results": val_results,
        "results": results,
        "best_model": best_key,
        "best_model_name": config.MODEL_DISPLAY[best_key],
        "tfidf_params": {**config.DEFAULT_TFIDF, **(tfidf_params or {})},
        "elapsed_seconds": round(time.time() - t0, 2),
    }

    if save:
        _persist(model_tag, vectorizer, fitted, summary)

    return summary


def _persist(tag: str, vectorizer, fitted: Dict, summary: Dict) -> None:
    out_dir = os.path.join(config.MODELS_DIR, tag)
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump(vectorizer, os.path.join(out_dir, "vectorizer.joblib"))
    for key, clf in fitted.items():
        joblib.dump(clf, os.path.join(out_dir, f"model_{key}.joblib"))
    joblib.dump({
        "label_names": summary["label_names"],
        "best_model": summary["best_model"],
        "tfidf_params": summary["tfidf_params"],
    }, os.path.join(out_dir, "meta.joblib"))


def load_artifacts(tag: str = "current") -> Optional[Dict]:
    out_dir = os.path.join(config.MODELS_DIR, tag)
    vec_path = os.path.join(out_dir, "vectorizer.joblib")
    meta_path = os.path.join(out_dir, "meta.joblib")
    if not (os.path.exists(vec_path) and os.path.exists(meta_path)):
        return None
    meta = joblib.load(meta_path)
    artifacts = {"vectorizer": joblib.load(vec_path), "meta": meta, "models": {}}
    for key in (config.MODEL_NB, config.MODEL_LR):
        mp = os.path.join(out_dir, f"model_{key}.joblib")
        if os.path.exists(mp):
            artifacts["models"][key] = joblib.load(mp)
    return artifacts
