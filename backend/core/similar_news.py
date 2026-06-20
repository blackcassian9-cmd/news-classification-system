"""相似新闻推荐（可插拔）。

要求：相似新闻必须来自"全网搜索"，而不是本地数据集，且标题可点开真实链接。
实现策略（按优先级）：
  1) 若配置了网页搜索 API（search_api_key）：真实搜索 → 真实标题 + 真实链接（"爬取"）。
  2) 否则若配置了 DeepSeek Key：用大模型联想相近标题（链接可能不可点，会如实标注）。
  3) 都没配置：返回提示，引导用户去『报告导出』页填写 Key。

本文件先提供框架与第 2/3 条；第 1 条网页搜索在 LLM 步骤接入。
"""
from __future__ import annotations

from typing import Dict

from db import database as db


def recommend(text: str, category: str = "") -> Dict:
    search_key = db.get_setting("search_api_key")
    deepseek_key = db.get_setting("deepseek_api_key")

    if search_key:
        try:
            from core import web_search
            items = web_search.search_similar(text, category)
            items = _attach_similarity(text, items)
            return {"items": items, "source": "search", "provider": db.get_setting("search_provider", "serper"),
                    "note": "结果来自全网搜索，标题与链接真实可点。相似度由 TF-IDF 余弦计算。"}
        except Exception as e:  # noqa: BLE001
            return {"items": [], "source": "error", "note": f"网页搜索失败：{e}"}

    if deepseek_key:
        try:
            from core import llm
            items = _attach_similarity(text, llm.similar_titles(text, category))
            return {"items": items, "source": "llm",
                    "note": "标题由大模型联想生成；如需真实可点链接，请在『报告导出』页配置网页搜索 API Key。"}
        except Exception as e:  # noqa: BLE001
            return {"items": [], "source": "error", "note": f"大模型调用失败：{e}"}

    return {"items": [], "source": "none",
            "note": "相似新闻需要联网能力：请在『报告导出』页填写网页搜索 API Key（真实链接）"
                    "或 DeepSeek API Key（联想标题）。"}


def _attach_similarity(text: str, items):
    """用训练好的 TF-IDF 计算输入新闻与各候选标题的余弦相似度（不依赖本地数据集内容）。"""
    if not items:
        return items
    try:
        import numpy as np

        from core import preprocess, services
        art = services.get_artifacts()
        if not art:
            for it in items:
                it.setdefault("similarity", None)
            return items
        vec = art["vectorizer"]
        base = vec.transform([preprocess.clean_text(text)])
        mat = vec.transform([preprocess.clean_text(it.get("title", "")) for it in items])
        sims = (mat @ base.T).toarray().ravel()  # TF-IDF 已 L2 归一化，点积即余弦
        for it, s in zip(items, sims):
            it["similarity"] = round(float(s) * 100, 2)
        items.sort(key=lambda x: x.get("similarity") or 0, reverse=True)
    except Exception:  # noqa: BLE001
        for it in items:
            it.setdefault("similarity", None)
    return items
