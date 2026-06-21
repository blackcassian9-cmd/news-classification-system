"""SQLite 持久化层。

为 11 个模块提供统一的数据存取：数据集、样本、训练运行、预测历史、
实验记录、参数优化记录、系统事件（运行状态时间线）、设置（含 API Key）。

设计为"每次操作打开一个连接"，对本系统的并发量足够安全简单。
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,                  -- 归属用户；未登录不可见（按用户隔离数据库）
    name         TEXT NOT NULL,
    dtype        TEXT NOT NULL,            -- train / test
    filename     TEXT,
    path         TEXT,
    sample_count INTEGER DEFAULT 0,
    num_classes  INTEGER DEFAULT 0,
    label_names  TEXT,                     -- json
    delimiter    TEXT DEFAULT 'tab',
    encoding     TEXT DEFAULT 'utf-8',
    in_db        INTEGER DEFAULT 1,
    status       TEXT DEFAULT '已入库',
    uploaded_at  TEXT
);

CREATE TABLE IF NOT EXISTS samples (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id   INTEGER,
    idx          INTEGER,
    text         TEXT,
    label        INTEGER,
    label_name   TEXT,
    clean_text   TEXT,
    length       INTEGER,
    data_type    TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_ds ON samples(dataset_id);
CREATE INDEX IF NOT EXISTS idx_samples_label ON samples(dataset_id, label);

CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,                  -- 归属用户；按用户隔离训练结果
    created_at    TEXT,
    status        TEXT DEFAULT 'completed',
    tfidf_params  TEXT,
    nb_params     TEXT,
    lr_params     TEXT,
    clean_rules   TEXT,
    train_count   INTEGER,
    test_count    INTEGER,
    num_classes   INTEGER,
    label_names   TEXT,
    results       TEXT,        -- json: 测试集指标 {nb:{...}, lr:{...}}（评价/总览页用）
    best_model    TEXT,
    feature_stats TEXT,
    conclusions   TEXT,        -- json: 由规则或大模型生成
    elapsed       REAL,
    extra         TEXT         -- json: 验证集指标 val_results / val_count / split_method 等
);

CREATE TABLE IF NOT EXISTS predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,                  -- 归属用户；按用户隔离预测历史
    created_at  TEXT,
    text        TEXT,
    model       TEXT,
    pred_label  INTEGER,
    pred_name   TEXT,
    confidence  REAL,
    topk        TEXT,
    source      TEXT          -- single / batch
);

CREATE TABLE IF NOT EXISTS experiments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,                  -- 归属用户；按用户隔离实验记录
    name        TEXT,
    model_type  TEXT,
    dataset     TEXT,
    accuracy    REAL,
    f1          REAL,
    macro_f1    REAL,
    status      TEXT,
    created_at  TEXT,
    description TEXT,
    params      TEXT,
    run_id      INTEGER
);

CREATE TABLE IF NOT EXISTS optimizations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,                  -- 归属用户；按用户隔离参数优化
    created_at  TEXT,
    objective   TEXT,
    status      TEXT,
    best_params TEXT,
    leaderboard TEXT,
    history     TEXT,
    importance  TEXT,
    elapsed     REAL,
    extra       TEXT         -- json: 完整优化结果（best_score/best_model/network_structure 等）
);

CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER,                  -- 归属用户；按用户隔离活动时间线
    ts       TEXT,
    kind     TEXT,          -- dataset_loaded / trained / visualized / report_ready / log ...
    message  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    pwd_hash        TEXT NOT NULL,
    deepseek_key    TEXT,
    search_key      TEXT,
    search_provider TEXT DEFAULT 'serper',
    created_at      TEXT,
    last_login      TEXT
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        _ensure_columns(conn, "runs", {"extra": "TEXT"})
        _ensure_columns(conn, "optimizations", {"extra": "TEXT"})
        _ensure_columns(conn, "datasets", {"user_id": "INTEGER"})
        # 按用户隔离：为历史业务表补 user_id（旧的无主数据将天然不可见）
        for _t in ("runs", "predictions", "experiments", "optimizations", "events"):
            _ensure_columns(conn, _t, {"user_id": "INTEGER"})
        _ensure_columns(conn, "users", {
            "deepseek_key": "TEXT", "search_key": "TEXT",
            "search_provider": "TEXT DEFAULT 'serper'", "last_login": "TEXT"})


def _ensure_columns(conn, table: str, columns: Dict[str, str]) -> None:
    """轻量迁移：为已存在的表补充缺失的列（SQLite 的 CREATE IF NOT EXISTS 不会加列）。"""
    existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for col, decl in columns.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _loads(text: Optional[str], default=None):
    if not text:
        return default
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return default


# -------------------- 事件 / 运行状态时间线 --------------------
def add_event(kind: str, message: str, user_id: Optional[int] = None) -> None:
    """写入活动时间线——按用户隔离。未登录(uid 为空)不记录。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return
    with get_conn() as conn:
        conn.execute("INSERT INTO events(user_id, ts, kind, message) VALUES(?,?,?,?)",
                     (uid, now_str(), kind, message))


