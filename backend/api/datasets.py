"""数据集管理：统计卡片、上传与校验、列表、分布、字段结构、数据库状态。"""
from __future__ import annotations

import os

from flask import Blueprint, request

import config
from api import err, get_payload, ok
from core import data_loader, preprocess
from db import database as db

bp = Blueprint("datasets", __name__, url_prefix="/api/datasets")


def _uid():
    """当前登录用户 id；未登录返回 None。数据集一律按用户隔离。"""
    from api.auth import current_user
    u = current_user()
    return u["id"] if u else None


@bp.get("")
def list_datasets():
    uid = _uid()
    if not uid:
        # 未登录：默认空白态，不展示任何数据集
        return ok({
            "stat_cards": {"dataset_count": 0, "train_files": 0, "test_files": 0,
                           "total_samples": 0, "db_status": "未登录", "last_upload": None},
            "list": [], "selected": None, "logged_in": False,
        })
    items = db.list_datasets(uid)
    counts = db.count_datasets(uid)
    last = items[0]["uploaded_at"] if items else None
    rows = []
    for d in items:
        rows.append({
            "id": d["id"], "name": d["name"], "dtype": d["dtype"],
            "type_label": "训练集" if d["dtype"] == "train" else "测试集",
            "sample_count": d["sample_count"], "num_classes": d["num_classes"],
            "uploaded_at": d["uploaded_at"], "status": d["status"],
        })
    return ok({
        "stat_cards": {
            "dataset_count": counts["datasets"],
            "train_files": counts["train_files"],
            "test_files": counts["test_files"],
            "total_samples": counts["total_samples"],
            "db_status": "正常",
            "last_upload": last,
        },
        "list": rows,
        "selected": db.get_selected_dataset(uid) or (rows[0]["name"] if rows else None),
        "logged_in": True,
    })


@bp.post("/upload")
def upload():
    """上传 train.txt / test.txt：解析、校验标签方向、可选写库。需登录。"""
    from api.auth import current_user
    u = current_user()
    if not u:
        return err("请先登录后再上传数据集", 401)
    uid = u["id"]
    if "file" not in request.files:
        return err("未收到文件（字段名应为 file）")
    f = request.files["file"]
    dtype = request.form.get("dtype", "train")
    name = request.form.get("name") or os.path.splitext(f.filename)[0]
    delimiter = request.form.get("delimiter", "tab")
    encoding = request.form.get("encoding", "utf-8")
    write_db = request.form.get("write_db", "true").lower() == "true"
    auto_validate = request.form.get("auto_validate", "true").lower() == "true"

    save_path = os.path.join(config.UPLOADS_DIR, f"{dtype}_{f.filename}")
    f.save(save_path)

    rep = data_loader.load_file(save_path, delimiter=delimiter, encoding=encoding)
    log = []
    if rep.parsed == 0:
        return err("解析后没有有效样本，请检查分隔符/编码/格式（应为 文本<分隔符>标签）")

    # 校验：标签方向 + 跳过统计
    if auto_validate:
        log.append({"ok": rep.label_position == "tail",
                    "msg": f"标签方向校验：检测到标签在{'行尾' if rep.label_position=='tail' else '行首'}（已据此正确解析）"})
        if rep.skipped:
            log.append({"ok": False, "msg": f"{rep.skipped} 行格式异常已跳过"})

    # 标签名按"标签值"可索引（即使样本里类别不从 0 连续，也能正确映射 label→类别名）
    need = (max(rep.labels_seen) + 1) if rep.labels_seen else rep.num_classes
    names = config.DEFAULT_LABEL_NAMES[:max(need, rep.num_classes)]
    ds_id = db.insert_dataset({
        "user_id": uid,
        "name": name, "dtype": dtype, "filename": f.filename, "path": save_path,
        "sample_count": rep.parsed, "num_classes": rep.num_classes,
        "label_names": names, "delimiter": delimiter, "encoding": encoding,
        "in_db": write_db, "status": "已入库" if write_db else "待校验",
    })

    if write_db:
        batch = []
        for i, (text, label) in enumerate(rep.rows):
            cleaned = preprocess.clean_text(text)
            batch.append({"idx": i, "text": text, "label": label,
                          "label_name": names[label] if label < len(names) else str(label),
                          "clean_text": cleaned, "length": len(text),
                          "data_type": dtype})
            if len(batch) >= 5000:
                db.insert_samples(ds_id, batch)
                batch = []
        if batch:
            db.insert_samples(ds_id, batch)
        log.append({"ok": True, "msg": f"已写入数据库 {rep.parsed} 条记录"})

    log.insert(0, {"ok": True, "msg": f"{f.filename} 导入成功，{rep.parsed} 条记录"})
    db.add_event("dataset_loaded", f"{f.filename} 导入成功（{rep.parsed} 条）")
    # 选中数据集以训练集为中心；上传测试集不抢占已有选择（按用户隔离）
    cur = db.get_selected_dataset(uid)
    if dtype == "train" or not cur:
        db.set_selected_dataset(name, uid)

    return ok({"dataset_id": ds_id, "parsed": rep.parsed, "skipped": rep.skipped,
               "num_classes": rep.num_classes, "label_position": rep.label_position,
               "label_names": names, "log": log})


