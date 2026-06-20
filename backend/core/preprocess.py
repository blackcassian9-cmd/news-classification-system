"""中文文本基础清洗。

原则：只做"基础清洗"，不过度处理，保留语义。
  - 去多余空白、去异常/控制字符；
  - 保留中文、英文、数字、以及必要的中英文标点；
  - 不做停用词删除、不做分词（分词交给 TF-IDF 的 word analyzer 可选项）。

每条规则都可开关，对应前端"数据预览与清洗"页的 6 条规则。
"""
from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Tuple

# 允许保留的字符：中日韩统一表意文字 + 英文字母 + 数字 + 常用中英文标点 + 空格
_KEEP_PATTERN = re.compile(
    r"[^"
    r"\u4e00-\u9fff"          # 基本汉字
    r"\u3400-\u4dbf"          # 扩展 A 汉字
    r"a-zA-Z0-9"              # 英文与数字
    r"，。！？、；：“”‘’（）《》【】%·—…．"  # 常用中文标点
    r".,!?;:\"'()\[\]%/\-+&@#"  # 常用英文标点
    r"\s"                      # 空白（稍后统一压缩）
    r"]+"
)

_WHITESPACE = re.compile(r"\s+")


def _remove_control_chars(text: str) -> str:
    return "".join(
        ch for ch in text
        if ch in ("\t", " ") or unicodedata.category(ch)[0] != "C"
    )


DEFAULT_RULES = {
    "strip_whitespace": True,   # 去除多余空白符
    "remove_abnormal": True,    # 去除异常/控制字符
    "keep_allowed": True,       # 仅保留中文/英文/数字/常用标点
    "drop_empty": True,         # 删除空文本
    "drop_duplicate": True,     # 删除重复文本
    "min_length": 2,            # 过滤长度 < 2（设为 0 表示不过滤）
}


def clean_text(text: str, rules: Dict = None) -> str:
    rules = {**DEFAULT_RULES, **(rules or {})}
    if text is None:
        return ""
    s = str(text)
    if rules.get("remove_abnormal", True):
        s = _remove_control_chars(s)
    if rules.get("keep_allowed", True):
        s = _KEEP_PATTERN.sub(" ", s)
    if rules.get("strip_whitespace", True):
        s = _WHITESPACE.sub(" ", s).strip()
    return s


def clean_dataset(texts: List[str], labels: List[int], rules: Dict = None) -> Tuple[List[str], List[int], Dict]:
    """对一批文本做清洗，返回 (清洗后文本, 对应标签, 统计信息)。"""
    rules = {**DEFAULT_RULES, **(rules or {})}
    out_texts: List[str] = []
    out_labels: List[int] = []
    seen = set()

    stats = {
        "total": len(texts),
        "removed_empty": 0,
        "removed_duplicate": 0,
        "removed_short": 0,
        "kept": 0,
        "avg_len_before": 0.0,
        "avg_len_after": 0.0,
    }
    if texts:
        stats["avg_len_before"] = round(sum(len(t or "") for t in texts) / len(texts), 1)

    min_len = int(rules.get("min_length", 0) or 0)
    for text, label in zip(texts, labels):
        cleaned = clean_text(text, rules)
        if rules.get("drop_empty", True) and not cleaned:
            stats["removed_empty"] += 1
            continue
        if min_len and len(cleaned) < min_len:
            stats["removed_short"] += 1
            continue
        if rules.get("drop_duplicate", True):
            if cleaned in seen:
                stats["removed_duplicate"] += 1
                continue
            seen.add(cleaned)
        out_texts.append(cleaned)
        out_labels.append(label)

    stats["kept"] = len(out_texts)
    if out_texts:
        stats["avg_len_after"] = round(sum(len(t) for t in out_texts) / len(out_texts), 1)
    stats["retain_rate"] = round(stats["kept"] / stats["total"] * 100, 2) if stats["total"] else 0.0
    return out_texts, out_labels, stats