def latest_event(kind: str, user_id: Optional[int] = None) -> Optional[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM events WHERE kind=? AND user_id=? ORDER BY id DESC LIMIT 1",
            (kind, uid)
        ).fetchone()
        return dict(row) if row else None


def recent_events(limit: int = 20, user_id: Optional[int] = None) -> List[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT ?", (uid, limit)
        ).fetchall()
        return [dict(r) for r in rows]


# -------------------- 设置（含 API Key） --------------------
def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default


def get_active_uid() -> Optional[int]:
    """当前已登录用户 id（登录时写入、退出/重启时清空）。未登录返回 None。"""
    v = get_setting("active_user_id")
    try:
        return int(v) if v else None
    except (ValueError, TypeError):
        return None


def get_selected_dataset(user_id: Optional[int] = None) -> Optional[str]:
    """当前选中数据集名称——按用户隔离。未登录返回 None。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    return get_setting(f"selected_dataset_name:{uid}")


def set_selected_dataset(name: str, user_id: Optional[int] = None) -> None:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return
    set_setting(f"selected_dataset_name:{uid}", name)


# -------------------- 数据集 --------------------
def insert_dataset(d: Dict) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO datasets(user_id,name,dtype,filename,path,sample_count,num_classes,
               label_names,delimiter,encoding,in_db,status,uploaded_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (d.get("user_id"), d.get("name"), d.get("dtype"), d.get("filename"), d.get("path"),
             d.get("sample_count", 0), d.get("num_classes", 0),
             _dumps(d.get("label_names", [])), d.get("delimiter", "tab"),
             d.get("encoding", "utf-8"), 1 if d.get("in_db", True) else 0,
             d.get("status", "已入库"), now_str()))
        return cur.lastrowid


def list_datasets(user_id: Optional[int] = None) -> List[Dict]:
    """按用户隔离：传入 user_id 用之，否则取当前登录用户；都没有则返回空列表。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM datasets WHERE user_id=? ORDER BY id DESC", (uid,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["label_names"] = _loads(d.get("label_names"), [])
            out.append(d)
        return out


def get_dataset(ds_id: int, user_id: Optional[int] = None) -> Optional[Dict]:
    """按用户隔离：默认仅返回当前登录用户拥有的数据集（防越权访问他人数据）。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM datasets WHERE id=? AND user_id=?", (ds_id, uid)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["label_names"] = _loads(d.get("label_names"), [])
        return d


def delete_dataset(ds_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM samples WHERE dataset_id=?", (ds_id,))
        conn.execute("DELETE FROM datasets WHERE id=?", (ds_id,))


def insert_samples(dataset_id: int, rows: List[Dict]) -> None:
    with get_conn() as conn:
        conn.executemany(
            """INSERT INTO samples(dataset_id,idx,text,label,label_name,clean_text,length,data_type)
               VALUES(?,?,?,?,?,?,?,?)""",
            [(dataset_id, r["idx"], r["text"], r["label"], r.get("label_name"),
              r.get("clean_text"), r.get("length"), r.get("data_type")) for r in rows])


def count_datasets(user_id: Optional[int] = None) -> Dict[str, int]:
    """按用户隔离统计；未登录全部为 0。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return {"datasets": 0, "train_files": 0, "test_files": 0, "total_samples": 0}
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM datasets WHERE user_id=?", (uid,)).fetchone()["c"]
        train = conn.execute("SELECT COUNT(*) c FROM datasets WHERE user_id=? AND dtype='train'", (uid,)).fetchone()["c"]
        test = conn.execute("SELECT COUNT(*) c FROM datasets WHERE user_id=? AND dtype='test'", (uid,)).fetchone()["c"]
        samples = conn.execute("SELECT COALESCE(SUM(sample_count),0) s FROM datasets WHERE user_id=?", (uid,)).fetchone()["s"]
        return {"datasets": total, "train_files": train, "test_files": test, "total_samples": samples}


