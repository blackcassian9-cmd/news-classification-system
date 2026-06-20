"""中文新闻文本分类系统 - 后端入口（Flask）。

职责：
  - 初始化数据库；首次启动时登记内置 THUCNews 数据集（便于开箱即用）；
  - 注册所有 API 蓝图（/api/...）；
  - 同时托管前端静态页（frontend/），实现同源、零跨域；
  - 统一的 JSON 错误处理。
运行： python backend/app.py   （默认 http://127.0.0.1:5000）
"""
from __future__ import annotations

import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

import config
from db import database as db


def _seed_builtin_dataset() -> None:
    """首启动且库内无数据集时，登记内置 THUCNews（仅登记元数据，不入样本，启动快）。"""
    if db.list_datasets():
        return
    base = os.path.join(config.DATASETS_DIR, "thucnews")
    train_p = os.path.join(base, "train.txt")
    test_p = os.path.join(base, "test.txt")
    if not (os.path.exists(train_p) and os.path.exists(test_p)):
        return
    from core import data_loader
    tr = data_loader.load_file(train_p)
    te = data_loader.load_file(test_p)
    names = config.DEFAULT_LABEL_NAMES[:max(tr.num_classes, te.num_classes)]
    db.insert_dataset({"name": "THUCNews-轻量版", "dtype": "train", "filename": "train.txt",
                       "path": train_p, "sample_count": tr.parsed, "num_classes": tr.num_classes,
                       "label_names": names, "status": "已入库"})
    db.insert_dataset({"name": "THUCNews-轻量版", "dtype": "test", "filename": "test.txt",
                       "path": test_p, "sample_count": te.parsed, "num_classes": te.num_classes,
                       "label_names": names, "status": "已入库"})
    db.add_event("dataset_loaded", f"内置数据集已登记：训练 {tr.parsed} 条 / 测试 {te.parsed} 条")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    CORS(app)
    db.init_db()
    _seed_builtin_dataset()

    # 注册蓝图
    from api import register_blueprints
    register_blueprints(app)

    # ---- 托管前端（若 frontend/ 已生成） ----
    @app.route("/")
    def index():
        idx = os.path.join(config.FRONTEND_DIR, "index.html")
        if os.path.exists(idx):
            return send_from_directory(config.FRONTEND_DIR, "index.html")
        return jsonify({"ok": True, "service": "中文新闻文本分类系统 后端",
                        "hint": "前端尚未生成，可直接调用 /api/* 接口；/api/health 自检。"})

    @app.route("/<path:filename>")
    def frontend_files(filename):
        if os.path.isdir(config.FRONTEND_DIR):
            target = os.path.join(config.FRONTEND_DIR, filename)
            if os.path.exists(target):
                return send_from_directory(config.FRONTEND_DIR, filename)
        return jsonify({"error": "not found", "path": filename}), 404

    @app.route("/api/health")
    def health():
        from core import services
        return jsonify({"ok": True, "trained": services.has_trained_model(),
                        "datasets": db.count_datasets()})

    @app.errorhandler(400)
    @app.errorhandler(404)
    @app.errorhandler(500)
    def handle_err(e):
        code = getattr(e, "code", 500)
        return jsonify({"error": getattr(e, "description", str(e)), "code": code}), code

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("APP_PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True, use_reloader=False)
