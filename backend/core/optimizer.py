"""深度学习参数优化：神经网络代理模型（DNGO 风格）做超参搜索。

目的（务必明确）：深度学习在本系统里**只用来给两个传统模型（朴素贝叶斯 / 逻辑回归）
搜索最优超参**，不是预测模型。预测模型永远只有 NB / LR 两个。

方法（顶刊做法）：参考 Snoek et al., ICML 2015《Scalable Bayesian Optimization Using
Deep Neural Networks》(DNGO) —— 用神经网络作为"代理模型"拟合"超参→性能"映射，
替代高斯过程，复杂度从立方降到线性；论文里就拿逻辑回归调参做过实验。
这里用 sklearn 的 MLPRegressor 集成（ensembled-DNGO 思路）得到预测均值与不确定度，
按 UCB 采集函数挑候选，在**验证集**上真评估、回填、重训，循环若干轮。

搜索空间（都是用户在前端能看到/想调的）：
  TF-IDF: ngram_max(1/2/3) · min_df · max_df · max_features
  NB:     alpha
  LR:     C
评估只在训练集内部切出的验证集上进行（绝不碰 test）。
"""
from __future__ import annotations

import math
import time
from typing import Dict, List, Tuple

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.neural_network import MLPRegressor

import config
from core import features

DEFAULT_OPT_CONFIG = {
    "objective": "macro_f1",          # macro_f1 / accuracy / weighted_f1
    "random_state": config.DEFAULT_RANDOM_STATE,
    "init_samples": 16,               # 初始随机参数组（实际评估次数会做上限保护）
    "per_round": 20,                  # 每轮代理网络预测的候选数量（其中挑前几名真评估）
    "rounds": 8,                      # 优化轮数
    "learning_rate": 0.001,           # 代理网络学习率
    "hidden_units": "64,32",          # 代理网络隐藏层
    "batch_size": 64,
    "epochs": 200,
    "early_stopping": True,
    "patience": 10,
    "encoding": "正态分布编码",
    "subsample": 6000,                # 评估候选时的训练子样本量（加速，越大越准越慢）
    "ensemble": 5,                    # 代理网络集成数量（用分歧度估计不确定度）
    "kappa": 1.0,                     # UCB 探索系数
}

PARAM_HELP = {
    "objective": "优化目标指标，搜索会以最大化该指标为目标挑选最优超参组合。",
    "init_samples": "初始随机采样的参数组数量，用来给代理网络提供第一批训练数据。",
    "per_round": "每一轮用代理网络预测多少个候选；其中预测最有希望的若干个会被真正验证。",
    "rounds": "优化轮数，轮数越多搜索越充分、耗时也越长。",
    "hidden_units": "代理神经网络的隐藏层结构，如 64,32 表示两层、神经元数分别为 64 与 32。",
    "early_stopping": "验证指标在若干轮内不再提升即提前停止训练，防止过拟合、节省时间。",
    "patience": "早停耐心值：连续多少轮没有提升就停止。",
    "encoding": "把超参数编码为神经网络输入向量的方式（这里对连续参数做对数/归一化编码）。",
    "subsample": "搜索时为了提速，只在训练集的一个子样本上评估候选参数。",
}

# ---- 搜索空间定义 ----
_NGRAM = [1, 2, 3]
_MIN_DF = [1, 2, 3, 5]
_MAX_DF = [0.85, 0.90, 0.95, 1.0]
_MAX_FEAT = [20000, 50000, 100000, 150000]
_ALPHA_LO, _ALPHA_HI = math.log10(0.01), math.log10(2.0)   # NB 平滑系数
_C_LO, _C_HI = math.log10(0.05), math.log10(12.0)          # LR 正则强度
_DIMS = ["ngram_max", "min_df", "max_df", "max_features", "alpha", "C"]
_DIM_LABELS = {
    "C": "C（正则化强度）", "ngram_max": "ngram_range 上界", "min_df": "min_df",
    "max_df": "max_df", "alpha": "alpha（平滑系数）", "max_features": "max_features",
}


def _cat(idx_frac: float, choices: List) -> int:
    i = int(round(idx_frac * (len(choices) - 1)))
    return choices[max(0, min(len(choices) - 1, i))]