def count_nonempty_business_tables(user_id: Optional[int] = None) -> int:
    """当前用户有数据的业务表数量（datasets/samples/runs/predictions/experiments/optimizations）。
    系统表(settings/users/events)不计入，因此空库=0、上传后=2、训练后更多。
    按用户隔离：未登录返回 0，不暴露他人/历史遗留数据。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return 0
    scoped = ["datasets", "runs", "predictions", "experiments", "optimizations"]
    n = 0
    with get_conn() as conn:
        for t in scoped:
            try:
                row = conn.execute(
                    f"SELECT 1 FROM {t} WHERE user_id=? LIMIT 1", (uid,)).fetchone()
                if row is not None:
                    n += 1
            except sqlite3.Error:
                pass
        # samples 归属于用户的数据集（无 user_id 列，按 dataset 归属判断）
        try:
            row = conn.execute(
                "SELECT 1 FROM samples s JOIN datasets d ON s.dataset_id=d.id "
                "WHERE d.user_id=? LIMIT 1", (uid,)).fetchone()
            if row is not None:
                n += 1
        except sqlite3.Error:
            pass
    return n


# -------------------- 训练运行 --------------------
def insert_run(summary: Dict, conclusions: Optional[Dict] = None,
               user_id: Optional[int] = None) -> int:
    uid = user_id if user_id is not None else get_active_uid()
    extra = {
        "val_results": summary.get("val_results"),
        "val_conclusions": summary.get("val_conclusions"),
        "val_count": summary.get("val_count"),
        "split_method": summary.get("split_method"),
        "val_ratio": summary.get("val_ratio"),
    }
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO runs(user_id,created_at,status,tfidf_params,nb_params,lr_params,clean_rules,
               train_count,test_count,num_classes,label_names,results,best_model,
               feature_stats,conclusions,elapsed,extra)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uid, now_str(), "completed", _dumps(summary.get("tfidf_params")),
             _dumps(summary.get("nb_params")), _dumps(summary.get("lr_params")),
             _dumps(summary.get("clean_rules")), summary.get("train_count"),
             summary.get("test_count"), summary.get("num_classes"),
             _dumps(summary.get("label_names")), _dumps(summary.get("results")),
             summary.get("best_model"), _dumps(summary.get("feature_stats")),
             _dumps(conclusions), summary.get("elapsed_seconds"), _dumps(extra)))
        return cur.lastrowid


def update_run_conclusions(run_id: int, conclusions: Dict) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE runs SET conclusions=? WHERE id=?", (_dumps(conclusions), run_id))


def list_runs(limit: int = 50, user_id: Optional[int] = None) -> List[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM runs WHERE user_id=? ORDER BY id DESC LIMIT ?", (uid, limit)).fetchall()
        return [_run_row(r) for r in rows]


def get_run(run_id: int, user_id: Optional[int] = None) -> Optional[Dict]:
    """按用户隔离：默认仅返回当前登录用户的训练结果（防越权按 ID 读取）。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM runs WHERE id=? AND user_id=?", (run_id, uid)).fetchone()
        return _run_row(row) if row else None


