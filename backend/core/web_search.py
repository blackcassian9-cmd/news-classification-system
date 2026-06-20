"""可插拔网页搜索适配器：为"相似新闻推荐"提供真实标题 + 真实可点链接。

相似新闻必须来自全网搜索（而非本地数据集）。Key 与 provider 由用户在『报告导出』页配置：
  settings.search_api_key   —— 搜索服务的 API Key
  settings.search_provider  —— serper（默认, serper.dev）/ bing / serpapi

任何一家都返回统一结构：{title, url, site, date}。相似度由上层用训练好的 TF-IDF 余弦计算。
"""
from __future__ import annotations

from typing import Dict, List

from db import database as db


def search_similar(text: str, category: str = "", num: int = 8) -> List[Dict]:
    provider = (db.get_setting("search_provider") or "serper").lower()
    key = (db.get_setting("search_api_key") or "").strip()
    if not key:
        raise RuntimeError("未配置网页搜索 API Key")
    query = _build_query(text, category)
    if provider == "serper":
        return _serper(query, key, num)
    if provider == "bing":
        return _bing(query, key, num)
    if provider == "serpapi":
        return _serpapi(query, key, num)
    raise RuntimeError(f"不支持的搜索 provider：{provider}（可选 serper / bing / serpapi）")


def _build_query(text: str, category: str) -> str:
    head = (text or "").strip().splitlines()[0][:40]
    return (head + (" " + category if category else "") + " 新闻").strip()


def _serper(query: str, key: str, num: int) -> List[Dict]:
    import requests
    resp = requests.post("https://google.serper.dev/news",
                         headers={"X-API-KEY": key, "Content-Type": "application/json"},
                         json={"q": query, "gl": "cn", "hl": "zh-cn", "num": num}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    items = [{"title": n.get("title"), "url": n.get("link"),
              "site": n.get("source", ""), "date": n.get("date", "")}
             for n in (data.get("news") or [])[:num] if n.get("title")]
    if not items:
        items = [{"title": n.get("title"), "url": n.get("link"),
                  "site": n.get("source", ""), "date": ""}
                 for n in (data.get("organic") or [])[:num] if n.get("title")]
    return items


def _bing(query: str, key: str, num: int) -> List[Dict]:
    import requests
    resp = requests.get("https://api.bing.microsoft.com/v7.0/news/search",
                        headers={"Ocp-Apim-Subscription-Key": key},
                        params={"q": query, "count": num, "mkt": "zh-CN"}, timeout=20)
    resp.raise_for_status()
    out = []
    for n in (resp.json().get("value") or [])[:num]:
        prov = (n.get("provider") or [{}])
        out.append({"title": n.get("name"), "url": n.get("url"),
                    "site": prov[0].get("name", "") if prov else "",
                    "date": (n.get("datePublished") or "")[:10]})
    return out


def _serpapi(query: str, key: str, num: int) -> List[Dict]:
    import requests
    resp = requests.get("https://serpapi.com/search",
                        params={"engine": "google", "q": query, "tbm": "nws",
                                "num": num, "api_key": key, "hl": "zh-cn", "gl": "cn"},
                        timeout=25)
    resp.raise_for_status()
    return [{"title": n.get("title"), "url": n.get("link"),
             "site": n.get("source", ""), "date": n.get("date", "")}
            for n in (resp.json().get("news_results") or [])[:num] if n.get("title")]