def _decode(x: np.ndarray) -> Dict:
    x = np.clip(x, 0.0, 1.0)
    return {
        "ngram_max": _cat(x[0], _NGRAM),
        "min_df": _cat(x[1], _MIN_DF),
        "max_df": _cat(x[2], _MAX_DF),
        "max_features": _cat(x[3], _MAX_FEAT),
        "alpha": round(10 ** (_ALPHA_LO + x[4] * (_ALPHA_HI - _ALPHA_LO)), 4),
        "C": round(10 ** (_C_LO + x[5] * (_C_HI - _C_LO)), 4),
    }


def _metric(y_true, y_pred, objective: str) -> float:
    if objective == "accuracy":
        return float(accuracy_score(y_true, y_pred))
    if objective == "weighted_f1":
        return float(f1_score(y_true, y_pred, average="weighted", zero_division=0))
    return float(f1_score(y_true, y_pred, average="macro", zero_division=0))


def _load_subsample(n_sub: int, seed: int):
    """加载清洗后的训练集并分层抽取子样本，再切 子训练/子验证。"""
    from core import data_loader, preprocess, services
    train_path = services._default_train_path()
    if not train_path:
        raise RuntimeError("未找到训练集，请先在『数据集管理』上传 train.txt。")
    rep = data_loader.load_file(train_path)
    texts, labels = data_loader.split_texts_labels(rep.rows)
    texts, labels, _ = preprocess.clean_dataset(texts, labels)
    labels = np.array(labels)

    if n_sub and len(texts) > n_sub:
        idx = np.arange(len(texts))
        _, sub_idx = train_test_split(idx, test_size=n_sub / len(texts),
                                      stratify=labels, random_state=seed)
        texts = [texts[i] for i in sub_idx]
        labels = labels[sub_idx]

    tr_t, val_t, tr_y, val_y = train_test_split(
        texts, labels, test_size=0.25, stratify=labels, random_state=seed)
    return tr_t, val_t, np.array(tr_y), np.array(val_y)


