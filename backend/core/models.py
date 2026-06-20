"""两个传统机器学习模型：多项式朴素贝叶斯、逻辑回归。

整个系统只用这两个分类模型（深度学习仅用于"调参"，不作为预测模型）。
"""
from __future__ import annotations

from typing import Dict

from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import MultinomialNB

import config


def build_nb(params: Dict = None) -> MultinomialNB:
    p = {**config.DEFAULT_NB, **(params or {})}
    return MultinomialNB(alpha=float(p.get("alpha", 0.5)),
                         fit_prior=bool(p.get("fit_prior", True)))


def build_lr(params: Dict = None) -> LogisticRegression:
    p = {**config.DEFAULT_LR, **(params or {})}
    return LogisticRegression(
        C=float(p.get("C", 1.0)),
        max_iter=int(p.get("max_iter", 2000)),
        solver=p.get("solver", "liblinear"),
        n_jobs=None,
    )


def build_model(model_key: str, params: Dict = None):
    if model_key == config.MODEL_NB:
        return build_nb(params)
    if model_key == config.MODEL_LR:
        return build_lr(params)
    raise ValueError(f"未知模型：{model_key}（仅支持 nb / lr）")
