"""报告导出 + API Key 设置（DeepSeek / 网页搜索）。

报告全部基于后台真实结果/日志生成：
  - /config   返回真实统计卡（未训练时全 0）、模板、章节、范围、页面设置、格式；
  - /preview  按模板深度 + 勾选章节 + 数据范围，组装 Markdown 在线预览；
  - /generate 同上组装 Markdown，并调用 DeepSeek 写"智能分析"，再转 PDF / Word / HTML 下载。

转换：Markdown → HTML（python-markdown）→ PDF（xhtml2pdf + reportlab 内置 CJK 字体
STSong-Light，纯 pip、无需系统字体）/ Word(.doc，Word 可直接打开的 HTML) / HTML。
DeepSeek Key 由用户在本页填写，系统不内置；未配置时回退规则化文字，保证可离线运行。
"""
from __future__ import annotations

import io
import os
from datetime import datetime

from flask import Blueprint, request, send_file

import config
from api import err, get_payload, ok
from core import llm
from db import database as db

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

CONTENT_SECTIONS = [
    "数据概览", "数据预处理", "特征工程", "模型训练结果", "模型评价分析",
    "关键词分析", "预测结果分析", "错误样本分析", "可视化图表",
    "结论与建议", "实验记录", "附录信息",
]
DEFAULT_ENABLED = {"数据概览", "数据预处理", "特征工程", "模型训练结果",
                   "模型评价分析", "可视化图表", "结论与建议"}
TEMPLATES = ["标准分析报告", "精简摘要报告", "完整技术报告"]
SCOPES = ["全部数据", "训练集", "测试集"]
PAPERS = ["A4", "A3", "A5"]
QUALITIES = ["300 DPI", "600 DPI"]
FORMATS = ["PDF", "Word", "HTML"]
PAPER_SIZE = {"A4": "210 × 297mm", "A3": "297 × 420mm", "A5": "148 × 210mm"}


# ------------------------------------------------------------------ 工具
def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "•" * len(key)
    return key[:4] + "•" * (len(key) - 8) + key[-4:]


def _fmtv(key: str, v) -> str:
    if v is None:
        return "—"
    try:
        if key in ("f1", "macro_f1", "auc"):
            return f"{float(v):.3f}"
        return f"{float(v) * 100:.2f}%"
    except (TypeError, ValueError):
        return str(v)


def _count_charts() -> int:
    try:
        return len([f for f in os.listdir(config.CHARTS_DIR)
                    if f.lower().endswith(".png")])
    except OSError:
        return 0


def _available_sections(run) -> list:
    """根据真实数据判断哪些章节"有内容"（用于数据覆盖率）。"""
    if not run:
        return []
    avail = ["数据概览", "数据预处理", "特征工程", "模型训练结果",
             "模型评价分析", "可视化图表", "结论与建议", "实验记录", "附录信息"]
    if db.count_predictions() > 0:
        avail += ["预测结果分析"]
    return avail


