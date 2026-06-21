"""中文新闻文本分类系统 - 后端入口（Flask）。

职责：
  - 初始化数据库（空白启动：不内置任何数据集/模型，用户自行上传后训练）；
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


def _fresh_secret_key() -> str:
    """会话签名密钥：每次启动随机生成（不持久化）。
    目的：服务重启即让所有旧会话失效 —— 重开系统时回到"未登录默认空白态"，
    数据集列表归零；用户重新登录后才显示其名下的数据库。"""
    import secrets
    return secrets.token_hex(32)


def _reset_active_state() -> None:
    """启动时清空"当前登录用户"标记与全局 Key：保证重启后无人登录、数据为空。
    用户账号本身仍持久化在 users 表中，登录后即可恢复其数据。"""
    for k in ("active_user_id", "active_user", "deepseek_api_key", "search_api_key"):
        db.set_setting(k, "")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    # 允许携带 Cookie 的同源会话
    CORS(app, supports_credentials=True)
    db.init_db()
    app.secret_key = _fresh_secret_key()
    _reset_active_state()
    # 注意：默认空白启动——不内置任何数据集/模型。用户自行在『数据集管理』上传后训练。

    # 注册蓝图
    from api import register_blueprints
    register_blueprints(app)

    # ---- 托管前端（若 frontend/ 已生成） ----
    def _no_cache(resp):
        # 前端 HTML/JS 禁用浏览器缓存，确保改动后用户总能拿到最新代码（避免“改了不生效”）。
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    @app.route("/")
    def index():
        idx = os.path.join(config.FRONTEND_DIR, "index.html")
        if os.path.exists(idx):
            return _no_cache(send_from_directory(config.FRONTEND_DIR, "index.html"))
        return jsonify({"ok": True, "service": "中文新闻文本分类系统 后端",
                        "hint": "前端尚未生成，可直接调用 /api/* 接口；/api/health 自检。"})

    @app.route("/<path:filename>")
    def frontend_files(filename):
        if os.path.isdir(config.FRONTEND_DIR):
            target = os.path.join(config.FRONTEND_DIR, filename)
            if os.path.exists(target):
                return _no_cache(send_from_directory(config.FRONTEND_DIR, filename))
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
