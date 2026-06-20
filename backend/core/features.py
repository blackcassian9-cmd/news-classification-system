"""TF-IDF 特征提取。

支持前端"TF-IDF 特征提取"页的全部参数：
  analyzer / ngram_range / min_df / max_df / max_features /
  sublinear_tf / use_idf / smooth_idf / norm。

analyzer:
  - char : 字符 n-gram（单字/双字/三字），无需分词，契合"不过度分词"。
  - word : 先用 jieba 分词再做词 n-gram。
"""
from __future__ import annotations

from typing import Dict, List

from sklearn.feature_extraction.text import TfidfVectorizer

import config


def _jieba_tokenizer(text: str) -> List[str]:
    import jieba
    return [w for w in jieba.lcut(text) if w.strip()]


def build_vectorizer(params: Dict = None) -> TfidfVectorizer:
    p = {**config.DEFAULT_TFIDF, **(params or {})}
    analyzer = p.get("analyzer", "char")
    ngram_range = (int(p.get("ngram_min", 1)), int(p.get("ngram_max", 2)))

    kwargs = dict(
        ngram_range=ngram_range,
        min_df=int(p.get("min_df", 2)),
        max_df=float(p.get("max_df", 0.95)),
        max_features=int(p["max_features"]) if p.get("max_features") else None,
        sublinear_tf=bool(p.get("sublinear_tf", True)),
        use_idf=bool(p.get("use_idf", True)),
        smooth_idf=bool(p.get("smooth_idf", True)),
        norm=p.get("norm", "l2"),
    )

    if analyzer == "word":
        # word 模式：用 jieba 分词，关闭默认的 token_pattern
        kwargs["analyzer"] = "word"
        kwargs["tokenizer"] = _jieba_tokenizer
        kwargs["token_pattern"] = None
    else:
        # char 模式：字符 n-gram，无需 token_pattern（传了会告警）
        kwargs["analyzer"] = "char"

    return TfidfVectorizer(**kwargs)


def feature_type_breakdown(vectorizer: TfidfVectorizer) -> Dict[str, int]:
    """统计特征中单字/双字/三字/四字及以上的数量（用于前端特征类型环形图）。"""
    counts = {"单字": 0, "双字": 0, "三字": 0, "四字及以上": 0}
    try:
        vocab = vectorizer.get_feature_names_out()
    except Exception:
        return counts
    for feat in vocab:
        n = len(feat.replace(" ", ""))
        if n <= 1:
            counts["单字"] += 1
        elif n == 2:
            counts["双字"] += 1
        elif n == 3:
            counts["三字"] += 1
        else:
            counts["四字及以上"] += 1
    return counts


def matrix_stats(matrix) -> Dict:
    """稀疏矩阵的基本统计（维度、稀疏度、平均非零特征数等）。"""
    n_rows, n_cols = matrix.shape
    nnz = matrix.nnz
    total = n_rows * n_cols
    nonzero_per_row = matrix.getnnz(axis=1) if n_rows else []
    return {
        "n_samples": n_rows,
        "n_features": n_cols,
        "nnz": int(nnz),
        "sparsity": round((1 - nnz / total) * 100, 2) if total else 0.0,
        "avg_nonzero": round(float(nonzero_per_row.mean()), 1) if n_rows else 0.0,
        "max_nonzero": int(nonzero_per_row.max()) if n_rows else 0,
        "min_nonzero": int(nonzero_per_row.min()) if n_rows else 0,
    }