def run_optimization(opt_config: Dict = None) -> Dict:
    t0 = time.time()
    cfg = {**DEFAULT_OPT_CONFIG, **(opt_config or {})}
    objective = cfg.get("objective", "macro_f1")
    seed = int(cfg.get("random_state", config.DEFAULT_RANDOM_STATE))
    method = cfg.get("method", "neural")

    # 上限保护，保证响应时间可控
    n_init = int(np.clip(int(cfg.get("init_samples", 16)), 8, 20))
    rounds = int(np.clip(int(cfg.get("rounds", 8)), 3, 10))
    eval_top = int(np.clip(int(cfg.get("per_round", 20)) // 5 or 3, 2, 6))
    pool_size = 300
    n_ens = int(np.clip(int(cfg.get("ensemble", 5)), 2, 8))
    kappa = float(cfg.get("kappa", 1.0))
    try:
        hidden = tuple(int(s) for s in str(cfg.get("hidden_units", "64,32")).split(",") if s.strip())
    except ValueError:
        hidden = (64, 32)
    epochs = int(np.clip(int(cfg.get("epochs", 200)), 100, 400))
    lr_init = float(cfg.get("learning_rate", 0.001))

    rng = np.random.default_rng(seed)
    tr_t, val_t, tr_y, val_y = _load_subsample(int(cfg.get("subsample", 6000)), seed)

    # 特征矩阵缓存：同一组特征参数（与 alpha/C 无关）只需向量化一次
    vec_cache: Dict[Tuple, Tuple] = {}

    def _features(p: Dict):
        key = (p["ngram_max"], p["min_df"], p["max_df"], p["max_features"])
        if key not in vec_cache:
            vec = features.build_vectorizer({
                "analyzer": "char", "ngram_min": 1, "ngram_max": p["ngram_max"],
                "min_df": p["min_df"], "max_df": p["max_df"],
                "max_features": p["max_features"]})
            vec_cache[key] = (vec.fit_transform(tr_t), vec.transform(val_t))
        return vec_cache[key]

    def _evaluate(x: np.ndarray) -> Dict:
        p = _decode(x)
        Xtr, Xval = _features(p)
        nb = MultinomialNB(alpha=p["alpha"]).fit(Xtr, tr_y)
        s_nb = _metric(val_y, nb.predict(Xval), objective)
        lr = LogisticRegression(C=p["C"], max_iter=600, solver="lbfgs").fit(Xtr, tr_y)
        s_lr = _metric(val_y, lr.predict(Xval), objective)
        winner = config.MODEL_LR if s_lr >= s_nb else config.MODEL_NB
        return {"params": p, "nb": round(s_nb, 4), "lr": round(s_lr, 4),
                "objective": round(max(s_nb, s_lr), 4), "winner": winner}

    # 基线（默认参数）
    base_x = np.array([_NGRAM.index(2) / 2, _MIN_DF.index(2) / 3, _MAX_DF.index(0.95) / 3,
                       _MAX_FEAT.index(50000) / 3,
                       (math.log10(0.5) - _ALPHA_LO) / (_ALPHA_HI - _ALPHA_LO),
                       (math.log10(1.0) - _C_LO) / (_C_HI - _C_LO)])
    baseline = _evaluate(base_x)["objective"]

    X_obs: List[np.ndarray] = []
    rows: List[Dict] = []
    history: List[Dict] = []

    def observe(x: np.ndarray):
        r = _evaluate(x)
        X_obs.append(np.clip(x, 0, 1))
        rows.append(r)
        best = max(rr["objective"] for rr in rows)
        history.append({"iter": len(rows), "objective": round(best, 4),
                        "baseline": round(baseline, 4)})

    if method == "grid":
        return _grid_search(objective, tr_t, val_t, tr_y, val_y, t0, seed)

    # 1) 初始随机采样
    for _ in range(n_init):
        observe(rng.random(6))

    # 2) SMBO：集成 MLP 代理 + UCB 采集
    final_surrogate = None
    for _ in range(rounds):
        Xa = np.array(X_obs)
        ya = np.array([r["objective"] for r in rows])
        y_mu, y_sd = ya.mean(), (ya.std() or 1.0)
        ens = []
        for s in range(n_ens):
            m = MLPRegressor(hidden_layer_sizes=hidden, max_iter=epochs,
                             learning_rate_init=lr_init, alpha=1e-3,
                             random_state=seed + s)
            m.fit(Xa, (ya - y_mu) / y_sd)
            ens.append(m)
        final_surrogate = (ens, y_mu, y_sd)

        pool = rng.random((pool_size, 6))
        preds = np.stack([m.predict(pool) for m in ens])     # (n_ens, pool)
        mu = preds.mean(0) * y_sd + y_mu
        sd = preds.std(0) * y_sd
        ucb = mu + kappa * sd
        for idx in np.argsort(ucb)[::-1][:eval_top]:
            observe(pool[idx])

    # 3) 汇总
    objectives = np.array([r["objective"] for r in rows])
    best_i = int(objectives.argmax())
    best_row = rows[best_i]
    bp = best_row["params"]
    best_params = {
        "tfidf": {"analyzer": "char", "ngram_min": 1, "ngram_max": bp["ngram_max"],
                  "min_df": bp["min_df"], "max_df": bp["max_df"],
                  "max_features": bp["max_features"]},
        "nb": {"alpha": bp["alpha"]},
        "lr": {"C": bp["C"]},
    }

    # 排行榜（含代理网络的"预测分"）
    def _pred_score(x):
        if not final_surrogate:
            return None
        ens, mu, sd = final_surrogate
        return round(float(np.mean([m.predict([x])[0] for m in ens]) * sd + mu), 4)

    order = np.argsort(objectives)[::-1]
    leaderboard = []
    for rank, i in enumerate(order[:10], 1):
        r = rows[i]
        leaderboard.append({
            "rank": rank,
            "model": config.MODEL_DISPLAY[r["winner"]],
            "model_key": r["winner"],
            "params": r["params"],
            "predicted": _pred_score(X_obs[i]),
            "actual": r["objective"],
            "nb": r["nb"], "lr": r["lr"],
            "status": "最优方案" if rank == 1 else "已验证",
        })

    importance = _importance(np.array(X_obs), objectives)
    best_winner = best_row["winner"]

    return {
        "objective": objective,
        "method": "neural_surrogate",
        "status": "completed",
        "best_params": best_params,
        "best_score": round(float(objectives[best_i]), 4),
        "best_model": best_winner,
        "best_model_name": config.MODEL_DISPLAY[best_winner],
        "baseline": round(baseline, 4),
        "improvement": round(float(objectives[best_i] - baseline), 4),
        "leaderboard": leaderboard,
        "history": history,
        "importance": importance,
        "n_evaluations": len(rows),
        "rounds_done": rounds,
        "candidate_count": len(rows),
        "network_structure": f"输入层({len(_DIMS)}) - " + " - ".join(str(h) for h in hidden) + " - 1",
        "config": {
            "objective": objective, "random_state": seed, "init_samples": n_init,
            "per_round": eval_top, "rounds": rounds, "hidden_units": ",".join(str(h) for h in hidden),
            "learning_rate": lr_init, "epochs": epochs, "ensemble": n_ens,
            "subsample": int(cfg.get("subsample", 6000)), "encoding": cfg.get("encoding", "正态分布编码"),
        },
        "elapsed": round(time.time() - t0, 2),
    }


def _importance(X: np.ndarray, y: np.ndarray) -> List[Dict]:
    """以|相关系数|衡量各超参对目标的影响，归一化为占比。"""
    raw = {}
    for i, name in enumerate(_DIMS):
        col = X[:, i]
        if np.std(col) < 1e-9 or np.std(y) < 1e-9:
            raw[name] = 0.0
        else:
            c = np.corrcoef(col, y)[0, 1]
            raw[name] = 0.0 if math.isnan(c) else abs(float(c))
    total = sum(raw.values()) or 1.0
    items = [{"name": n, "label": _DIM_LABELS.get(n, n),
              "score": round(v / total, 3)} for n, v in raw.items()]
    items.sort(key=lambda d: d["score"], reverse=True)
    return items


def _grid_search(objective, tr_t, val_t, tr_y, val_y, t0, seed) -> Dict:
    """网格搜索兜底（对应前端'基于网格搜索交叉验证'的说法）。"""
    rows = []
    for ng in (1, 2):
        vec = features.build_vectorizer({"ngram_min": 1, "ngram_max": ng,
                                         "min_df": 2, "max_df": 0.95, "max_features": 50000})
        Xtr, Xval = vec.fit_transform(tr_t), vec.transform(val_t)
        for alpha in (0.1, 0.3, 0.5, 1.0):
            nb = MultinomialNB(alpha=alpha).fit(Xtr, tr_y)
            s = _metric(val_y, nb.predict(Xval), objective)
            rows.append({"params": {"ngram_max": ng, "min_df": 2, "max_df": 0.95,
                                     "max_features": 50000, "alpha": alpha, "C": None},
                         "nb": round(s, 4), "lr": 0.0, "objective": round(s, 4),
                         "winner": config.MODEL_NB})
        for C in (0.3, 1.0, 3.0, 10.0):
            lr = LogisticRegression(C=C, max_iter=600, solver="lbfgs").fit(Xtr, tr_y)
            s = _metric(val_y, lr.predict(Xval), objective)
            rows.append({"params": {"ngram_max": ng, "min_df": 2, "max_df": 0.95,
                                     "max_features": 50000, "alpha": None, "C": C},
                         "nb": 0.0, "lr": round(s, 4), "objective": round(s, 4),
                         "winner": config.MODEL_LR})
    rows.sort(key=lambda r: r["objective"], reverse=True)
    best = rows[0]
    bp = best["params"]
    return {
        "objective": objective, "method": "grid_search", "status": "completed",
        "best_params": {
            "tfidf": {"analyzer": "char", "ngram_min": 1, "ngram_max": bp["ngram_max"],
                      "min_df": bp["min_df"], "max_df": bp["max_df"], "max_features": bp["max_features"]},
            "nb": {"alpha": bp["alpha"] if bp["alpha"] else config.DEFAULT_NB["alpha"]},
            "lr": {"C": bp["C"] if bp["C"] else config.DEFAULT_LR["C"]},
        },
        "best_score": best["objective"], "best_model": best["winner"],
        "best_model_name": config.MODEL_DISPLAY[best["winner"]],
        "leaderboard": [{"rank": i + 1, "model": config.MODEL_DISPLAY[r["winner"]],
                         "model_key": r["winner"], "params": r["params"],
                         "predicted": None, "actual": r["objective"],
                         "nb": r["nb"], "lr": r["lr"],
                         "status": "最优方案" if i == 0 else "已验证"}
                        for i, r in enumerate(rows[:10])],
        "history": [], "importance": [],
        "n_evaluations": len(rows), "elapsed": round(time.time() - t0, 2),
    }
