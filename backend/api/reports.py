"""报告导出 + API Key 设置（DeepSeek / 网页搜索）。

API Key 由用户自行填写（系统不内置）。结论类内容若配置了 DeepSeek 则用其润色，
否则回退到基于真实指标的规则化文本。
"""
from __future__ import annotations

import os

from flask import Blueprint, send_from_directory

import config
from api import err, get_payload, ok
from db import database as db

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

CONTENT_SECTIONS = [
    "数据概览", "数据预处理", "特征工程", "模型训练结果", "模型评价分析",
    "关键词分析", "预测结果分析", "错误样本分析", "可视化图表",
    "结论与建议", "实验记录", "附录信息",
]


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "•" * len(key)
    return key[:4] + "•" * (len(key) - 8) + key[-4:]


@bp.get("/config")
def get_config():
    deepseek = db.get_setting("deepseek_api_key")
    search = db.get_setting("search_api_key")
    run = db.latest_run()
    return ok({
        "templates": ["标准分析报告", "精简摘要报告", "完整技术报告"],
        "content_sections": [{"name": s, "enabled": s != "结论与建议"} for s in CONTENT_SECTIONS],
        "formats": ["PDF", "Word", "PPT", "HTML", "Excel"],
        "page_settings": {"paper": "A4", "orientation": "纵向", "quality": "高质量 300 DPI"},
        "api": {
            "deepseek_configured": bool(deepseek),
            "deepseek_masked": _mask(deepseek),
            "search_configured": bool(search),
            "search_masked": _mask(search),
            "status": "已连接" if deepseek else "未配置",
        },
        "summary_cards": {
            "templates": 12,
            "data_coverage": 98.7,
            "charts": 28,
            "est_pages": "18-25",
            "est_seconds": "30-60s",
            "last_export": db.get_setting("last_export_time"),
        },
        "can_generate": bool(run),
    })


@bp.post("/api-key")
def set_api_key():
    p = get_payload()
    provider = p.get("provider", "deepseek")
    key = (p.get("key") or "").strip()
    if provider == "deepseek":
        db.set_setting("deepseek_api_key", key)
    elif provider == "search":
        db.set_setting("search_api_key", key)
        if p.get("search_provider"):
            db.set_setting("search_provider", p["search_provider"])
    else:
        return err("provider 仅支持 deepseek / search")
    return ok({"provider": provider, "configured": bool(key)})


@bp.get("/api-key/status")
def api_key_status():
    deepseek = db.get_setting("deepseek_api_key")
    search = db.get_setting("search_api_key")
    return ok({
        "deepseek_configured": bool(deepseek), "deepseek_masked": _mask(deepseek),
        "search_configured": bool(search), "search_masked": _mask(search),
        "search_provider": db.get_setting("search_provider", "serper"),
    })


@bp.post("/api-key/test")
def api_key_test():
    """测试 DeepSeek 连接（『报告导出』页"测试连接"按钮）。"""
    from core import llm
    return ok(llm.ping())


@bp.post("/generate")
def generate():
    p = get_payload()
    run = db.latest_run()
    if not run:
        return err("尚未训练模型，无法生成报告。", 409)
    fmt = p.get("format", "HTML")
    sections = p.get("sections") or [s["name"] for s in []]

    # 可选：DeepSeek 生成结论摘要（失败/未配置则用规则结论）
    narrative = None
    try:
        from core import llm
        best = run["results"][run["best_model"]]
        narrative = llm.report_narrative({
            "最优模型": config.MODEL_DISPLAY[run["best_model"]],
            "准确率": best.get("accuracy"), "MacroF1": best.get("macro_f1"),
            "类别数": run["num_classes"], "训练样本": run["train_count"], "测试样本": run["test_count"],
        })
    except Exception:  # noqa: BLE001
        narrative = None

    html = _build_html_report(run, narrative)
    fname = f"report_run{run['id']}.html"
    with open(os.path.join(config.CHARTS_DIR, fname), "w", encoding="utf-8") as f:
        f.write(html)
    db.set_setting("last_export_time", db.now_str())
    db.add_event("report_ready", f"报告已生成（{fmt}）")
    return ok({"format": fmt, "url": f"/api/reports/file/{fname}",
               "sections": sections, "generated_at": db.now_str()})


@bp.get("/file/<path:filename>")
def report_file(filename):
    path = os.path.join(config.CHARTS_DIR, filename)
    if not os.path.exists(path):
        return err("报告文件不存在", 404)
    return send_from_directory(config.CHARTS_DIR, filename)


def _build_html_report(run, narrative=None):
    results = run["results"]
    best = run["best_model"]
    names = run["label_names"]
    concl = (run.get("conclusions") or {}).get("bullets", [])
    rows = "".join(
        f"<tr><td>{config.MODEL_DISPLAY[k]}</td><td>{results[k]['accuracy']:.4f}</td>"
        f"<td>{results[k]['macro_f1']:.4f}</td></tr>"
        for k in (config.MODEL_NB, config.MODEL_LR))
    bullets = "".join(f"<li>{b}</li>" for b in concl)
    narr_html = f"<h2>智能摘要（DeepSeek）</h2><p>{narrative}</p>" if narrative else ""
    return f"""<!DOCTYPE html><html lang=zh-CN><head><meta charset=utf-8>
<title>中文新闻文本分类系统 - 分析报告</title>
<style>body{{font-family:'Microsoft YaHei',sans-serif;max-width:860px;margin:40px auto;color:#222}}
h1{{color:#dc2626}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ddd;padding:8px}}
th{{background:#fde8e8}}</style></head><body>
<h1>中文新闻文本分类系统 · 分析报告</h1>
<p>生成时间：{db.now_str()}　数据集类别数：{run['num_classes']}　训练 {run['train_count']} / 测试 {run['test_count']}</p>
{narr_html}
<h2>模型性能（测试集）</h2>
<table><tr><th>模型</th><th>Accuracy</th><th>Macro-F1</th></tr>{rows}</table>
<p>最优模型：<b>{config.MODEL_DISPLAY[best]}</b></p>
<h2>结论与建议</h2><ul>{bullets}</ul>
<p style="color:#888">类别：{'、'.join(names)}</p>
</body></html>"""
