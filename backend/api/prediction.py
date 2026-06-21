"""新闻文本预测：单条预测、批量预测、历史、类别分布、相似新闻、可用模型。

预测模型只有两个：朴素贝叶斯 / 逻辑回归（深度学习仅用于调参，不在此列）。
"""
from __future__ import annotations

import time
import re
from html import unescape
from urllib.parse import urlparse

from flask import Blueprint, request

import config
from api import err, get_payload, ok
from core import services, similar_news
from db import database as db

bp = Blueprint("prediction", __name__, url_prefix="/api/prediction")


def _uid():
    """当前登录用户 id；未登录返回 None。预测/历史一律按用户隔离。"""
    from api.auth import current_user
    u = current_user()
    return u["id"] if u else None


@bp.get("/models")
def models():
    """选择模型下拉框——严格只有两个预测模型。"""
    art = services.get_artifacts()
    best = art["meta"]["best_model"] if art else config.MODEL_LR
    return ok({"models": [
        {"key": config.MODEL_NB, "name": "朴素贝叶斯", "recommended": best == config.MODEL_NB},
        {"key": config.MODEL_LR, "name": "逻辑回归", "recommended": best == config.MODEL_LR},
    ], "trained": services.has_trained_model(), "best": best})


@bp.get("/stats")
def stats():
    pstats = db.prediction_stats()
    run = db.latest_run()
    acc = run["results"][run["best_model"]]["accuracy"] if run else None
    return ok({
        "today": pstats["today"], "week": pstats["week"], "total": pstats["total"],
        "model_accuracy": acc,
        "num_classes": run["num_classes"] if run else (len(config.DEFAULT_LABEL_NAMES)),
        "current_model": config.MODEL_DISPLAY.get(run["best_model"]) if run else None,
    })


@bp.post("/predict")
def predict():
    if not _uid():
        return err("请先登录后再使用预测功能", 401)
    p = get_payload()
    text = (p.get("text") or "").strip()
    if not text:
        return err("请输入新闻文本")
    if not services.has_trained_model():
        return err("尚未训练模型，请先完成『模型训练』再预测。", 409)

    options = p.get("options") or {}
    t0 = time.time()
    try:
        res = services.predict_single(text, p.get("model"),
                                      with_keywords=options.get("keywords", True))
    except (RuntimeError, ValueError) as e:
        return err(str(e), 409)
    res["elapsed_ms"] = int((time.time() - t0) * 1000)
    res["time"] = db.now_str()

    if options.get("save", True):
        db.insert_prediction({"text": text, "model": res["model"],
                              "pred_label": res["pred_label"], "pred_name": res["pred_name"],
                              "confidence": res["confidence"], "topk": res["topk"],
                              "source": "single"})
    if options.get("similar"):
        res["similar"] = similar_news.recommend(text, res["pred_name"])
    return ok(res)


@bp.post("/batch")
def batch():
    """批量预测：对测试集（默认）或上传/传入的一批无标签文本。与『训练』不同——这里只做推理。"""
    if not _uid():
        return err("请先登录后再使用预测功能", 401)
    if not services.has_trained_model():
        return err("尚未训练模型，请先完成『模型训练』再批量预测。", 409)
    p = get_payload()
    source = p.get("source", "testset")
    model_key = p.get("model")
    try:
        if source == "texts":
            texts = p.get("texts") or []
            if not texts:
                return err("texts 为空")
            rows, summary = services.predict_texts(texts, model_key)
        else:  # testset
            limit = p.get("limit")
            rows, summary = services.predict_testset(model_key, limit=limit)
    except (RuntimeError, ValueError) as e:
        return err(str(e), 409)

    for r in rows[:200]:
        db.insert_prediction({"text": r["text"], "model": summary["model"],
                              "pred_label": r["pred_label"], "pred_name": r["pred_name"],
                              "confidence": r["confidence"], "topk": [], "source": "batch"})
    return ok({"rows": rows[:500], "summary": summary, "total_rows": len(rows)})


@bp.post("/batch-upload")
def batch_upload():
    """上传无标签文本文件（每行一条），做批量预测。"""
    if not _uid():
        return err("请先登录后再使用预测功能", 401)
    if not services.has_trained_model():
        return err("尚未训练模型，请先完成『模型训练』再批量预测。", 409)
    if "file" not in request.files:
        return err("未收到文件")
    f = request.files["file"]
    content = f.read().decode("utf-8", errors="replace")
    texts = [ln.strip() for ln in content.splitlines() if ln.strip()]
    if not texts:
        return err("文件中没有有效文本行")
    rows, summary = services.predict_texts(texts, request.form.get("model"))
    return ok({"rows": rows[:500], "summary": summary, "total_rows": len(rows)})


@bp.get("/history")
def history():
    limit = int(request.args.get("limit", 20))
    return ok({"history": db.list_predictions(limit)})


@bp.get("/distribution")
def distribution():
    """预测历史的类别分布（环形图）。"""
    preds = db.list_predictions(10000)
    counts = {}
    for p in preds:
        counts[p["pred_name"]] = counts.get(p["pred_name"], 0) + 1
    total = sum(counts.values()) or 1
    dist = sorted(({"name": k, "count": v, "ratio": round(v / total * 100, 2)}
                   for k, v in counts.items()), key=lambda x: x["count"], reverse=True)
    return ok({"distribution": dist, "total": sum(counts.values())})


@bp.get("/similar")
def similar():
    text = request.args.get("text", "").strip()
    if not text:
        return err("缺少 text")
    return ok(similar_news.recommend(text, request.args.get("category", "")))


@bp.get("/similar-detail")
def similar_detail():
    """抓取相似新闻详情，用简单 Markdown 返回标题、正文和网址。"""
    url = request.args.get("url", "").strip()
    title = request.args.get("title", "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return err("无效的网址")
    try:
        import requests
        resp = requests.get(url, timeout=12, headers={
            "User-Agent": "Mozilla/5.0 (compatible; NewsClassifier/1.0)"
        })
        resp.raise_for_status()
        raw = resp.text[:800000]
        raw = re.sub(r"(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<noscript[^>]*>.*?</noscript>", " ", raw)
        if not title:
            m = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
            title = re.sub(r"\s+", " ", unescape(m.group(1))).strip() if m else "相似新闻详情"
        text = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</h[1-6]>", "\n", raw)
        text = re.sub(r"(?is)<[^>]+>", " ", text)
        text = re.sub(r"[ \t\r\f\v]+", " ", unescape(text))
        lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) >= 8]
        body = "\n\n".join(lines)[:8000] or "未能从网页中提取到可读正文，请打开原链接查看。"
        return ok({"title": title or "相似新闻详情", "url": url,
                   "markdown": f"# {title or '相似新闻详情'}\n\n原文链接：{url}\n\n{body}"})
    except Exception as exc:  # noqa: BLE001
        return ok({"title": title or "相似新闻详情", "url": url,
                   "markdown": f"# {title or '相似新闻详情'}\n\n原文链接：{url}\n\n网页正文抓取失败：{exc}"})
