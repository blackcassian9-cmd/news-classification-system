"""DeepSeek 大模型客户端 + 规则兜底。

凡是前端"有结论"的地方都优先用 DeepSeek 润色（必须基于真实指标，禁止编造数字）；
未配置 Key 时回退到 core.conclusions 的规则化结论，保证永远可用、可离线运行。

API Key 由用户自行在『报告导出』页填写（存于 settings.deepseek_api_key），系统不内置。
接口走 DeepSeek 官方 OpenAI 兼容端点：POST {base}/chat/completions。
"""
from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

import config
from db import database as db

CHAT_PATH = "/chat/completions"


def get_key() -> str:
    return (db.get_setting("deepseek_api_key") or "").strip()


def available() -> bool:
    return bool(get_key())


def chat(messages: List[Dict], *, temperature: float = 0.5,
         max_tokens: int = 900, timeout: int = 40) -> str:
    key = get_key()
    if not key:
        raise RuntimeError("未配置 DeepSeek API Key")
    import requests
    url = config.DEEPSEEK_BASE_URL.rstrip("/") + CHAT_PATH
    body = {"model": config.DEEPSEEK_MODEL, "messages": messages,
            "temperature": temperature, "max_tokens": max_tokens, "stream": False}
    resp = requests.post(url, headers={"Authorization": f"Bearer {key}",
                                       "Content-Type": "application/json"},
                         data=json.dumps(body).encode("utf-8"), timeout=timeout)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def ping() -> Dict:
    """测试 Key 是否可用（供『报告导出』页"测试连接"用）。"""
    if not available():
        return {"ok": False, "message": "未配置 API Key"}
    try:
        out = chat([{"role": "user", "content": "回复 OK 两个字即可。"}],
                   max_tokens=8, timeout=20)
        return {"ok": True, "message": "连接成功", "sample": out.strip()[:20]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"连接失败：{e}"}


def _extract_json(content: str, as_list: bool = False):
    if not content:
        return None
    content = re.sub(r"```(?:json)?", "", content).strip().strip("`").strip()
    open_ch, close_ch = ("[", "]") if as_list else ("{", "}")
    i, j = content.find(open_ch), content.rfind(close_ch)
    if i == -1 or j == -1 or j < i:
        return None
    try:
        return json.loads(content[i:j + 1])
    except (ValueError, TypeError):
        return None


# -------------------- 结论润色 --------------------
def enhance_conclusions(concl: Dict, summary: Dict) -> Dict:
    """用真实指标喂给 DeepSeek，让它写"当前结论/提示语/部署建议"。失败则原样返回。"""
    if not available():
        return concl
    try:
        results = summary.get("results") or {}
        nb = results.get(config.MODEL_NB, {})
        lr = results.get(config.MODEL_LR, {})
        best_name = summary.get("best_model_name") or config.MODEL_DISPLAY.get(summary.get("best_model"))
        facts = {
            "最优模型": best_name,
            "朴素贝叶斯": {k: nb.get(k) for k in ("accuracy", "precision", "recall", "f1", "macro_f1", "auc")},
            "逻辑回归": {k: lr.get(k) for k in ("accuracy", "precision", "recall", "f1", "macro_f1", "auc")},
            "类别数": summary.get("num_classes"),
        }
        sys = ("你是严谨的机器学习实验分析助手。只能依据用户提供的真实指标进行分析，"
               "严禁编造任何数字或不存在的模型；本系统只有'朴素贝叶斯'和'逻辑回归'两个模型，"
               "深度学习仅用于调参。输出简洁、专业的中文。")
        usr = (f"以下是中文新闻文本分类系统两个模型在测试集上的真实指标(JSON)：\n"
               f"{json.dumps(facts, ensure_ascii=False)}\n\n"
               "请只输出严格 JSON：\n"
               '{"tip":"一句话总结哪个模型更优(<=40字)",'
               '"bullets":["结论1","结论2","结论3","结论4"],'
               '"recommend_reason":"推荐部署模型的一句话理由(<=40字)"}\n'
               "要求：bullets 恰好 4 条、每条 <=30 字、结合真实数值，指出最优模型、整体表现、"
               "改进建议。只输出 JSON，不要多余文字。")
        parsed = _extract_json(chat(
            [{"role": "system", "content": sys}, {"role": "user", "content": usr}],
            temperature=0.4, max_tokens=600))
        if parsed and parsed.get("bullets"):
            rec = dict(concl.get("recommend") or {})
            if parsed.get("recommend_reason"):
                rec["reason"] = parsed["recommend_reason"]
            return {**concl, "tip": parsed.get("tip") or concl.get("tip"),
                    "bullets": parsed["bullets"][:4], "recommend": rec, "source": "deepseek"}
    except Exception:  # noqa: BLE001
        pass
    return concl


def conclusions_text(bullets: List[str], context: str) -> Optional[List[str]]:
    """通用：给一段上下文，请 DeepSeek 给 4 条结论（评价页/优化页等复用）。失败返回 None。"""
    if not available():
        return None
    try:
        usr = (f"基于以下真实情况，用中文给出恰好 4 条简短结论，每条<=30字，"
               f"只输出 JSON 数组 [\"...\",\"...\",\"...\",\"...\"]：\n{context}")
        parsed = _extract_json(chat([{"role": "user", "content": usr}],
                                    temperature=0.4, max_tokens=400), as_list=True)
        if isinstance(parsed, list) and parsed:
            return [str(x) for x in parsed[:4]]
    except Exception:  # noqa: BLE001
        pass
    return bullets


# -------------------- 相似新闻（联想标题，链接可能不可点） --------------------
def similar_titles(text: str, category: str = "", num: int = 6) -> List[Dict]:
    sys = "你是新闻检索助手，熟悉中文主流新闻网站。"
    usr = (f"针对下面这条新闻，联想 {num} 条主题最相近的真实风格新闻标题（中文），"
           f"并给出可能的来源网站。新闻内容：{text[:400]}\n类别参考：{category}\n"
           '只输出严格 JSON 数组，每项形如 '
           '{"title":"标题","url":"https://来源网站域名","site":"来源站点名"}。'
           "若不确定具体链接，url 用该站点首页域名。只输出 JSON。")
    parsed = _extract_json(chat([{"role": "system", "content": sys},
                                 {"role": "user", "content": usr}],
                                temperature=0.7, max_tokens=700), as_list=True) or []
    items = []
    for it in parsed[:num]:
        if isinstance(it, dict) and it.get("title"):
            items.append({"title": it.get("title", ""), "url": it.get("url", ""),
                          "site": it.get("site", "")})
    return items


# -------------------- 报告智能摘要 --------------------
def report_narrative(facts: Dict) -> Optional[str]:
    if not available():
        return None
    try:
        usr = ("根据以下中文新闻分类实验的真实数据，写一段 150 字以内的中文报告结论摘要，"
               "专业、客观、不编造数字：\n" + json.dumps(facts, ensure_ascii=False))
        return chat([{"role": "user", "content": usr}], temperature=0.5, max_tokens=400).strip()
    except Exception:  # noqa: BLE001
        return None