def latest_run(user_id: Optional[int] = None) -> Optional[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM runs WHERE user_id=? ORDER BY id DESC LIMIT 1", (uid,)).fetchone()
        return _run_row(row) if row else None


def previous_run(user_id: Optional[int] = None) -> Optional[Dict]:
    """倒数第二次运行，用于'较上次'对比。按用户隔离。"""
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM runs WHERE user_id=? ORDER BY id DESC LIMIT 2", (uid,)).fetchall()
        if len(rows) < 2:
            return None
        return _run_row(rows[1])


def _run_row(r) -> Dict:
    d = dict(r)
    for k in ("tfidf_params", "nb_params", "lr_params", "clean_rules",
              "label_names", "results", "feature_stats", "conclusions", "extra"):
        d[k] = _loads(d.get(k))
    d["extra"] = d.get("extra") or {}
    d["val_results"] = d["extra"].get("val_results")
    return d


# -------------------- 预测历史 --------------------
def insert_prediction(p: Dict, user_id: Optional[int] = None) -> int:
    uid = user_id if user_id is not None else get_active_uid()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO predictions(user_id,created_at,text,model,pred_label,pred_name,
               confidence,topk,source) VALUES(?,?,?,?,?,?,?,?,?)""",
            (uid, now_str(), p.get("text"), p.get("model"), p.get("pred_label"),
             p.get("pred_name"), p.get("confidence"), _dumps(p.get("topk")),
             p.get("source", "single")))
        return cur.lastrowid


def list_predictions(limit: int = 20, user_id: Optional[int] = None) -> List[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM predictions WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (uid, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["topk"] = _loads(d.get("topk"), [])
            out.append(d)
        return out


def count_predictions(user_id: Optional[int] = None) -> int:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return 0
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) c FROM predictions WHERE user_id=?", (uid,)).fetchone()["c"]


def prediction_stats(user_id: Optional[int] = None) -> Dict[str, int]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return {"today": 0, "week": 0, "total": 0}
    today = time.strftime("%Y-%m-%d")
    with get_conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) c FROM predictions WHERE user_id=?", (uid,)).fetchone()["c"]
        td = conn.execute(
            "SELECT COUNT(*) c FROM predictions WHERE user_id=? AND created_at LIKE ?",
            (uid, today + "%")).fetchone()["c"]
        week = conn.execute(
            "SELECT COUNT(*) c FROM predictions WHERE user_id=? "
            "AND created_at >= datetime('now','-7 day')", (uid,)
        ).fetchone()["c"]
    return {"today": td, "week": week, "total": total}


# -------------------- 实验记录 --------------------
def insert_experiment(e: Dict, user_id: Optional[int] = None) -> int:
    uid = user_id if user_id is not None else get_active_uid()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO experiments(user_id,name,model_type,dataset,accuracy,f1,macro_f1,
               status,created_at,description,params,run_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uid, e.get("name"), e.get("model_type"), e.get("dataset"), e.get("accuracy"),
             e.get("f1"), e.get("macro_f1"), e.get("status", "已完成"),
             e.get("created_at") or now_str(), e.get("description"),
             _dumps(e.get("params")), e.get("run_id")))
        return cur.lastrowid


def list_experiments(limit: int = 100, user_id: Optional[int] = None) -> List[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM experiments WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (uid, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["params"] = _loads(d.get("params"))
            out.append(d)
        return out


# -------------------- 参数优化记录 --------------------
def insert_optimization(o: Dict, user_id: Optional[int] = None) -> int:
    uid = user_id if user_id is not None else get_active_uid()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO optimizations(user_id,created_at,objective,status,best_params,
               leaderboard,history,importance,elapsed,extra)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (uid, now_str(), o.get("objective"), o.get("status", "completed"),
             _dumps(o.get("best_params")), _dumps(o.get("leaderboard")),
             _dumps(o.get("history")), _dumps(o.get("importance")), o.get("elapsed"),
             _dumps(o)))
        return cur.lastrowid


def list_optimizations(limit: int = 20, user_id: Optional[int] = None) -> List[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id,created_at,objective,status,elapsed FROM optimizations "
            "WHERE user_id=? ORDER BY id DESC LIMIT ?", (uid, limit)).fetchall()
        return [dict(r) for r in rows]


def latest_optimization(user_id: Optional[int] = None) -> Optional[Dict]:
    uid = user_id if user_id is not None else get_active_uid()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM optimizations WHERE user_id=? ORDER BY id DESC LIMIT 1",
            (uid,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ("best_params", "leaderboard", "history", "importance", "extra"):
            d[k] = _loads(d.get(k))
        # extra 里是完整结果，合并上来（补齐 best_score / best_model / network_structure 等）
        if isinstance(d.get("extra"), dict):
            merged = dict(d["extra"])
            merged.update({k: d[k] for k in ("id", "created_at") if d.get(k) is not None})
            return merged
        return d


# -------------------- 用户（账号系统） --------------------
def create_user(username: str, pwd_hash: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users(username, pwd_hash, created_at, last_login) VALUES(?,?,?,?)",
            (username, pwd_hash, now_str(), now_str()))
        return cur.lastrowid


def get_user(username: str) -> Optional[Dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> Optional[Dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None


def touch_user_login(user_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET last_login=? WHERE id=?", (now_str(), user_id))


def set_user_keys(user_id: int, *, deepseek_key: Optional[str] = None,
                  search_key: Optional[str] = None, search_provider: Optional[str] = None) -> None:
    sets, vals = [], []
    if deepseek_key is not None:
        sets.append("deepseek_key=?"); vals.append(deepseek_key)
    if search_key is not None:
        sets.append("search_key=?"); vals.append(search_key)
    if search_provider is not None:
        sets.append("search_provider=?"); vals.append(search_provider)
    if not sets:
        return
    vals.append(user_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", vals)


def count_users() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
