"""全局配置：路径、默认参数、标签映射。

所有运行期产物（SQLite 数据库、模型、上传文件、生成的图表）都放在 storage/ 下，
方便清理，也避免污染前端目录。
"""
from __future__ import annotations

import os

# ------- 基础路径 -------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)              # e:\课设
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")  # 接线后的前端副本（稍后生成）

STORAGE_DIR = os.path.join(BASE_DIR, "storage")
DB_PATH = os.path.join(STORAGE_DIR, "app.db")
MODELS_DIR = os.path.join(STORAGE_DIR, "models")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
DATASETS_DIR = os.path.join(STORAGE_DIR, "datasets")
CHARTS_DIR = os.path.join(STORAGE_DIR, "charts")

for _d in (STORAGE_DIR, MODELS_DIR, UPLOADS_DIR, DATASETS_DIR, CHARTS_DIR):
    os.makedirs(_d, exist_ok=True)

# ------- THUCNews 十分类默认标签映射（0-9） -------
# 该公开子集不含类别名文件，此映射为业界通用对应关系，可在数据集导入时被覆盖。
DEFAULT_LABEL_NAMES = [
    "财经",  # 0
    "房产",  # 1
    "股票",  # 2
    "教育",  # 3
    "科技",  # 4
    "社会",  # 5
    "时政",  # 6
    "体育",  # 7
    "游戏",  # 8
    "娱乐",  # 9
]

# ------- TF-IDF 默认参数（与前端展示一致，全部可被用户覆盖） -------
DEFAULT_TFIDF = {
    "analyzer": "char",        # char=字符 n-gram（单字/双字/三字），word=jieba 分词
    "ngram_min": 1,
    "ngram_max": 2,
    "min_df": 2,                # 过滤出现次数过少的特征
    "max_df": 0.95,             # 过滤过于常见、无区分度的特征
    "max_features": 100000,     # 限制特征数量
    "sublinear_tf": True,
    "use_idf": True,
    "smooth_idf": True,
    "norm": "l2",
}

# ------- 模型默认超参 -------
DEFAULT_NB = {"alpha": 0.5, "fit_prior": True}
DEFAULT_LR = {"C": 1.0, "max_iter": 2000, "solver": "liblinear"}

DEFAULT_RANDOM_STATE = 617
DEFAULT_VAL_RATIO = 0.2

# ------- 模型标识 -------
MODEL_NB = "nb"   # 多项式朴素贝叶斯
MODEL_LR = "lr"   # 逻辑回归
MODEL_DISPLAY = {MODEL_NB: "朴素贝叶斯", MODEL_LR: "逻辑回归"}

# ------- DeepSeek（用户自带 Key，默认走官方兼容接口） -------
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
