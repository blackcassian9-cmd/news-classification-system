"""数据集读取与解析。

数据格式：每行  文本<分隔符>标签   （THUCNews 子集为  文本\\t标签数字，标签 0-9）。

关键设计——绝不把"文本"和"标签"读反：
  1. 按"最后一个分隔符"切分（文本里可能含分隔符，标签恒在行尾一个整数）。
  2. 自动探测标签所在列：抽样若干行，判断标签更可能在行尾还是行首
     （标签是小范围整数，而文本通常很长、不是纯整数）。
  3. 校验标签必须是非负整数，超范围/缺失的行计入 skipped，不污染训练。
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

DELIMITER_MAP = {
    "tab": "\t",
    "\\t": "\t",
    "comma": ",",
    "space": " ",
    "semicolon": ";",
}


def _normalize_delimiter(delimiter: str) -> str:
    if delimiter is None:
        return "\t"
    return DELIMITER_MAP.get(str(delimiter).strip().lower(), delimiter)


def _looks_like_label(token: str) -> bool:
    token = token.strip()
    return token.isdigit() and len(token) <= 3  # 标签为 0-9（最多几十类），不会很长


@dataclass
class LoadReport:
    rows: List[Tuple[str, int]] = field(default_factory=list)
    total_lines: int = 0
    parsed: int = 0
    skipped: int = 0
    skipped_examples: List[str] = field(default_factory=list)
    label_position: str = "tail"   # tail=标签在行尾, head=标签在行首
    labels_seen: set = field(default_factory=set)

    @property
    def num_classes(self) -> int:
        return len(self.labels_seen)


def detect_label_position(lines: List[str], delimiter: str, sample: int = 200) -> str:
    """抽样判断标签在行尾还是行首，避免读反。"""
    tail_hits = head_hits = 0
    checked = 0
    for line in lines:
        line = line.rstrip("\n").rstrip("\r")
        if not line.strip():
            continue
        if delimiter not in line:
            continue
        head = line.split(delimiter, 1)[0]
        tail = line.rsplit(delimiter, 1)[-1]
        if _looks_like_label(tail):
            tail_hits += 1
        if _looks_like_label(head):
            head_hits += 1
        checked += 1
        if checked >= sample:
            break
    # 行尾优先（标准格式）；只有当行首明显更像标签时才判定为行首
    return "head" if head_hits > tail_hits else "tail"


def parse_lines(lines: List[str], delimiter: str = "\t",
                max_label: Optional[int] = None) -> LoadReport:
    delimiter = _normalize_delimiter(delimiter)
    rep = LoadReport()
    rep.label_position = detect_label_position(lines, delimiter)

    for raw in lines:
        rep.total_lines += 1
        line = raw.rstrip("\n").rstrip("\r")
        if not line.strip():
            rep.skipped += 1
            continue
        if delimiter not in line:
            rep.skipped += 1
            if len(rep.skipped_examples) < 5:
                rep.skipped_examples.append(line[:60])
            continue

        if rep.label_position == "tail":
            text, label_str = line.rsplit(delimiter, 1)
        else:
            label_str, text = line.split(delimiter, 1)

        label_str = label_str.strip()
        text = text.strip()
        if not _looks_like_label(label_str) or not text:
            rep.skipped += 1
            if len(rep.skipped_examples) < 5:
                rep.skipped_examples.append(line[:60])
            continue

        label = int(label_str)
        if max_label is not None and label > max_label:
            rep.skipped += 1
            continue

        rep.rows.append((text, label))
        rep.labels_seen.add(label)
        rep.parsed += 1

    return rep


def load_file(path: str, delimiter: str = "\t", encoding: str = "utf-8") -> LoadReport:
    with io.open(path, "r", encoding=encoding, errors="replace") as f:
        lines = f.readlines()
    # 去掉可能的 UTF-8 BOM
    if lines and lines[0].startswith("\ufeff"):
        lines[0] = lines[0].lstrip("\ufeff")
    return parse_lines(lines, delimiter=delimiter)


def split_texts_labels(rows: List[Tuple[str, int]]) -> Tuple[List[str], List[int]]:
    if not rows:
        return [], []
    texts, labels = zip(*rows)
    return list(texts), list(labels)
