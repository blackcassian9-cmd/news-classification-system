"""服务端可视化：用 matplotlib 生成图片（PNG）。

对应前端"模型评价与可视化"页里那些'画出来的图'：混淆矩阵热力图、
模型性能对比、各类别 F1、类别分布等。生成后存到 storage/charts/，
前端用 <img> 引用，对应按钮下方展示。
"""
from __future__ import annotations

import os
from typing import Dict, List

import matplotlib

matplotlib.use("Agg")  # 无界面后端
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager, rcParams

import config

# 中文字体：优先常见 Windows 中文字体，避免方块
for _f in ["Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC", "Arial Unicode MS"]:
    if any(_f in f.name for f in font_manager.fontManager.ttflist):
        rcParams["font.sans-serif"] = [_f]
        break
rcParams["axes.unicode_minus"] = False

RED = "#e11d26"
PINK = "#ffc0c0"
BLUE = "#3b82f6"


def _save(fig, name: str) -> str:
    path = os.path.join(config.CHARTS_DIR, name)
    fig.savefig(path, dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def confusion_matrix_png(cm: List[List[int]], label_names: List[str], model_name: str,
                         filename: str) -> str:
    arr = np.array(cm, dtype=float)
    row_sum = arr.sum(axis=1, keepdims=True)
    norm = np.divide(arr, row_sum, out=np.zeros_like(arr), where=row_sum != 0)

    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(norm, cmap="Reds", vmin=0, vmax=1)
    ax.set_xticks(range(len(label_names)))
    ax.set_yticks(range(len(label_names)))
    ax.set_xticklabels(label_names, rotation=45, ha="right", fontsize=9)
    ax.set_yticklabels(label_names, fontsize=9)
    ax.set_xlabel("预测类别")
    ax.set_ylabel("真实类别")
    ax.set_title(f"混淆矩阵 - {model_name}")
    for i in range(len(label_names)):
        for j in range(len(label_names)):
            v = norm[i, j]
            ax.text(j, i, f"{v*100:.0f}", ha="center", va="center",
                    color="white" if v > 0.5 else "#444", fontsize=7)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    return _save(fig, filename)


def perf_comparison_png(results: Dict, filename: str) -> str:
    metrics = ["accuracy", "precision", "recall", "f1", "macro_f1"]
    labels = ["Accuracy", "Precision", "Recall", "F1-score", "Macro-F1"]
    nb = [results[config.MODEL_NB][m] * 100 for m in metrics]
    lr = [results[config.MODEL_LR][m] * 100 for m in metrics]
    x = np.arange(len(metrics))
    w = 0.36
    fig, ax = plt.subplots(figsize=(8, 4.6))
    b1 = ax.bar(x - w / 2, nb, w, label="朴素贝叶斯", color=PINK)
    b2 = ax.bar(x + w / 2, lr, w, label="逻辑回归", color=RED)
    ax.set_ylim(0, 100)
    ax.set_ylabel("百分比 (%)")
    ax.set_title("模型性能对比（朴素贝叶斯 vs 逻辑回归）")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.legend()
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1,
                    f"{b.get_height():.2f}", ha="center", fontsize=7)
    return _save(fig, filename)


def per_class_f1_png(per_class: List[Dict], filename: str) -> str:
    items = sorted(per_class, key=lambda d: d["f1"], reverse=True)
    names = [d["name"] for d in items]
    vals = [d["f1"] * 100 for d in items]
    fig, ax = plt.subplots(figsize=(8, 4.6))
    bars = ax.bar(names, vals, color=RED)
    ax.set_ylim(0, 100)
    ax.set_ylabel("F1-score (%)")
    ax.set_title("各类别 F1-score")
    plt.xticks(rotation=30, ha="right")
    for b in bars:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1,
                f"{b.get_height():.1f}", ha="center", fontsize=7)
    return _save(fig, filename)


def category_distribution_png(distribution: List[Dict], filename: str, title: str = "类别分布") -> str:
    items = sorted(distribution, key=lambda d: d.get("count", 0), reverse=True)
    names = [d["name"] for d in items]
    vals = [d.get("count", 0) for d in items]
    fig, ax = plt.subplots(figsize=(8, 4.6))
    bars = ax.bar(names, vals, color=RED)
    ax.set_ylabel("样本数")
    ax.set_title(title)
    plt.xticks(rotation=30, ha="right")
    for b in bars:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height(),
                f"{int(b.get_height())}", ha="center", va="bottom", fontsize=7)
    return _save(fig, filename)
