"""结论 / 提示语生成。

策略：先用"真实指标"生成规则化结论（无需联网，永远可用）；
若用户配置了 DeepSeek API Key，则由 llm 模块在此基础上润色（见 core/llm.py）。

凡是前端"有结论"的地方（首页提示语、模型训练/评价页的当前结论、推荐部署模型）
都从这里取，保证结论与当前真实数据一致——比如换了数据集后若朴素贝叶斯更好，
结论会自动反过来说，而不是写死"逻辑回归更好"。
"""
from __future__ import annotations

from typing import Dict, List

import config


def _pct(x: float) -> str:
    return f"{x * 100:.2f}%"


def compare_models(results: Dict) -> Dict:
    """比较两个模型，返回 best/worst 及各指标差值。"""
    nb = results.get(config.MODEL_NB, {})
    lr = results.get(config.MODEL_LR, {})
    best = config.MODEL_LR if lr.get("macro_f1", 0) >= nb.get("macro_f1", 0) else config.MODEL_NB
    worst = config.MODEL_NB if best == config.MODEL_LR else config.MODEL_LR
    b, w = results[best], results[worst]
    metrics = ["accuracy", "precision", "recall", "f1", "macro_f1"]
    deltas = {m: round(b.get(m, 0) - w.get(m, 0), 4) for m in metrics}
    all_better = all(deltas[m] >= 0 for m in metrics)
    return {
        "best": best, "worst": worst,
        "best_name": config.MODEL_DISPLAY[best],
        "worst_name": config.MODEL_DISPLAY[worst],
        "deltas": deltas, "all_better": all_better,
        "best_macro_f1": b.get("macro_f1", 0),
    }


def dashboard_tip(results: Dict) -> str:
    """首页'性能对比'下面那句提示语。"""
    cmp = compare_models(results)
    if cmp["all_better"]:
        return f"{cmp['best_name']}在各项指标上均优于{cmp['worst_name']}，整体表现更优。"
    return (f"{cmp['best_name']}的 Macro-F1 最高（{_pct(cmp['best_macro_f1'])}），"
            f"综合表现最优，建议作为部署模型。")


def training_conclusions(results: Dict, confusion_pairs: List[Dict] = None) -> List[str]:
    """模型训练页/评价页'当前结论'的 4 条。"""
    cmp = compare_models(results)
    items = []
    if cmp["all_better"]:
        items.append(f"{cmp['best_name']}在各项指标上表现更优。")
    else:
        d = cmp["deltas"]["macro_f1"] * 100
        items.append(f"{cmp['best_name']}综合更优，Macro-F1 领先约 {abs(d):.2f}%。")
    items.append(f"{cmp['best_name']}的 Macro-F1 最优（{_pct(cmp['best_macro_f1'])}），适合作为最终部署模型。")
    items.append(f"已自动保存当前最优模型：{cmp['best_name']}。")
    if confusion_pairs:
        top = confusion_pairs[0]
        items.append(f"主要混淆出现在「{top['true']}↔{top['pred']}」，建议针对性增强这类样本。")
    else:
        items.append("建议进行更多数据集验证以增强泛化效果。")
    return items


def recommend_deploy(results: Dict) -> Dict:
    cmp = compare_models(results)
    return {
        "model": cmp["best"],
        "model_name": cmp["best_name"],
        "macro_f1": round(cmp["best_macro_f1"], 4),
    }
