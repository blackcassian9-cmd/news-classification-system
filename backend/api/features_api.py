"""TF-IDF 特征提取：参数配置、执行提取、特征统计与图表数据。"""
from __future__ import annotations

import numpy as np
from flask import Blueprint

import config
from api import err, get_payload, ok
from core import dataset_cache, features, preprocess, services
from db import database as db

bp = Blueprint("features", __name__, url_prefix="/api/tfidf")


@bp.get("/config")
def get_config():
    saved = db.get_setting("tfidf_config")
    cfg = config.DEFAULT_TFIDF
    if saved:
        import json
        try:
            cfg = {**cfg, **json.loads(saved)}
        except ValueError:
            pass
    train_p = services._default_train_path()
    test_p = services._default_test_path()
    tr = dataset_cache.get_rows(train_p) if train_p else []
    te = dataset_cache.get_rows(test_p) if test_p else []
    return ok({
        "params": cfg,
        "dataset": {
            "name": db.get_setting("selected_dataset_name", "THUCNews-轻量版"),
            "train_count": len(tr), "test_count": len(te),
            "num_classes": len({l for _, l in tr}) if tr else 0,
        },
        "param_help": _PARAM_HELP,
    })


@bp.post("/save-config")
def save_config():
    import json
    p = get_payload()
    db.set_setting("tfidf_config", json.dumps(p.get("params") or {}, ensure_ascii=False))
    return ok({"saved": True})


@bp.post("/extract")
def extract():
    p = get_payload()
    params = {**config.DEFAULT_TFIDF, **(p.get("params") or {})}
    train_p = services._default_train_path()
    test_p = services._default_test_path()
    if not train_p:
        return err("未找到训练集，请先在『数据集管理』上传 train.txt")

    tr = dataset_cache.get_rows(train_p)
    te = dataset_cache.get_rows(test_p) if test_p else []
    tr_texts = [preprocess.clean_text(t) for t, _ in tr]
    te_texts = [preprocess.clean_text(t) for t, _ in te]

    vec = features.build_vectorizer(params)
    X_train = vec.fit_transform(tr_texts)
    X_test = vec.transform(te_texts) if te_texts else None

    idf = vec.idf_
    df = np.asarray((X_train > 0).sum(axis=0)).ravel()
    vocab = vec.get_feature_names_out()

    # Top 特征（按文档频率降序）
    order = np.argsort(df)[::-1][:10]
    top_features = [{"rank": i + 1, "feature": str(vocab[j]),
                     "idf": round(float(idf[j]), 4), "df": int(df[j])}
                    for i, j in enumerate(order)]

    # DF 分布（对数刻度桶）
    df_bins = [1, 2, 5, 10, 50, 100, 500, 1000, 5000, 10000, 100000]
    df_hist = []
    for k in range(len(df_bins) - 1):
        cnt = int(((df >= df_bins[k]) & (df < df_bins[k + 1])).sum())
        df_hist.append({"range": f"{df_bins[k]}-{df_bins[k+1]}", "count": cnt})

    # IDF 直方图
    idf_counts, idf_edges = np.histogram(idf, bins=8)
    idf_hist = [{"bin": round(float(idf_edges[i]), 2), "count": int(idf_counts[i])}
                for i in range(len(idf_counts))]

    mem_mb = 0.0
    if hasattr(X_train, "data"):
        mem_mb = round((X_train.data.nbytes + X_train.indices.nbytes + X_train.indptr.nbytes)
                       / 1024 / 1024, 2)

    overview = {
        "train_features": X_train.shape[1],
        "test_features": X_test.shape[1] if X_test is not None else 0,
        "train_matrix": f"{X_train.shape[0]}×{X_train.shape[1]}",
        "test_matrix": f"{X_test.shape[0]}×{X_test.shape[1]}" if X_test is not None else "-",
        "sparsity": features.matrix_stats(X_train)["sparsity"],
        "memory_mb": mem_mb,
    }

    db.add_event("log", f"TF-IDF 特征提取完成：{X_train.shape[1]} 维")

    return ok({
        "overview": overview,
        "df_distribution": df_hist,
        "idf_histogram": idf_hist,
        "top_features": top_features,
        "type_breakdown": features.feature_type_breakdown(vec),
        "sparsity_table": {
            "train": features.matrix_stats(X_train),
            "test": features.matrix_stats(X_test) if X_test is not None else None,
        },
        "params": params,
    })


_PARAM_HELP = {
    "analyzer": "特征切分方式。char=按字符切分单字/双字/三字（中文无需分词，推荐）；word=用 jieba 分词后做词特征。",
    "ngram_range": "n-gram 范围。(1,2) 表示同时提取单字与双字组合；上界设为 3 即包含三字特征。",
    "min_df": "最小文档频率。出现文档数少于该值的特征会被过滤，用于去掉太少出现的噪声组合。",
    "max_df": "最大文档频率比例。出现过于普遍（如 95% 文档都有）的特征会被过滤，因为无区分度。",
    "max_features": "限制保留的特征数量上限，按重要性截断，控制维度与内存。",
    "sublinear_tf": "对词频取 1+log(tf) 做平滑，削弱高频词的过强影响。",
    "use_idf": "是否启用逆文档频率加权（突出区分性强的特征）。",
    "smooth_idf": "对 IDF 做平滑，避免除零、稳定数值。",
    "norm": "特征向量归一化方式，l2 为按欧氏长度归一，利于线性模型。",
}
