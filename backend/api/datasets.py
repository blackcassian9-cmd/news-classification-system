"""数据集管理：统计卡片、上传与校验、列表、分布、字段结构、数据库状态。"""
from __future__ import annotations

import os

from flask import Blueprint, request

import config
from api import err, get_payload, ok
from core import data_loader, preprocess
from db import database as db

bp = Blueprint("datasets", __name__, url_prefix="/api/datasets")


@bp.get("")
def list_datasets():
    items = db.list_datasets()
    counts = db.count_datasets()
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
        "selected": db.get_setting("selected_dataset_name", rows[0]["name"] if rows else None),
    })


@bp.post("/upload")
def upload():
    """上传 train.txt / test.txt：解析、校验标签方向、可选写库。"""
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

    names = config.DEFAULT_LABEL_NAMES[:rep.num_classes]
    ds_id = db.insert_dataset({
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
    db.set_setting("selected_dataset_name", name)

    return ok({"dataset_id": ds_id, "parsed": rep.parsed, "skipped": rep.skipped,
               "num_classes": rep.num_classes, "label_position": rep.label_position,
               "label_names": names, "log": log})


@bp.delete("/<int:ds_id>")
def delete(ds_id):
    if not db.get_dataset(ds_id):
        return err("数据集不存在", 404)
    db.delete_dataset(ds_id)
    return ok({"deleted": ds_id})


@bp.get("/schema")
def schema():
    return ok({"fields": [
        {"name": "text", "type": "TEXT", "desc": "原始新闻文本内容"},
        {"name": "label", "type": "INTEGER", "desc": "类别标签（0-9）"},
        {"name": "data_type", "type": "TEXT", "desc": "train / test"},
        {"name": "clean_text", "type": "TEXT", "desc": "清洗后的文本内容"},
    ]})


@bp.get("/distribution")
def distribution():
    """当前选中数据集的 训练/测试 占比（环形图）+ 概要。"""
    name = request.args.get("name") or db.get_setting("selected_dataset_name")
    items = db.list_datasets()
    if name:
        items = [d for d in items if d["name"] == name] or items
    train = next((d for d in items if d["dtype"] == "train"), None)
    test = next((d for d in items if d["dtype"] == "test"), None)
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
    size_mb = round(os.path.getsize(config.DB_PATH) / 1024 / 1024, 2) if os.path.exists(config.DB_PATH) else 0.0
    last = db.recent_events(1)
    return ok({
        "connected": True, "engine": "SQLite", "tables": 8,
        "last_sync": last[0]["ts"] if last else None,
        "storage_mb": size_mb,
    })


@bp.post("/select")
def select():
    p = get_payload()
    name = p.get("name")
    if not name:
        return err("缺少 name")
    db.set_setting("selected_dataset_name", name)
    return ok({"selected": name})