@bp.delete("/<int:ds_id>")
def delete(ds_id):
    uid = _uid()
    if not uid:
        return err("请先登录", 401)
    if not db.get_dataset(ds_id, uid):     # 仅能删除自己名下的数据集
        return err("数据集不存在", 404)
    db.delete_dataset(ds_id)
    return ok({"deleted": ds_id})


@bp.get("/schema")
def schema():
    """字段结构列表：随『当前选中数据集』联动，描述里带该数据集的真实示例。"""
    from core import dataset_cache, preprocess
    uid = _uid()
    name = request.args.get("name") or db.get_selected_dataset(uid)
    items = db.list_datasets(uid) if uid else []
    ds = None
    if name:
        ds = next((d for d in items if d["name"] == name), None)
    if not ds:
        ds = items[0] if items else None

    example_text, example_label, example_clean, example_dtype = "—", "—", "—", "—"
    if ds and ds.get("path"):
        try:
            rows = dataset_cache.get_rows(ds["path"])
            if rows:
                t0, l0 = rows[0]
                names = ds.get("label_names") or config.DEFAULT_LABEL_NAMES
                example_text = (t0[:24] + "…") if len(t0) > 24 else t0
                example_label = f"{l0}（{names[l0] if l0 < len(names) else l0}）"
                example_clean = preprocess.clean_text(t0)[:24] or "—"
                example_dtype = ds["dtype"]
        except Exception:  # noqa: BLE001
            pass

    return ok({
        "dataset": (ds["name"] if ds else None),
        "has_data": ds is not None,
        "fields": [
            {"name": "text", "type": "TEXT", "desc": f"原始新闻文本内容（示例：{example_text}）"},
            {"name": "label", "type": "INTEGER", "desc": f"类别标签（示例：{example_label}）"},
            {"name": "data_type", "type": "TEXT", "desc": f"train / test（当前：{example_dtype}）"},
            {"name": "clean_text", "type": "TEXT", "desc": f"清洗后文本（示例：{example_clean}）"},
        ],
    })


@bp.get("/<int:ds_id>/rows")
def dataset_rows(ds_id):
    """整表预览：分页返回某数据集的样本，供前端滚动加载更多。"""
    from core import dataset_cache
    ds = db.get_dataset(ds_id, _uid())
    if not ds:
        return err("数据集不存在", 404)
    offset = max(0, int(request.args.get("offset", 0)))
    limit = min(500, int(request.args.get("limit", 100)))
    names = ds.get("label_names") or config.DEFAULT_LABEL_NAMES
    try:
        all_rows = dataset_cache.get_rows(ds["path"])
    except Exception as e:  # noqa: BLE001
        return err(f"读取数据集失败：{e}")
    total = len(all_rows)
    page = all_rows[offset:offset + limit]
    rows = [{
        "idx": offset + i + 1,
        "text": t,
        "label": l,
        "label_name": names[l] if l < len(names) else str(l),
    } for i, (t, l) in enumerate(page)]
    return ok({"rows": rows, "total": total, "offset": offset, "limit": limit,
               "name": ds["name"], "type_label": "训练集" if ds["dtype"] == "train" else "测试集"})


@bp.get("/distribution")
def distribution():
    """当前选中数据集的 训练/测试 占比（环形图）+ 概要。"""
    uid = _uid()
    name = request.args.get("name") or db.get_selected_dataset(uid)
    items = db.list_datasets(uid) if uid else []
    sel = next((d for d in items if d["name"] == name), None) if name else None
    train = next((d for d in items if d["dtype"] == "train"), None)
    test = next((d for d in items if d["dtype"] == "test"), None)
    if sel and sel["dtype"] == "train":
        train = sel
    elif sel and sel["dtype"] == "test":
        test = sel
    tr_n = train["sample_count"] if train else 0
    te_n = test["sample_count"] if test else 0
    total = tr_n + te_n or 1
    num_classes = max((d["num_classes"] for d in items), default=0)
    label_names = (train or test or {}).get("label_names", []) if (train or test) else []
    return ok({
        "name": name,
        "train_count": tr_n, "test_count": te_n, "num_classes": num_classes,
        "label_map_loaded": bool(label_names),
        "label_names": label_names,
        "donut": [
            {"name": "训练集", "count": tr_n, "ratio": round(tr_n / total * 100, 1)},
            {"name": "测试集", "count": te_n, "ratio": round(te_n / total * 100, 1)},
        ],
    })


@bp.get("/db-status")
def db_status():
    uid = _uid()
    has_data = bool(db.list_datasets(uid)) if uid else False
    # 未登录 / 该用户无数据：业务表计 0（不暴露他人/历史遗留数据）
    tables = db.count_nonempty_business_tables(uid) if has_data else 0
    size_mb = 0.0
    if has_data and os.path.exists(config.DB_PATH):
        size_mb = round(os.path.getsize(config.DB_PATH) / 1024 / 1024, 2)
    last = db.recent_events(1, uid)
    return ok({
        "connected": True, "engine": "SQLite",
        "tables": tables,
        "last_sync": (last[0]["ts"] if (last and has_data) else None),
        "storage_mb": size_mb,
    })


@bp.post("/select")
def select():
    uid = _uid()
    if not uid:
        return err("请先登录", 401)
    p = get_payload()
    name = p.get("name")
    if not name:
        return err("缺少 name")
    db.set_selected_dataset(name, uid)
    return ok({"selected": name})
