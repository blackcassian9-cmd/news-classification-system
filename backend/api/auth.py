"""账号系统：注册 / 登录 / 退出 / 当前用户 / 用户 API Key。

要点：
  - 密码强制强校验：长度>=8 且同时包含 大写、小写、数字、特殊符号。
  - 密码只存哈希（werkzeug.security），绝不明文落库。
  - 用户信息与各自的 API Key 全部入库（users 表）。
  - 用 Flask session 维持登录态（同源 Cookie，签名防篡改）。
  - 登录/保存 Key 时把当前用户的 Key 镜像到全局 settings，供 LLM / 网页搜索模块读取；
    退出时清空全局 Key，保证“谁登录用谁的 Key”。
"""
from __future__ import annotations

import re

from flask import Blueprint, session
from werkzeug.security import check_password_hash, generate_password_hash

from api import err, get_payload, ok
from core import services
from db import database as db

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

_SPECIAL = r"""!@#$%^&*()_+-=[]{}|;:'\",.<>/?`~"""


def password_problems(pwd: str):
    """返回不满足的规则列表；为空表示通过。"""
    problems = []
    if len(pwd or "") < 8:
        problems.append("至少 8 位")
    if not re.search(r"[a-z]", pwd or ""):
        problems.append("需含小写字母")
    if not re.search(r"[A-Z]", pwd or ""):
        problems.append("需含大写字母")
    if not re.search(r"\d", pwd or ""):
        problems.append("需含数字")
    if not any(c in _SPECIAL for c in (pwd or "")):
        problems.append("需含特殊符号")
    return problems


def _public_user(u: dict) -> dict:
    return {
        "id": u["id"], "username": u["username"],
        "created_at": u.get("created_at"), "last_login": u.get("last_login"),
        "deepseek_configured": bool(u.get("deepseek_key")),
        "search_configured": bool(u.get("search_key")),
        "search_provider": u.get("search_provider") or "serper",
    }


def _apply_user_keys_to_settings(u: dict) -> None:
    """登录后把该用户的 Key 设为全局生效（LLM/搜索模块读取 settings），
    并标记 active_user_id —— 数据集/选中项等均按该用户隔离读写。"""
    db.set_setting("deepseek_api_key", u.get("deepseek_key") or "")
    db.set_setting("search_api_key", u.get("search_key") or "")
    db.set_setting("search_provider", u.get("search_provider") or "serper")
    db.set_setting("active_user", u.get("username") or "")
    db.set_setting("active_user_id", str(u.get("id") or ""))


def current_user():
    uid = session.get("uid")
    return db.get_user_by_id(uid) if uid else None


@bp.post("/register")
def register():
    p = get_payload()
    username = (p.get("username") or "").strip()
    password = p.get("password") or ""
    if not username or len(username) < 2:
        return err("用户名至少 2 个字符")
    if len(username) > 32:
        return err("用户名过长")
    problems = password_problems(password)
    if problems:
        return err("密码不符合安全要求：" + "、".join(problems))
    if db.get_user(username):
        return err("该用户名已被注册")
    uid = db.create_user(username, generate_password_hash(password))
    session["uid"] = uid
    u = db.get_user_by_id(uid)
    services.invalidate_cache()              # 切换账号：清空模型产物缓存
    _apply_user_keys_to_settings(u)          # 先置 active_user_id，事件才归属本人
    db.add_event("log", f"新用户注册并登录：{username}")
    return ok({"user": _public_user(u)})


@bp.post("/login")
def login():
    p = get_payload()
    username = (p.get("username") or "").strip()
    password = p.get("password") or ""
    u = db.get_user(username)
    if not u or not check_password_hash(u["pwd_hash"], password):
        return err("用户名或密码错误", 401)
    session["uid"] = u["id"]
    db.touch_user_login(u["id"])
    services.invalidate_cache()              # 切换账号：清空模型产物缓存
    _apply_user_keys_to_settings(u)
    db.add_event("log", f"用户登录：{username}")
    return ok({"user": _public_user(u)})


@bp.post("/logout")
def logout():
    session.pop("uid", None)
    services.invalidate_cache()              # 退出：清空模型产物缓存
    # 退出后清空全局 Key 与 active_user_id：恢复"未登录默认空白态"
    db.set_setting("deepseek_api_key", "")
    db.set_setting("search_api_key", "")
    db.set_setting("active_user", "")
    db.set_setting("active_user_id", "")
    return ok({"logged_out": True})


@bp.get("/me")
def me():
    u = current_user()
    return ok({"logged_in": bool(u), "user": _public_user(u) if u else None})


@bp.post("/api-keys")
def save_keys():
    """保存当前用户的 API Key（同时写入 users 表与全局 settings）。"""
    u = current_user()
    if not u:
        return err("请先登录后再配置 API Key", 401)
    p = get_payload()
    deepseek = p.get("deepseek_key")
    search = p.get("search_key")
    provider = p.get("search_provider")
    db.set_user_keys(u["id"],
                     deepseek_key=deepseek if deepseek is not None else None,
                     search_key=search if search is not None else None,
                     search_provider=provider if provider is not None else None)
    fresh = db.get_user_by_id(u["id"])
    _apply_user_keys_to_settings(fresh)
    return ok({"user": _public_user(fresh)})
