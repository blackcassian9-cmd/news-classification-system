"""数据预览与清洗：分页预览、统计卡片、清洗执行与前后对比、质量分析。"""
from __future__ import annotations

from flask import Blueprint, request

import config
from api import get_payload, ok
from core import dataset_cache, preprocess
from db import database as db

bp = Blueprint("preview", __name__, url_prefix="/api")


def _resolve_paths():
    """解析训练/测试集：选中名仅覆盖同类型的那一个，始终保留另一类型，
    避免选了 test 后训练集丢失导致清洗/预览为空。"""
    items = db.list_datasets()
    name = db.get_selected_dataset()
    sel = next((d for d in items if d["name"] == name), None) if name else None
    train = next((d for d in items if d["dtype"] == "train"), None)
    test = next((d for d in items if d["dtype"] == "test"), None)
    if sel and sel["dtype"] == "train":
        train = sel
    elif sel and sel["dtype"] == "test":
        test = sel
    return train, test


def _label_names(ds):
    if ds and ds.get("label_names"):
        return ds["label_names"]
    return config.DEFAULT_LABEL_NAMES


@bp.get("/preview")
def preview():
    """分页预览样本，支持搜索/类别/数据类型/标签/长度过滤；tab=raw|clean。"""
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, int(request.args.get("page_size", 30)))
    keyword = request.args.get("q", "").strip()
    f_label = request.args.get("label", "")
    f_dtype = request.args.get("data_type", "")
    f_len = request.args.get("length", "")
    tab = request.args.get("tab", "raw")

    train, test = _resolve_paths()
    names = _label_names(train or test)

    pool = []
    for ds, dt in ((train, "train"), (test, "test")):
        if ds and (not f_dtype or f_dtype == dt):
            for i, (text, label) in enumerate(dataset_cache.get_rows(ds["path"])):
                pool.append((i, text, label, dt))

    def keep(item):
        _, text, label, dt = item
        if keyword and keyword not in text:
            return False
        if f_label != "" and str(label) != str(f_label):
            return False
        if f_len:
            n = len(text)
            ranges = {"0-10": (0, 10), "11-20": (11, 20), "21-30": (21, 30),
                      "31-50": (31, 50), "50+": (51, 10 ** 9)}
            lo, hi = ranges.get(f_len, (0, 10 ** 9))
            if not (lo <= n <= hi):
                return False
        return True

    filtered = [it for it in pool if keep(it)]
    total = len(filtered)
    start = (page - 1) * page_size
    page_items = filtered[start:start + page_size]

    rows = []
    for idx, text, label, dt in page_items:
        clean = preprocess.clean_text(text)
        rows.append({
            "idx": idx, "text": text if tab != "clean" else clean,
            "raw": text, "clean": clean,
            "label": label, "label_name": names[label] if label < len(names) else str(label),
            "data_type": "训练集" if dt == "train" else "测试集",
            "length": len(text),
            "status": "正常" if len(clean) >= 2 else "长度过短",
        })

    return ok({"rows": rows, "total": total, "page": page, "page_size": page_size,
               "stat_cards": _quality_cards(train, test)})


def _quality_cards(train, test):
    tr_rows = dataset_cache.get_rows(train["path"]) if train else []
    te_rows = dataset_cache.get_rows(test["path"]) if test else []
    all_texts = [t for t, _ in tr_rows] + [t for t, _ in te_rows]
    if not all_texts:                       # 空库：所有指标为 0
        return {"train_count": 0, "test_count": 0, "missing": 0,
                "duplicate": 0, "avg_length": 0.0, "usable_rate": 0.0}
    n = len(all_texts)
    dup = n - len(set(all_texts))
    avg_len = round(sum(len(t) for t in all_texts) / n, 1)
    cleaned = [preprocess.clean_text(t) for t in all_texts]
    usable = sum(1 for c in cleaned if len(c) >= 2)
    return {
        "train_count": len(tr_rows),
        "test_count": len(te_rows),
        "missing": 0,
        "duplicate": dup,
        "avg_length": avg_len,
        "usable_rate": round(usable / n * 100, 2),
    }


@bp.post("/clean")
def run_clean():
    """执行清洗，返回前后对比、清洗统计、质量分析（数据预览与清洗页全部内容）。"""
    p = get_payload()
    rules = {**preprocess.DEFAULT_RULES, **(p.get("rules") or {})}
    train, test = _resolve_paths()
    names = _label_names(train or test)

    tr_rows = dataset_cache.get_rows(train["path"]) if train else []
    te_rows = dataset_cache.get_rows(test["path"]) if test else []

    tr_texts = [t for t, _ in tr_rows]
    tr_labels = [l for _, l in tr_rows]
    _, _, tr_stats = preprocess.clean_dataset(tr_texts, tr_labels, rules)

    # 前后对比样例（多给几条，前端用滚动条查看）
    pairs = []
    for text, _ in tr_rows[:30]:
        pairs.append({"before": text, "after": preprocess.clean_text(text, rules)})

    total = tr_stats["total"]
    kept = tr_stats["kept"]
    # 类别分布（全部类别，按数量降序；前端用滚动条查看）
    counts = {}
    for _, l in tr_rows:
        counts[l] = counts.get(l, 0) + 1
    dist = sorted(({"name": names[l] if l < len(names) else str(l), "count": c,
                    "ratio": round(c / (total or 1) * 100, 1)}
                   for l, c in counts.items()), key=lambda x: x["count"], reverse=True)
    # 长度区间
    bins = {"0-10": 0, "11-20": 0, "21-30": 0, "31-50": 0, "50+": 0}
    for t in tr_texts:
        n = len(t)
        if n <= 10:
            bins["0-10"] += 1
        elif n <= 20:
            bins["11-20"] += 1
        elif n <= 30:
            bins["21-30"] += 1
        elif n <= 50:
            bins["31-50"] += 1
        else:
            bins["50+"] += 1
    length_bins = [{"range": k, "count": v, "ratio": round(v / (total or 1) * 100, 1)}
                   for k, v in bins.items()]

    db.add_event("log", f"数据清洗完成：保留 {kept}/{total}（{tr_stats['retain_rate']}%）")

    return ok({
        "rules": rules,
        "before_after": pairs,
        "clean_stats": tr_stats,
        "retain_donut": [
            {"name": "保留", "count": kept, "ratio": tr_stats["retain_rate"]},
            {"name": "删除", "count": total - kept,
             "ratio": round(100 - tr_stats["retain_rate"], 2)},
        ],
        "detail_cards": {
            "before_total": total, "after_kept": kept,
            "removed_duplicate": tr_stats["removed_duplicate"],
            "removed_empty": tr_stats["removed_empty"],
            "removed_short": tr_stats["removed_short"],
            "avg_len_before": tr_stats["avg_len_before"],
            "avg_len_after": tr_stats["avg_len_after"],
        },
        "category_top5": dist[:5],
        "category_distribution": dist,
        "length_bins": length_bins,
        "integrity": {
            "missing_rate": 0.0,
            "duplicate_rate": round(tr_stats["removed_duplicate"] / (total or 1) * 100, 2),
            "usable_rate": tr_stats["retain_rate"],
        },
    })