# ------------------------------------------------------------------ 配置
@bp.get("/config")
def get_config():
    deepseek = db.get_setting("deepseek_api_key")
    search = db.get_setting("search_api_key")
    run = db.latest_run()
    trained = bool(run)
    avail = _available_sections(run)
    charts = _count_charts()
    coverage = round(len(avail) / len(CONTENT_SECTIONS) * 100, 1) if trained else 0
    return ok({
        "templates": TEMPLATES,
        "content_sections": [{"name": s, "enabled": s in DEFAULT_ENABLED} for s in CONTENT_SECTIONS],
        "scopes": SCOPES,
        "formats": FORMATS,
        "papers": [{"key": p, "label": f"{p} ({PAPER_SIZE[p]})"} for p in PAPERS],
        "qualities": QUALITIES,
        "api": {
            "deepseek_configured": bool(deepseek),
            "deepseek_masked": _mask(deepseek),
            "search_configured": bool(search),
            "search_masked": _mask(search),
            "status": "已连接" if deepseek else "未配置",
        },
        "summary_cards": {
            "templates": len(TEMPLATES) if trained else 0,
            "data_coverage": coverage,
            "charts": charts if trained else 0,
            "est_pages": "—" if not trained else ("3-6" if not deepseek else "8-20"),
            "est_seconds": "—" if not trained else ("30-60s" if deepseek else "3-8s"),
            "last_export": db.get_setting("last_export_time"),
        },
        "trained": trained,
        "current_dataset": db.get_selected_dataset(),
        "server_time": db.now_str(),
        "can_generate": True,
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

    try:
        from api.auth import current_user
        u = current_user()
        if u:
            if provider == "deepseek":
                db.set_user_keys(u["id"], deepseek_key=key)
            else:
                db.set_user_keys(u["id"], search_key=key,
                                 search_provider=p.get("search_provider"))
    except Exception:  # noqa: BLE001
        pass
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
    return ok(llm.ping())


# ------------------------------------------------------------------ 预览 / 生成
@bp.post("/preview")
def preview():
    p = get_payload()
    run = db.latest_run()
    md = _build_markdown(run, _opts(p))
    return ok({"markdown": md, "trained": bool(run)})


@bp.post("/generate")
def generate():
    p = get_payload()
    run = db.latest_run()
    opts = _opts(p)
    fmt = (p.get("format") or "HTML").upper()
    md = _build_markdown(run, opts)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    rid = run["id"] if run else 0
    base = f"report_run{rid}_{stamp}"
    paper = opts["paper"]

    try:
        if fmt == "PDF":
            html = _md_to_html(md, paper, for_pdf=True)
            content = _html_to_pdf(html)
            fname = base + ".pdf"
            with open(os.path.join(config.CHARTS_DIR, fname), "wb") as f:
                f.write(content)
        elif fmt in ("WORD", "DOC", "DOCX"):
            html = _md_to_html(md, paper, for_pdf=False)
            fname = base + ".doc"
            with open(os.path.join(config.CHARTS_DIR, fname), "w", encoding="utf-8") as f:
                f.write(_html_to_doc(html))
        else:  # HTML
            html = _md_to_html(md, paper, for_pdf=False)
            fname = base + ".html"
            with open(os.path.join(config.CHARTS_DIR, fname), "w", encoding="utf-8") as f:
                f.write(html)
    except Exception as exc:  # noqa: BLE001
        return err(f"报告生成失败：{exc}", 500)

    db.set_setting("last_export_time", db.now_str())
    db.add_event("report_ready", f"报告已生成（{fmt} · {opts['template']}）")
    return ok({"format": fmt, "filename": fname,
               "url": f"/api/reports/file/{fname}", "generated_at": db.now_str()})


@bp.get("/file/<path:filename>")
def report_file(filename):
    path = os.path.join(config.CHARTS_DIR, filename)
    if not os.path.exists(path):
        return err("报告文件不存在", 404)
    return send_file(path, as_attachment=True, download_name=filename)


# ------------------------------------------------------------------ 选项解析
def _opts(p: dict) -> dict:
    sections = p.get("sections")
    if not sections:
        sections = [s for s in CONTENT_SECTIONS if s in DEFAULT_ENABLED]
    template = p.get("template") if p.get("template") in TEMPLATES else "标准分析报告"
    scope = p.get("scope") if p.get("scope") in SCOPES else "全部数据"
    paper = p.get("paper") if p.get("paper") in PAPERS else "A4"
    return {
        "template": template,
        "sections": [s for s in CONTENT_SECTIONS if s in sections],  # 保持固定顺序
        "scope": scope,
        "paper": paper,
        "quality": p.get("quality") or "300 DPI",
        "detail_table": bool(p.get("detail_table", True)),
    }


# ------------------------------------------------------------------ Markdown 组装
def _build_markdown(run, opts: dict) -> str:
    template, sections = opts["template"], opts["sections"]
    scope, detail = opts["scope"], opts["detail_table"]
    full = template == "完整技术报告"
    brief = template == "精简摘要报告"

    facts = _facts(run, scope)
    ai = _ai_report(facts, template, sections) if run else None

    lines = [f"# 中文新闻文本分类系统 · 分析报告",
             "",
             f"- 报告模板：**{template}**　数据范围：**{scope}**",
             f"- 生成时间：{db.now_str()}",
             ""]
    if not run:
        lines += ["> ⚠️ 当前尚未训练任何模型，以下指标暂为占位 0；上传数据并完成训练后，"
                  "报告将自动回填真实结果。", ""]

    summary = (ai or {}).get("summary") if ai else None
    if not summary:
        summary = _rule_summary(facts, run)
    lines += ["## 执行摘要", "", summary, ""]

    builders = {
        "数据概览": _sec_data_overview,
        "数据预处理": _sec_preprocess,
        "特征工程": _sec_feature,
        "模型训练结果": _sec_training,
        "模型评价分析": _sec_evaluation,
        "关键词分析": _sec_keywords,
        "预测结果分析": _sec_prediction,
        "错误样本分析": _sec_errors,
        "可视化图表": _sec_charts,
        "结论与建议": _sec_conclusion,
        "实验记录": _sec_experiments,
        "附录信息": _sec_appendix,
    }
    idx = 1
    for name in sections:
        fn = builders.get(name)
        if not fn:
            continue
        body = fn(run, facts, full=full, brief=brief, detail=detail, scope=scope)
        if not body:
            continue
        lines.append(f"## {idx}. {name}")
        lines.append("")
        lines.append(body)
        analysis = (ai or {}).get("analyses", {}).get(name) if ai else None
        if analysis and not brief:
            lines += ["", f"**分析：** {analysis}"]
        lines.append("")
        idx += 1

    lines += ["---", f"*本报告由系统读取后台真实结果与日志生成"
              f"{'，智能分析由 DeepSeek 提供' if ai else '（未配置 DeepSeek，分析为规则化文本）'}。*"]
    return "\n".join(lines)


def _facts(run, scope: str) -> dict:
    if not run:
        return {"trained": False, "scope": scope, "num_classes": 0,
                "train_count": 0, "test_count": 0, "predictions": 0}
    results = run.get("results") or {}
    best = run.get("best_model")
    return {
        "trained": True, "scope": scope,
        "最优模型": config.MODEL_DISPLAY.get(best, best),
        "类别数": run.get("num_classes"),
        "训练样本": run.get("train_count"), "测试样本": run.get("test_count"),
        "类别": run.get("label_names"),
        "朴素贝叶斯": {k: (results.get(config.MODEL_NB) or {}).get(k)
                  for k in ("accuracy", "precision", "recall", "f1", "macro_f1")},
        "逻辑回归": {k: (results.get(config.MODEL_LR) or {}).get(k)
                 for k in ("accuracy", "precision", "recall", "f1", "macro_f1")},
        "预测累计": db.count_predictions(),
        "训练耗时秒": run.get("elapsed"),
    }


def _ai_report(facts, template, section_names):
    if not llm.available():
        return None
    import json
    depth = {"精简摘要报告": "非常精简，执行摘要 60 字内，每章分析 1 句",
             "标准分析报告": "适中，执行摘要 150 字内，每章分析 2-3 句",
             "完整技术报告": "详尽深入，执行摘要 200 字内，每章分析 4-6 句并含技术细节与改进建议",
             }.get(template, "适中")
    sys = ("你是严谨的机器学习实验报告撰写助手。只能依据用户提供的真实数据撰写，"
           "严禁编造任何数字；本系统仅有'朴素贝叶斯'与'逻辑回归'两个分类模型，"
           "深度学习仅用于超参数调优。输出专业、客观的中文。")
    usr = (f"以下是中文新闻文本分类系统的真实实验数据(JSON)：\n"
           f"{json.dumps(facts, ensure_ascii=False)}\n\n"
           f"报告深度要求：{depth}。\n"
           f"需要撰写分析的章节：{section_names}\n"
           '只输出严格 JSON：{"summary":"执行摘要","analyses":{"章节名":"该章节分析"}}，'
           "analyses 的键必须取自给定章节名，可只覆盖与指标相关的章节。只输出 JSON。")
    try:
        max_tok = {"精简摘要报告": 700, "标准分析报告": 1300,
                   "完整技术报告": 2200}.get(template, 1300)
        parsed = llm._extract_json(llm.chat(
            [{"role": "system", "content": sys}, {"role": "user", "content": usr}],
            temperature=0.5, max_tokens=max_tok))
        if isinstance(parsed, dict):
            parsed.setdefault("analyses", {})
            return parsed
    except Exception:  # noqa: BLE001
        pass
    return None


def _rule_summary(facts, run) -> str:
    if not run:
        return ("系统当前为空白状态：尚未上传数据集、尚未训练模型，因此各项指标均为 0。"
                "请在『数据集管理』上传数据并在『模型训练』完成训练后再生成报告。")
    nb = facts.get("朴素贝叶斯", {})
    lr = facts.get("逻辑回归", {})
    return (f"本次实验在 {facts.get('类别数')} 类中文新闻数据上对比了朴素贝叶斯与逻辑回归两种模型。"
            f"逻辑回归测试集准确率 {_fmtv('accuracy', lr.get('accuracy'))}、Macro-F1 {_fmtv('macro_f1', lr.get('macro_f1'))}；"
            f"朴素贝叶斯准确率 {_fmtv('accuracy', nb.get('accuracy'))}、Macro-F1 {_fmtv('macro_f1', nb.get('macro_f1'))}。"
            f"综合表现最优的是 **{facts.get('最优模型')}**，已用于实时预测。")


# ---- 各章节构造（返回 Markdown 片段；返回空串则跳过） ----
def _metrics_table(run):
    results = run.get("results") or {}
    cols = [("accuracy", "Accuracy"), ("precision", "Precision"),
            ("recall", "Recall"), ("f1", "F1"), ("macro_f1", "Macro-F1")]
    out = "| 模型 | " + " | ".join(c[1] for c in cols) + " |\n"
    out += "|" + "---|" * (len(cols) + 1) + "\n"
    for k in (config.MODEL_NB, config.MODEL_LR):
        r = results.get(k) or {}
        star = " ⭐" if k == run.get("best_model") else ""
        out += "| " + config.MODEL_DISPLAY.get(k, k) + star + " | " + \
               " | ".join(_fmtv(c[0], r.get(c[0])) for c in cols) + " |\n"
    return out


def _sec_data_overview(run, facts, **kw):
    ds = db.get_selected_dataset() or "—"
    scope = kw.get("scope")
    tr, te = facts.get("训练样本") or 0, facts.get("测试样本") or 0
    if scope == "训练集":
        total_line = f"- 训练样本：**{tr}**"
    elif scope == "测试集":
        total_line = f"- 测试样本：**{te}**"
    else:
        total_line = f"- 训练 / 测试样本：**{tr} / {te}**（合计 {tr + te}）"
    lines = [f"- 数据集：**{ds}**",
             f"- 类别数：**{facts.get('类别数') or 0}**",
             total_line]
    names = facts.get("类别")
    if names:
        lines.append(f"- 类别列表：{ '、'.join(names) }")
    return "\n".join(lines)


def _sec_preprocess(run, facts, **kw):
    if not run:
        return "- 清洗规则：暂无（未训练）"
    rules = run.get("clean_rules") or {}
    if isinstance(rules, dict) and rules:
        items = "\n".join(f"- {k}：{v}" for k, v in rules.items())
        return "采用如下文本清洗规则：\n\n" + items
    return "已执行去重、去空、分词与停用词过滤等标准清洗流程。"


def _sec_feature(run, facts, **kw):
    if not run:
        return "- TF-IDF 特征：暂无（未训练）"
    tp = run.get("tfidf_params") or {}
    fs = run.get("feature_stats") or {}
    lines = ["采用 TF-IDF 进行特征抽取，关键参数："]
    if tp:
        lines.append("")
        lines += [f"- {k}：{v}" for k, v in tp.items()]
    if fs and kw.get("full"):
        lines.append("")
        lines += [f"- {k}：{v}" for k, v in fs.items() if not isinstance(v, (list, dict))]
    return "\n".join(lines)


def _sec_training(run, facts, **kw):
    if not run:
        return "尚未训练，模型指标为 0。"
    out = "两个模型在测试集上的核心指标：\n\n" + _metrics_table(run)
    out += f"\n最优模型：**{facts.get('最优模型')}**"
    if kw.get("detail") or kw.get("full"):
        nb_p, lr_p = run.get("nb_params") or {}, run.get("lr_params") or {}
        if nb_p:
            out += "\n\n朴素贝叶斯参数：" + "，".join(f"{k}={v}" for k, v in nb_p.items())
        if lr_p:
            out += "\n\n逻辑回归参数：" + "，".join(f"{k}={v}" for k, v in lr_p.items())
    return out


def _sec_evaluation(run, facts, **kw):
    if not run:
        return "尚未训练，无评价结果。"
    concl = (run.get("conclusions") or {})
    bullets = concl.get("bullets") or []
    out = "模型评价以测试集为准，核心指标见上节。"
    if bullets:
        out += "\n\n关键结论：\n\n" + "\n".join(f"- {b}" for b in bullets)
    return out


def _sec_keywords(run, facts, **kw):
    if not run:
        return ""
    fs = run.get("feature_stats") or {}
    kws = fs.get("top_keywords") or fs.get("keywords")
    if isinstance(kws, list) and kws:
        top = kws[:(15 if kw.get("full") else 8)]
        return "高权重关键词（TF-IDF）：" + "、".join(str(x) for x in top)
    return "各类别高权重关键词可在『错误样本与关键词解释』页查看。"


def _sec_prediction(run, facts, **kw):
    total = db.count_predictions()
    if not total:
        return "暂无预测记录。"
    preds = db.list_predictions(10000)
    counts = {}
    for p in preds:
        counts[p["pred_name"]] = counts.get(p["pred_name"], 0) + 1
    rows = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    out = f"累计预测 **{total}** 条，类别分布：\n\n| 类别 | 条数 | 占比 |\n|---|---|---|\n"
    for name, c in rows:
        out += f"| {name} | {c} | {c / total * 100:.1f}% |\n"
    return out


def _sec_errors(run, facts, **kw):
    if not run:
        return ""
    return "错误样本与易混淆类别明细见『错误样本与关键词解释』页；建议关注高频混淆类别对以进一步优化。"


def _sec_charts(run, facts, **kw):
    n = _count_charts()
    if not n:
        return "暂无可视化图表（训练后自动生成混淆矩阵、F1 对比等图）。"
    return f"系统已生成 **{n}** 张可视化图表（数据集分布、模型对比、F1-score、混淆矩阵等），" \
           "可在『模型评价与可视化』页查看。"


def _sec_conclusion(run, facts, **kw):
    if not run:
        return "训练完成后给出最优模型与部署建议。"
    concl = run.get("conclusions") or {}
    tip = concl.get("tip")
    rec = (concl.get("recommend") or {})
    lines = []
    if tip:
        lines.append(f"- {tip}")
    if rec.get("reason"):
        lines.append(f"- 推荐部署：{facts.get('最优模型')}（{rec.get('reason')}）")
    if not lines:
        lines.append(f"- 综合最优模型为 **{facts.get('最优模型')}**，建议用于线上预测。")
    return "\n".join(lines)


def _sec_experiments(run, facts, **kw):
    runs = db.list_runs(10 if kw.get("full") else 5)
    if not runs:
        return "暂无实验记录。"
    out = "| 实验 | 最优模型 | 准确率 | 时间 |\n|---|---|---|---|\n"
    for r in runs:
        bm = r.get("best_model")
        acc = ((r.get("results") or {}).get(bm) or {}).get("accuracy")
        out += f"| run{r['id']} | {config.MODEL_DISPLAY.get(bm, bm)} | " \
               f"{_fmtv('accuracy', acc)} | {r.get('created_at')} |\n"
    return out


def _sec_appendix(run, facts, **kw):
    if not kw.get("full"):
        return ""
    events = db.recent_events(15)
    lines = ["运行环境：Python + scikit-learn + Flask；TF-IDF 特征 + 朴素贝叶斯 / 逻辑回归。",
             "", "近期系统日志："]
    if events:
        lines += [f"- [{e.get('created_at', '')}] {e.get('message', '')}" for e in events]
    else:
        lines.append("- 暂无日志")
    return "\n".join(lines)


# ------------------------------------------------------------------ 渲染
def _register_pdf_font() -> str:
    """注册 reportlab 内置 CJK 字体（无需外部字体文件，规避 Windows 临时文件占用）。"""
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        if "STSong-Light" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        from xhtml2pdf.default import DEFAULT_FONT
        DEFAULT_FONT["song"] = "STSong-Light"
        return "song"
    except Exception:  # noqa: BLE001
        return "STSong-Light"


def _md_to_html(md_text: str, paper: str, for_pdf: bool) -> str:
    import markdown as md_lib
    body = md_lib.markdown(md_text, extensions=["tables", "fenced_code", "sane_lists"])
    if for_pdf:
        font = "song"
        page = f"@page {{ size: {paper}; margin: 1.6cm; }}"
        family = font
    else:
        page = ""
        family = '"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif'
    css = f"""{page}
    body{{font-family:{family};color:#1f2937;font-size:13px;line-height:1.7;max-width:900px;margin:24px auto;padding:0 16px}}
    h1{{color:#dc2626;font-size:24px;border-bottom:2px solid #f3a6aa;padding-bottom:8px}}
    h2{{color:#b91c1c;font-size:17px;margin-top:18px}}
    table{{border-collapse:collapse;width:100%;margin:8px 0}}
    th,td{{border:1px solid #d1d5db;padding:6px 8px;font-size:12px;text-align:center}}
    th{{background:#fde8e8;color:#991b1b}}
    blockquote{{background:#fff7ed;border-left:4px solid #f97316;padding:8px 12px;color:#9a3412}}
    code{{background:#f3f4f6;padding:1px 4px;border-radius:3px}}
    hr{{border:none;border-top:1px solid #e5e7eb;margin:18px 0}}
    """
    return (f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
            f"<title>中文新闻文本分类系统 · 分析报告</title><style>{css}</style></head>"
            f"<body>{body}</body></html>")


def _html_to_pdf(html: str) -> bytes:
    _register_pdf_font()
    from xhtml2pdf import pisa
    out = io.BytesIO()
    res = pisa.CreatePDF(src=html, dest=out, encoding="utf-8")
    if res.err:
        raise RuntimeError("PDF 渲染失败")
    return out.getvalue()


def _html_to_doc(html: str) -> str:
    """生成 Word 可直接打开的 .doc（基于 HTML，附带 Office 命名空间）。"""
    head = ("<html xmlns:o='urn:schemas-microsoft-com:office:office' "
            "xmlns:w='urn:schemas-microsoft-com:office:word' "
            "xmlns='http://www.w3.org/TR/REC-html40'>")
    if html.lower().startswith("<!doctype") or html.lower().startswith("<html"):
        i = html.lower().find("<html")
        j = html.find(">", i)
        return head + html[j + 1:]
    return head + html + "</html>"
