"""数据集行缓存：按 文件路径+修改时间 缓存解析结果，避免预览/统计时反复读取大文件。"""
from __future__ import annotations

import os
from typing import List, Optional, Tuple

from core import data_loader

_CACHE = {}  # path -> (mtime, rows)


def get_rows(path: str, delimiter: str = "\t") -> List[Tuple[str, int]]:
    if not path or not os.path.exists(path):
        return []
    mtime = os.path.getmtime(path)
    cached = _CACHE.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    rep = data_loader.load_file(path, delimiter=delimiter)
    _CACHE[path] = (mtime, rep.rows)
    return rep.rows


def clear():
    _CACHE.clear()
