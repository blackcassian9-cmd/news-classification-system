/* 中文新闻文本分类系统 —— 前端接线层（统一脚本）。
 * 设计原则：不改用户视觉结构，只做数据绑定 / 菜单跳转 / 下拉修正 / 图表嵌入。
 * 每个页面只注入 window.PAGE 与本文件，按 PAGE 分发到对应 init 函数。
 */
(function () {
  "use strict";

  const API = window.API_BASE || "";
  const PAGE = window.PAGE || "index";

  /* ----------------- 基础工具 ----------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  async function api(path, opts) {
    const res = await fetch(API + path, Object.assign({ headers: {} }, opts));
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok || (body && body.ok === false)) {
      const msg = (body && (body.error || body.message)) || ("请求失败 " + res.status);
      throw new Error(msg);
    }
    return body && body.data !== undefined ? body.data : body;
  }
  function postJSON(path, payload) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = (n) => (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toLocaleString("en-US");
  const fmtPct = (x, d) => (x === null || x === undefined || isNaN(x)) ? "—" : (Number(x) * 100).toFixed(d == null ? 2 : d) + "%";
  const setText = (el, v) => { if (el) el.textContent = v; };

  function toast(msg, type) {
    let t = $("#__toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "__toast";
      t.style.cssText = "position:fixed;z-index:9999;left:50%;top:24px;transform:translateX(-50%);" +
        "padding:12px 22px;border-radius:8px;font-size:15px;font-weight:700;color:#fff;" +
        "box-shadow:0 12px 30px rgba(0,0,0,.18);max-width:60vw;opacity:0;transition:opacity .2s;";
      document.body.appendChild(t);
    }
    t.style.background = type === "error" ? "#dc2626" : (type === "warn" ? "#d97706" : "#16a34a");
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => { t.style.opacity = "0"; }, 2600);
  }
  window.__toast = toast;

  /* “较上次”增量小标签：mode=points 用于比率(显示百分点)，relative 用于计数，abs 绝对 */
  function deltaHTML(delta) {
    if (!delta) return "";
    const color = delta.up ? "#16a34a" : "#dc2626";
    const arrow = delta.up ? "↑" : "↓";
    return ` <span class="up" style="color:${color}">${delta.text} ${arrow}</span>`;
  }
  function subWithDelta(prefix, card) {
    if (!card) return prefix;
    if (card.delta) return `${prefix} ${deltaHTML(card.delta)}`;
    return `${prefix} 首次`; // 第一次无对比
  }

  function refreshIcons() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }

  /* 参数说明小气泡（点击 i 图标弹出，再次点击别处消失） */
  function showTip(anchor, text) {
    const old = $("#__tip");
    if (old) old.remove();
    const tip = document.createElement("div");
    tip.id = "__tip";
    tip.textContent = text;
    tip.style.cssText = "position:fixed;z-index:9500;max-width:320px;background:#1f2937;color:#fff;" +
      "padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.6;box-shadow:0 12px 30px rgba(0,0,0,.25);";
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    tip.style.left = Math.min(r.left, window.innerWidth - 340) + "px";
    tip.style.top = (r.bottom + 8) + "px";
    const close = (e) => { if (e.target !== anchor) { tip.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 50);
  }

  /* ----------------- 导航 / 菜单跳转 ----------------- */
  const NAV = {
    "首页总览": "index", "数据集管理": "datasets", "数据预览与清洗": "preview",
    "TF-IDF特征提取": "features", "TF-IDF 特征提取": "features",
    "模型训练": "training", "深度学习参数优化": "optimization",
    "模型评价与可视化": "evaluation", "错误样本与关键词解释": "errors",
    "实验记录与模型管理": "experiments", "新闻文本预测": "prediction", "报告导出": "reports",
  };
  function navText(item) {
    const span = item.querySelector("span");
    return (span ? span.textContent : item.textContent).trim().replace(/\s+/g, "");
  }
  function wireNav() {
    $$(".menu-item").forEach((item) => {
      const slug = NAV[navText(item)];
      if (!slug) return;
      item.style.cursor = "pointer";
      item.addEventListener("click", () => { location.href = "/" + slug + ".html"; });
      // 纠正 active：与当前页一致
      item.classList.toggle("active", slug === PAGE);
    });
  }

  /* 顶部搜索：点击后输入模块名快速跳转（“搜索模块”能力） */
  function wireSearch() {
    const box = $(".search");
    if (!box) return;
    box.style.cursor = "text";
    box.addEventListener("click", () => {
      const kw = (prompt("跳转到模块（输入名称关键字）：\n首页总览/数据集管理/数据预览与清洗/TF-IDF/模型训练/深度学习参数优化/模型评价/错误样本/实验记录/新闻预测/报告导出") || "").trim();
      if (!kw) return;
      const keys = Object.keys(NAV);
      let hit = keys.find((k) => k.replace(/\s+/g, "") === kw.replace(/\s+/g, ""));
      if (!hit) hit = keys.find((k) => k.indexOf(kw) >= 0 || kw.indexOf(k) >= 0);
      if (!hit && /tfidf|tf-idf|特征/i.test(kw)) hit = "TF-IDF特征提取";
      if (hit) location.href = "/" + NAV[hit] + ".html";
      else toast("未找到匹配模块：" + kw, "warn");
    });
  }

  /* 顶部“模型已加载/未加载”状态灯 */
  async function wireTopStatus() {
    try {
      const h = await api("/api/health");
      const red = $(".pill.red");
      if (red) red.childNodes[red.childNodes.length - 1].nodeValue = h.trained ? "模型已加载" : "模型未训练";
    } catch (e) {}
  }

  /* ----------------- 首页总览 ----------------- */
  async function initOverview() {
    let d;
    try { d = await api("/api/overview"); } catch (e) { toast(e.message, "error"); return; }
    bindTimeline(d.status_timeline);
    if (!d.trained) {
      toast(d.message || "尚未训练模型", "warn");
      return;
    }
    const c = d.stat_cards;
    const cards = $$(".stat-grid .stat-card");
    // 顺序：训练集 / 测试集 / 类别数 / 最优模型 / Accuracy / Macro-F1
    if (cards[0]) { setText($(".value", cards[0]), fmtInt(c.train_count.value)); $(".sub", cards[0]).innerHTML = subWithDelta("较上次", c.train_count); }
    if (cards[1]) { setText($(".value", cards[1]), fmtInt(c.test_count.value)); $(".sub", cards[1]).innerHTML = subWithDelta("较上次", c.test_count); }
    if (cards[2]) { setText($(".value", cards[2]), c.num_classes.value); $(".sub", cards[2]).innerHTML = c.num_classes.delta ? subWithDelta("较上次", c.num_classes) : "较上次 持平"; }
    if (cards[3]) { setText($(".value", cards[3]), c.best_model.value); $(".sub", cards[3]).innerHTML = "更新于&nbsp; " + (c.best_model.updated || "").slice(0, 10); }
    if (cards[4]) { setText($(".value", cards[4]), fmtPct(c.accuracy.value)); $(".sub", cards[4]).innerHTML = subWithDelta("较上次", c.accuracy); }
    if (cards[5]) { setText($(".value", cards[5]), fmtPct(c.macro_f1.value)); $(".sub", cards[5]).innerHTML = subWithDelta("较上次", c.macro_f1); }

    bindPerfBars(d.perf_comparison);
    if (d.tip) setText($(".chart-note span"), d.tip);
    bindBestParams(d.best_params);
    wireOverviewTabs(d.run_id);
    wireQuickPredict();
    refreshIcons();
  }

  function bindPerfBars(perf) {
    if (!perf) return;
    const groups = $$(".bar-group");
    const SCALE = 2.3; // 设计稿：100% ≈ 230px
    perf.metrics.forEach((m, i) => {
      const g = groups[i];
      if (!g) return;
      const light = $(".bar.light", g), dark = $(".bar.dark", g);
      const nb = perf.nb[i], lr = perf.lr[i];
      if (light) { light.style.height = (nb * SCALE) + "px"; $("b", light).textContent = nb.toFixed(2) + "%"; }
      if (dark) { dark.style.height = (lr * SCALE) + "px"; $("b", dark).textContent = lr.toFixed(2) + "%"; }
    });
  }

  function bindBestParams(bp) {
    const list = $(".param-list");
    if (!list || !bp) return;
    const t = bp.tfidf || {}, lr = bp.lr || {}, nb = bp.nb || {};
    const chips = [
      `ngram_range =（${t.ngram_min || 1}, ${t.ngram_max || 2}）`,
      `min_df = ${t.min_df}`,
      `max_df = ${t.max_df}`,
      `max_features = ${fmtInt(t.max_features)}`,
      `C = ${lr.C}`,
      `alpha = ${nb.alpha}`,
      `random_state = ${bp.random_state}`,
    ];
    list.innerHTML = chips.map((c) => `<div class="param">${c}</div>`).join("");
    const btn = $(".detail-btn");
    if (btn) btn.addEventListener("click", () => { location.href = "/optimization.html"; });
  }

  function bindTimeline(timeline) {
    if (!timeline) return;
    const items = $$(".status-grid .status-item");
    timeline.forEach((ev, i) => {
      const it = items[i];
      if (!it) return;
      const b = $("b", it), span = $("span", it), check = $(".check", it);
      if (b) b.textContent = ev.label;
      if (span) span.textContent = ev.done && ev.time ? ("完成时间：" + ev.time.slice(5, 16)) : "未完成";
      if (check) check.style.borderColor = check.style.color = ev.done ? "#22c55e" : "#d1d5db";
    });
    const viewAll = $(".view-all");
    if (viewAll) { viewAll.style.cursor = "pointer"; viewAll.addEventListener("click", () => location.href = "/experiments.html"); }
  }

  /* 首页四个 Tab：性能对比保留原生柱状图；其余切换到后端生成的 PNG（“把评价页的图移到对应按钮下”）*/
  function wireOverviewTabs(runId) {
    const tabs = $$(".tabs .tab");
    if (!tabs.length) return;
    const body = $(".chart-body");
    const native = [$(".legend", body), $(".chart-wrap", body), $(".chart-note", body),
                    $(".chart-wrap", body) ? $(".chart-wrap", body).previousElementSibling : null].filter(Boolean);
    let img = $("#ov-chart-img");
    if (!img) {
      img = document.createElement("img");
      img.id = "ov-chart-img";
      img.style.cssText = "display:none;width:100%;max-height:360px;object-fit:contain;margin-top:6px;";
      const wrap = $(".chart-wrap", body);
      if (wrap) wrap.parentNode.insertBefore(img, wrap);
    }
    const title = $(".section-title", body);
    const map = {
      "类别分布": { url: `/api/evaluation/charts/cat_${runId}.png`, title: "训练集类别分布" },
      "F1-score": { url: `/api/evaluation/charts/f1_${runId}.png`, title: "各类别 F1-score" },
      "混淆矩阵": { url: `/api/evaluation/charts/cm_lr_${runId}.png`, title: "混淆矩阵（逻辑回归）" },
    };
    let charted = false;
    tabs.forEach((tab) => {
      tab.style.cursor = "pointer";
      tab.addEventListener("click", async () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const key = tab.textContent.trim();
        if (key === "性能对比") {
          native.forEach((n) => (n.style.display = ""));
          img.style.display = "none";
          if (title) title.textContent = "模型性能对比（朴素贝叶斯 vs 逻辑回归）";
          return;
        }
        const cfg = map[key];
        if (!cfg) return;
        if (!charted) { try { await api("/api/evaluation"); charted = true; } catch (e) {} }
        native.forEach((n) => (n.style.display = "none"));
        img.src = cfg.url + "?t=" + Date.now();
        img.style.display = "block";
        if (title) title.textContent = cfg.title;
      });
    });
  }

  /* 把展示用的“文本框”div 变成真正可编辑（保留右下角字数计数，兼容 <p> 包裹与纯文本） */
  function makeEditable(box) {
    if (!box) return null;
    const count = $(".count", box);
    let initial = "";
    box.childNodes.forEach((n) => {
      if (n.nodeType === 1 && n.classList && n.classList.contains("count")) return;
      initial += (n.textContent || "");
    });
    initial = initial.trim();
    const cText = count ? count.textContent : "";
    const maxMatch = cText.match(/\/\s*(\d+)/);
    const max = maxMatch ? maxMatch[1] : "500";
    const sep = cText.indexOf(" / ") >= 0 ? " / " : "/";
    const input = document.createElement("div");
    input.className = "pe-input";
    input.setAttribute("contenteditable", "true");
    input.textContent = initial;
    input.style.cssText = "outline:none;min-height:40px;white-space:pre-wrap;word-break:break-all;";
    box.textContent = "";
    box.appendChild(input);
    if (count) box.appendChild(count);
    const upd = () => { if (count) count.textContent = input.innerText.trim().length + sep + max; };
    input.addEventListener("input", upd); upd();
    return { input, count, upd, get: () => input.innerText.trim(), set: (v) => { input.textContent = v; upd(); } };
  }

  /* 通用：把“假下拉”div 变成真下拉（保留其中的 svg 箭头） */
  function customDropdown(el, options, onSelect, current) {
    if (!el || el.__dd) return;
    el.__dd = true;
    el.style.position = "relative";
    el.style.cursor = "pointer";
    const setLabel = (label) => {
      Array.from(el.childNodes).forEach((n) => { if (n.nodeType === 3) el.removeChild(n); });
      el.insertBefore(document.createTextNode(label + " "), el.firstChild);
    };
    let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; } };
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu) { close(); return; }
      menu = document.createElement("div");
      menu.style.cssText = "position:absolute;left:0;top:calc(100% + 4px);min-width:100%;background:#fff;" +
        "border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.14);z-index:60;overflow:hidden;";
      options.forEach((o) => {
        const row = document.createElement("div");
        row.textContent = o.label;
        row.style.cssText = "padding:10px 16px;font-size:15px;color:#374151;white-space:nowrap;cursor:pointer;";
        row.onmouseenter = () => (row.style.background = "#fef2f2");
        row.onmouseleave = () => (row.style.background = "#fff");
        row.onclick = (ev) => { ev.stopPropagation(); el.__value = o.key; setLabel(o.label); close(); if (onSelect) onSelect(o.key, o.label); };
        menu.appendChild(row);
      });
      el.appendChild(menu);
    });
    document.addEventListener("click", close);
    if (current) { el.__value = current.key; setLabel(current.label); }
    return { get: () => el.__value, setOptions: (opts) => { options = opts; } };
  }

  /* 通用弹窗 */
  function modal(title, content, opts) {
    const mask = document.createElement("div");
    mask.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;";
    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:14px;max-width:" + ((opts && opts.width) || "780px") +
      ";width:86vw;max-height:84vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.3);";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;z-index:1;";
    head.innerHTML = `<b style="font-size:18px;color:#111827">${title}</b>`;
    const x = document.createElement("div");
    x.textContent = "✕";
    x.style.cssText = "cursor:pointer;font-size:20px;color:#6b7280;padding:0 6px;";
    x.onclick = () => mask.remove();
    head.appendChild(x);
    const body = document.createElement("div");
    body.style.cssText = "padding:20px 22px;color:#374151;font-size:15px;line-height:1.7;";
    if (typeof content === "string") body.innerHTML = content; else body.appendChild(content);
    box.appendChild(head); box.appendChild(body); mask.appendChild(box);
    mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return { mask, body, close: () => mask.remove() };
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* 首页“快速新闻预测” */
  function wireQuickPredict() {
    const panel = $(".predict-panel");
    if (!panel) return;
    const btn = $(".btn", panel);
    const clearBtn = $(".clear", panel);
    const ed = makeEditable($(".textarea", panel));
    if (!ed) return;
    if (clearBtn) { clearBtn.style.cursor = "pointer"; clearBtn.addEventListener("click", () => { ed.set(""); ed.input.focus(); }); }
    btn.style.cursor = "pointer";
    btn.addEventListener("click", async () => {
      const text = ed.get();
      if (!text) { toast("请输入新闻文本", "warn"); return; }
      btn.disabled = true; const old = btn.textContent; btn.textContent = "预测中...";
      try {
        const r = await postJSON("/api/prediction/predict", { text, options: { keywords: true, save: true } });
        renderQuickResult(panel, r);
      } catch (e) { toast(e.message, "error"); }
      finally { btn.disabled = false; btn.textContent = old; }
    });
  }
  function renderQuickResult(panel, r) {
    const items = $$(".result-list .result-item", panel);
    if (items[0]) $(".result-value", items[0]).textContent = r.pred_name;
    if (items[1]) $(".result-value", items[1]).textContent = (r.confidence * 100).toFixed(1) + "%";
    if (items[2]) {
      const top = (r.topk || []).slice(0, 3).map((t) => t.name).join(" / ");
      $(".result-value", items[2]).textContent = top || r.pred_name;
    }
    if (items[3]) {
      const kw = (r.keywords || []).map((k) => k.term || k).slice(0, 4);
      const basis = $(".basis", items[3]);
      if (basis) basis.innerHTML = kw.length ? `文本中包含 ${kw.map((k) => `“${k}”`).join("")} 等关键特征。` : "依据 TF-IDF 加权特征综合判断。";
    }
  }

  /* ----------------- 新闻文本预测 ----------------- */
  async function initPrediction() {
    let selModel = null;
    let lastText = "";
    const ed = makeEditable($(".textarea"));

    // 统计卡片
    try {
      const s = await api("/api/prediction/stats");
      const cards = $$(".stats .stat");
      const setS = (i, v, sub) => { if (cards[i]) { setText($(".val", cards[i]), v); if (sub !== undefined && $(".sub", cards[i])) $(".sub", cards[i]).textContent = sub; } };
      setS(0, fmtInt(s.today), "今日累计");
      setS(1, fmtInt(s.week), "近 7 日");
      setS(2, s.model_accuracy != null ? fmtPct(s.model_accuracy) : "—", s.current_model ? "当前最优：" + s.current_model : "当前最优模型");
      setS(3, "—", "实时测量");
      setS(4, s.num_classes, "新闻类别覆盖");
      setS(5, fmtInt(s.total), "系统累计");
      const fst = $(".footer-row .status-line span");
      if (fst && s.current_model) fst.innerHTML = `当前模型：<i class="green-dot"></i>${s.current_model}`;
    } catch (e) {}

    // 模型下拉：严格只有 朴素贝叶斯 / 逻辑回归
    async function loadModels() {
      try {
        const m = await api("/api/prediction/models");
        const opts = m.models.map((x) => ({ key: x.key, label: x.name + (x.recommended ? "（推荐）" : "") }));
        const cur = opts.find((o) => /推荐/.test(o.label)) || opts[0];
        selModel = (cur && cur.key) || m.best;
        const sw = $(".select-wide");
        if (sw && !sw.__dd) customDropdown(sw, opts, (k) => (selModel = k), cur);
        if (!m.trained) toast("尚未训练模型，预测前请先在『模型训练』完成训练。", "warn");
      } catch (e) {}
    }
    await loadModels();
    const rm = $(".refresh-model");
    if (rm) { rm.style.cursor = "pointer"; rm.addEventListener("click", () => { const sw = $(".select-wide"); if (sw) { sw.__dd = false; } loadModels(); toast("已刷新模型列表"); }); }

    // 高级选项开关
    function readOpts() {
      const o = { keywords: true, similar: false, save: true };
      $$(".options .opt").forEach((sp) => {
        const on = !!sp.querySelector("i.checked");
        const t = sp.textContent;
        if (t.indexOf("关键词") >= 0) o.keywords = on;
        else if (t.indexOf("相似") >= 0) o.similar = on;
        else if (t.indexOf("保存") >= 0) o.save = on;
      });
      return o;
    }
    $$(".options .opt").forEach((sp) => {
      sp.style.cursor = "pointer";
      sp.addEventListener("click", () => {
        const i = sp.querySelector("i");
        if (!i) return;
        const on = i.classList.contains("checked");
        i.classList.toggle("checked", !on);
        i.classList.toggle("unchecked", on);
        i.textContent = on ? "" : "✓";
      });
    });

    // 预测
    const runBtn = $(".actions .btn-primary");
    const resetBtn = $(".actions .btn-ghost");
    const clearBtn = $(".clear");
    if (clearBtn) { clearBtn.style.cursor = "pointer"; clearBtn.addEventListener("click", () => ed && ed.set("")); }
    if (resetBtn) resetBtn.addEventListener("click", () => ed && ed.set(""));
    if (runBtn) {
      runBtn.style.cursor = "pointer";
      runBtn.addEventListener("click", async () => {
        const text = ed ? ed.get() : "";
        if (!text) { toast("请输入新闻文本", "warn"); return; }
        const opts = readOpts();
        runBtn.disabled = true;
        try {
          const r = await postJSON("/api/prediction/predict", { text, model: selModel, options: opts });
          lastText = text;
          renderPredResult(r);
          if (opts.keywords) renderKeywords(r.keywords || []);
          if (opts.similar) loadSimilar(text, r.pred_name);
          loadHistory();
          loadDistribution();
        } catch (e) { toast(e.message, "error"); }
        finally { runBtn.disabled = false; }
      });
    }

    function renderPredResult(r) {
      const pm = $(".result-card .pred-main span");
      if (pm) pm.textContent = r.pred_name;
      const cf = $(".result-card .confidence b");
      if (cf) cf.textContent = (r.confidence * 100).toFixed(2) + "%";
      const metas = $$(".result-card .pred-meta span");
      if (metas[0]) metas[0].innerHTML = `<b>模型：</b> ${r.model_name}`;
      if (metas[1]) metas[1].innerHTML = `<b>预测时间：</b> ${r.time || new Date().toLocaleString("zh-CN")}`;
      const dist = $(".dist");
      if (dist && r.distribution) {
        dist.innerHTML = r.distribution.map((d) => {
          const p = (d.prob * 100);
          return `<div class="dist-row"><span>${d.name}</span><div class="track"><i style="width:${p.toFixed(2)}%"></i></div><span class="dist-val">${p.toFixed(2)}%</span></div>`;
        }).join("");
      }
    }
    function renderKeywords(kws) {
      const tb = $(".ktable table tbody");
      if (!tb) return;
      if (!kws.length) { tb.innerHTML = `<tr><td colspan="4">该文本未命中显著特征</td></tr>`; return; }
      tb.innerHTML = kws.map((k) => `<tr><td>${k.keyword}</td><td>${k.weight}</td><td>${k.contribution}%</td><td>${k.position}</td></tr>`).join("");
    }

    // 相似新闻（全网搜索 + 真实链接）
    async function loadSimilar(text, category) {
      const panel = $$(".grid-bottom .table-panel")[0];
      if (!panel) return;
      const tb = $("table tbody", panel);
      if (!tb) return;
      tb.innerHTML = `<tr><td colspan="4" style="color:#6b7280">正在全网搜索相似新闻…</td></tr>`;
      try {
        const r = await api("/api/prediction/similar?text=" + encodeURIComponent(text) + "&category=" + encodeURIComponent(category || ""));
        if (!r.items || !r.items.length) { tb.innerHTML = `<tr><td colspan="4" style="color:#6b7280">${r.note || "暂无相似新闻"}</td></tr>`; return; }
        tb.innerHTML = r.items.map((it) =>
          `<tr><td><a href="${it.url || "#"}" target="_blank" rel="noopener" style="color:#dc2626;text-decoration:none">${it.title}</a></td>` +
          `<td>${category || it.site || "-"}</td><td>${it.similarity != null ? it.similarity + "%" : "-"}</td><td>${it.date || "-"}</td></tr>`).join("");
      } catch (e) { tb.innerHTML = `<tr><td colspan="4" style="color:#dc2626">相似新闻获取失败：${e.message}</td></tr>`; }
    }
    const simRefresh = $(".grid-bottom .table-panel .refresh");
    if (simRefresh) { simRefresh.style.cursor = "pointer"; simRefresh.addEventListener("click", () => { if (lastText) loadSimilar(lastText, ($(".result-card .pred-main span") || {}).textContent); else toast("请先预测一条新闻", "warn"); }); }

    // 历史 & 分布
    async function loadHistory() {
      try {
        const r = await api("/api/prediction/history?limit=8");
        const panel = $$(".grid-bottom .table-panel")[1];
        const tb = panel && $("table tbody", panel);
        if (!tb) return;
        if (!r.history || !r.history.length) { tb.innerHTML = `<tr><td colspan="5" style="color:#6b7280">暂无预测记录</td></tr>`; return; }
        tb.innerHTML = r.history.map((h) =>
          `<tr><td>${(h.text || "").slice(0, 22)}${(h.text || "").length > 22 ? "…" : ""}</td><td>${h.pred_name}</td>` +
          `<td>${(h.confidence * 100).toFixed(2)}%</td><td>${(h.created_at || "").slice(5, 16)}</td>` +
          `<td class="eye"><svg class="icon sicon"><use href="#i-eye"/></svg></td></tr>`).join("");
      } catch (e) {}
    }
    async function loadDistribution() {
      try {
        const r = await api("/api/prediction/distribution");
        const donut = $(".donut");
        const legend = $(".legend-cat");
        if (!r.distribution || !r.distribution.length) return;
        const palette = ["#dc2626", "#f97316", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#14b8a6", "#a16207"];
        let acc = 0; const segs = [];
        r.distribution.forEach((d, i) => { const c = palette[i % palette.length]; segs.push(`${c} ${acc}% ${acc + d.ratio}%`); acc += d.ratio; });
        if (donut) donut.style.background = `conic-gradient(${segs.join(",")})`;
        if (legend) legend.innerHTML = r.distribution.map((d, i) =>
          `<div><i class="catdot" style="background:${palette[i % palette.length]}"></i><span>${d.name}</span><b>${d.ratio}%（${fmtInt(d.count)}）</b></div>`).join("");
      } catch (e) {}
    }
    loadHistory();
    loadDistribution();

    // 批量预测（对测试集做推理；不是训练）
    const batchBtn = $(".batchbtn");
    if (batchBtn) {
      batchBtn.style.cursor = "pointer";
      batchBtn.addEventListener("click", async () => {
        batchBtn.disabled = true;
        const m = modal("批量预测（测试集推理）", "<div style='color:#6b7280'>正在对测试集进行批量预测…</div>");
        try {
          const r = await postJSON("/api/prediction/batch", { source: "testset", model: selModel, limit: 500 });
          const s = r.summary;
          const head = `<div style="margin-bottom:14px">模型：<b>${s.model_name}</b>　样本数：<b>${fmtInt(r.total_rows)}</b>` +
            (s.with_truth ? `　测试集准确率：<b style="color:#dc2626">${fmtPct(s.accuracy)}</b>` : "") + "</div>";
          const rows = (r.rows || []).slice(0, 30).map((x) =>
            `<tr><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${(x.text || "").slice(0, 30)}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${x.pred_name}</td>` +
            (s.with_truth ? `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:${x.correct ? "#16a34a" : "#dc2626"}">${x.true_name}${x.correct ? " ✓" : " ✗"}</td>` : "") +
            `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${(x.confidence * 100).toFixed(1)}%</td></tr>`).join("");
          m.body.innerHTML = head +
            `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>` +
            `<th style="text-align:left;padding:6px 8px">文本</th><th style="text-align:left;padding:6px 8px">预测</th>` +
            (s.with_truth ? `<th style="text-align:left;padding:6px 8px">真实</th>` : "") +
            `<th style="text-align:left;padding:6px 8px">置信度</th></tr></thead><tbody>${rows}</tbody></table>` +
            `<div style="margin-top:12px"><button id="__batch_csv" style="padding:8px 16px;border:none;border-radius:6px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer">导出全部为 CSV</button></div>`;
          const csvBtn = m.body.querySelector("#__batch_csv");
          if (csvBtn) csvBtn.onclick = () => {
            const data = [["文本", "预测类别", s.with_truth ? "真实类别" : "", "置信度"]].concat(
              (r.rows || []).map((x) => [x.text, x.pred_name, s.with_truth ? x.true_name : "", (x.confidence * 100).toFixed(2) + "%"]));
            downloadCSV("batch_prediction.csv", data);
          };
          loadHistory(); loadDistribution();
        } catch (e) { m.body.innerHTML = `<div style="color:#dc2626">批量预测失败：${e.message}</div>`; }
        finally { batchBtn.disabled = false; }
      });
    }

    // 导出预测结果（历史 CSV）
    const exportBtn = $(".exportbtn");
    if (exportBtn) {
      exportBtn.style.cursor = "pointer";
      exportBtn.addEventListener("click", async () => {
        try {
          const r = await api("/api/prediction/history?limit=1000");
          if (!r.history || !r.history.length) { toast("暂无预测记录可导出", "warn"); return; }
          const data = [["输入文本", "预测类别", "置信度", "模型", "时间"]].concat(
            r.history.map((h) => [h.text, h.pred_name, (h.confidence * 100).toFixed(2) + "%", h.model, h.created_at]));
          downloadCSV("prediction_history.csv", data);
        } catch (e) { toast(e.message, "error"); }
      });
    }
    refreshIcons();
  }

  /* ----------------- 模型训练 ----------------- */
  async function initTraining() {
    // 修正首个统计卡标题的笔误（两个都写了“测试集样本数”）
    const statCards = $$(".stats .stat");
    const lab0 = statCards[0] && $(".lab", statCards[0]);
    if (lab0 && lab0.textContent.indexOf("测试") >= 0) lab0.textContent = "训练集样本数";

    function renderTraining(res) {
      if (!res || res.trained === false) return;
      const sc = res.stat_cards || {};
      const setV = (i, v) => { if (statCards[i]) setText($(".val", statCards[i]), v); };
      setV(0, fmtInt(sc.train_count)); setV(1, fmtInt(sc.test_count));
      setV(2, sc.random_state); setV(3, sc.candidate_models);
      setV(4, sc.rounds); setV(5, sc.best_model);

      // 模型参数详情
      const pcards = $$(".param-wrap .param-card");
      const fillParams = (card, params) => {
        if (!card) return;
        $$(".prow", card).forEach((row) => {
          const k = $("span", row).textContent.trim();
          if (params[k] !== undefined) $("b", row).textContent = params[k];
        });
      };
      if (res.param_details) { fillParams(pcards[0], res.param_details.nb || {}); fillParams(pcards[1], res.param_details.lr || {}); }

      // 结果对比表（验证集）
      const tb = $(".result-table table tbody");
      if (tb && res.result_table) {
        tb.innerHTML = res.result_table.map((r) => {
          const cls = r.metric === "训练时间" ? "" : (r.improve_up ? "green" : "red");
          const lrCell = r.metric === "Macro-F1" ? `<td class="red">${r.lr}</td>` : `<td>${r.lr}</td>`;
          return `<tr><td>${r.metric}</td><td>${r.nb}</td>${lrCell}<td class="${cls}">${r.improve}</td></tr>`;
        }).join("");
      }

      // 耗时 & 轮次
      const t = (res.monitor || {}).timings || {};
      const costB = $$(".cost-card .cost-row");
      if (costB[0]) $("b", costB[0]).textContent = (t.nb || 0) + "s";
      if (costB[1]) $("b", costB[1]).textContent = (t.lr || 0) + "s";
      const mx = Math.max(t.nb || 0, t.lr || 0) || 1;
      if (costB[0]) $(".redbar", costB[0]) && ($(".redbar", costB[0]).style.width = Math.max(8, (t.nb / mx) * 90) + "%");
      if (costB[1]) $(".bluebar", costB[1]) && ($(".bluebar", costB[1]).style.width = Math.max(8, (t.lr / mx) * 90) + "%");
      const roundInfo = $$(".round-info > div");
      if (roundInfo[2]) $("span", roundInfo[2]).textContent = fmtInt(sc.val_count) + " 样本";

      // Macro-F1 SVG 分数标签更新为真实验证集分数
      const mf = (res.monitor || {}).macro_f1 || {};
      const svgTexts = $$(".chart-panel svg g[font-size] text, .chart-panel svg text[fill]");
      // 直接按已知文案替换
      $$(".chart-panel svg text").forEach((tx) => {
        const v = tx.getAttribute("fill");
        if (v === "#e11d26" && mf.nb != null) tx.textContent = mf.nb.toFixed(4);
        if (v === "#3b82f6" && mf.lr != null) tx.textContent = mf.lr.toFixed(4);
      });

      // 当前结论（LLM 润色的验证集结论）
      const clist = $(".conclusion .clist");
      if (clist && res.conclusions && res.conclusions.length) {
        clist.innerHTML = res.conclusions.map((c) => `<div><span class="cdot">✓</span>${c}</div>`).join("");
      }
      const rec = $(".recommend");
      if (rec && res.recommend) {
        const b = $("b", rec); if (b) b.textContent = res.recommend.model_name || res.best_model_name;
        const sp = rec.querySelector("span:last-child");
        if (sp && res.recommend.macro_f1 != null) sp.textContent = "Macro-F1 = " + res.recommend.macro_f1.toFixed(4);
      }

      // 日志
      if (res.logs) {
        const logbox = $(".logbox");
        if (logbox) {
          $$(".logrow", logbox).forEach((n) => n.remove());
          res.logs.forEach((lg) => {
            const row = document.createElement("div");
            row.className = "logrow";
            row.innerHTML = `<span class="okdot">✓</span><span>${lg.msg}</span><span class="time">${new Date().toLocaleTimeString("zh-CN", { hour12: false })}</span>`;
            logbox.appendChild(row);
          });
        }
      }
      // stepper 全部完成
      $$(".train-stepper .tstep").forEach((s) => { s.classList.remove("current", "pending"); s.classList.add("done"); });
      const stageVal = $$(".status-row .sbox .sval")[1];
      if (stageVal) { stageVal.textContent = "已完成"; stageVal.className = "sval green"; }
      const runVal = $$(".status-row .sbox .sval")[2];
      if (runVal) { runVal.textContent = "已完成"; runVal.className = "sval green"; }
      const usedVal = $$(".status-row .sbox .sval")[4];
      if (usedVal && res.elapsed != null) usedVal.textContent = res.elapsed + "s";
      refreshIcons();
    }

    // 初始：拉取已有训练结果或默认配置
    try {
      const res = await api("/api/training/result");
      if (res.trained) renderTraining(res);
      else {
        const cfg = await api("/api/training/config");
        const ctrls = $$(".form .field .ctrl");
        // 验证集比例 / random_state 用真实默认
        ctrls.forEach((c) => {
          const lab = c.parentElement.querySelector("label");
          if (!lab) return;
          if (lab.textContent.indexOf("验证集比例") >= 0) c.firstChild ? (c.childNodes[0].nodeValue = cfg.training_settings.val_ratio) : (c.textContent = cfg.training_settings.val_ratio);
          if (lab.textContent.indexOf("random_state") >= 0) c.textContent = cfg.training_settings.random_state;
        });
        if (!cfg.has_train || !cfg.has_test) toast("未找到训练/测试集，请先在『数据集管理』确认数据。", "warn");
      }
    } catch (e) { toast(e.message, "error"); }

    // 开始训练
    const trainBtn = $(".config .actions .btn.primary");
    if (trainBtn) {
      trainBtn.style.cursor = "pointer";
      trainBtn.addEventListener("click", async () => {
        trainBtn.disabled = true;
        const old = trainBtn.innerHTML;
        trainBtn.innerHTML = "训练中…";
        // 进度提示
        $$(".step-tabs .step-tab").forEach((s, i) => s.classList.toggle("active", i === 1));
        try {
          const res = await postJSON("/api/training/run", {});
          renderTraining(res);
          $$(".step-tabs .step-tab").forEach((s, i) => s.classList.toggle("active", i === 2));
          toast("训练完成：最优 " + (res.best_model_name || ""), "info");
        } catch (e) { toast("训练失败：" + e.message, "error"); }
        finally { trainBtn.disabled = false; trainBtn.innerHTML = old; refreshIcons(); }
      });
    }
    const resetBtn = $(".config .actions .btn.ghost");
    if (resetBtn) resetBtn.addEventListener("click", () => toast("训练采用最优参数，无需手动配置"));

    // 快捷操作跳转
    const qmap = { "查看评估结果": "evaluation", "前往可视化": "evaluation", "保存实验记录": "experiments", "导出模型": "reports" };
    $$(".quick .qitem").forEach((it) => {
      it.style.cursor = "pointer";
      it.addEventListener("click", () => {
        const t = it.textContent;
        const hit = Object.keys(qmap).find((k) => t.indexOf(k) >= 0);
        if (hit) location.href = "/" + qmap[hit] + ".html";
      });
    });
    refreshIcons();
  }

  /* ----------------- 数据集管理 ----------------- */
  async function initDatasets() {
    const selects = $$(".config-row .select");
    const delimiterDD = selects[0] && customDropdown(selects[0],
      [{ key: "tab", label: "TAB" }, { key: "comma", label: "逗号" }, { key: "space", label: "空格" }, { key: "semicolon", label: "分号" }], null, { key: "tab", label: "TAB" });
    const encodingDD = selects[1] && customDropdown(selects[1],
      [{ key: "utf-8", label: "UTF-8" }, { key: "gbk", label: "GBK" }], null, { key: "utf-8", label: "UTF-8" });
    const writeDD = selects[2] && customDropdown(selects[2],
      [{ key: "true", label: "是" }, { key: "false", label: "否" }], null, { key: "true", label: "是" });
    let autoValidate = true;
    const sw = $(".toggle .switch");
    if (sw) {
      sw.style.cursor = "pointer";
      const paint = () => { sw.style.background = autoValidate ? "#16a34a" : "#cbd5e1"; };
      paint();
      sw.addEventListener("click", () => { autoValidate = !autoValidate; paint(); });
    }

    function appendLog(msg, ok) {
      const box = $(".log-box");
      if (!box) return;
      const row = document.createElement("div");
      row.className = "log-row";
      const dot = ok === false ? "background:#fde8e8;color:#dc2626" : "";
      row.innerHTML = `<span><span class="check-dot" style="${dot}"><svg class="icon"><use href="#i-check"/></svg></span>${msg}</span><span></span><span>${new Date().toLocaleString("zh-CN")}</span>`;
      box.appendChild(row);
      refreshIcons();
    }

    async function doUpload(dtype, file) {
      const fd = new FormData();
      fd.append("file", file); fd.append("dtype", dtype);
      fd.append("delimiter", (delimiterDD && delimiterDD.get()) || "tab");
      fd.append("encoding", (encodingDD && encodingDD.get()) || "utf-8");
      fd.append("write_db", (writeDD && writeDD.get()) || "true");
      fd.append("auto_validate", autoValidate ? "true" : "false");
      appendLog(`开始上传 ${file.name} …`, true);
      try {
        const r = await api("/api/datasets/upload", { method: "POST", body: fd });
        (r.log || []).forEach((l) => appendLog(l.msg, l.ok));
        toast(`上传成功：${fmtInt(r.parsed)} 条`);
        loadList(); loadDist(); loadDbStatus();
      } catch (e) { appendLog("上传失败：" + e.message, false); toast("上传失败：" + e.message, "error"); }
    }
    function pickFile(dtype) {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".txt,.csv";
      inp.onchange = () => { if (inp.files[0]) doUpload(dtype, inp.files[0]); };
      inp.click();
    }

    const upBtns = $$(".upload-buttons .outline-btn");
    if (upBtns[0]) { upBtns[0].style.cursor = "pointer"; upBtns[0].addEventListener("click", () => pickFile("train")); }
    if (upBtns[1]) { upBtns[1].style.cursor = "pointer"; upBtns[1].addEventListener("click", () => pickFile("test")); }
    const dz = $(".drop-zone");
    if (dz) {
      dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.style.opacity = ".7"; });
      dz.addEventListener("dragleave", () => (dz.style.opacity = "1"));
      dz.addEventListener("drop", (e) => {
        e.preventDefault(); dz.style.opacity = "1";
        const f = e.dataTransfer.files[0];
        if (f) doUpload(/test/i.test(f.name) ? "test" : "train", f);
      });
    }
    const clearLog = $(".clear-log");
    if (clearLog) clearLog.addEventListener("click", () => $$(".log-box .log-row").forEach((n) => n.remove()));

    async function loadList() {
      try {
        const d = await api("/api/datasets");
        const sc = d.stat_cards;
        const cards = $$(".stat-grid .stat-card");
        const setC = (i, v, sub) => { if (cards[i]) { setText($(".stat-value", cards[i]), v); if (sub !== undefined && $(".stat-sub", cards[i])) $(".stat-sub", cards[i]).textContent = sub; } };
        setC(0, sc.dataset_count, "实时统计");
        setC(1, sc.train_files, "训练集文件");
        setC(2, sc.test_files, "测试集文件");
        setC(3, fmtInt(sc.total_samples), "训练 + 测试");
        if (cards[4]) setText($(".stat-value", cards[4]), sc.db_status);
        setC(5, (sc.last_upload || "—").slice(0, 10), (sc.last_upload || "").slice(11, 19) || "暂无上传");
        const tb = $(".data-table tbody");
        if (tb) {
          if (!d.list.length) tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:18px">暂无数据集，请上传 train.txt / test.txt</td></tr>`;
          else tb.innerHTML = d.list.map((r) =>
            `<tr data-id="${r.id}"><td><div class="file-name"><span class="file-icon"><svg class="icon small-icon"><use href="#i-file"/></svg></span>${r.name}</div></td>` +
            `<td><span class="tag ${r.dtype === "train" ? "blue" : "green"}">${r.type_label}</span></td>` +
            `<td>${fmtInt(r.sample_count)}</td><td>${r.num_classes}</td><td>${(r.uploaded_at || "").slice(0, 16)}</td>` +
            `<td><span class="tag ${r.status === "已入库" ? "loaded" : "orange"}">${r.status}</span></td>` +
            `<td><span class="link-blue act-preview">预览</span><span class="link-red act-del">删除</span></td></tr>`).join("");
        }
        const pag = $(".pagination span");
        if (pag) pag.textContent = "共 " + d.list.length + " 条";
        const dsSel = $(".dataset-select");
        if (dsSel && d.selected) { Array.from(dsSel.childNodes).forEach((n) => { if (n.nodeType === 3) dsSel.removeChild(n); }); dsSel.insertBefore(document.createTextNode(d.selected + " "), dsSel.firstChild); }
        $$(".data-table tbody tr").forEach((tr) => {
          const id = tr.getAttribute("data-id");
          const pv = $(".act-preview", tr);
          if (pv) { pv.style.cursor = "pointer"; pv.onclick = () => (location.href = "/preview.html?auto=preview"); }
          const del = $(".act-del", tr);
          if (del) { del.style.cursor = "pointer"; del.onclick = async () => { if (!confirm("确认删除该数据集？")) return; try { await api("/api/datasets/" + id, { method: "DELETE" }); toast("已删除"); loadList(); loadDist(); } catch (e) { toast(e.message, "error"); } }; }
        });
        refreshIcons();
      } catch (e) { toast(e.message, "error"); }
    }

    async function loadDist() {
      try {
        const d = await api("/api/datasets/distribution");
        const cards = $$(".summary-grid .summary-card");
        if (cards[0]) $("b", cards[0]).textContent = fmtInt(d.train_count);
        if (cards[1]) $("b", cards[1]).textContent = fmtInt(d.test_count);
        if (cards[2]) $("b", cards[2]).textContent = d.num_classes;
        if (cards[3]) { const b = $("b", cards[3]); b.textContent = d.label_map_loaded ? "已加载" : "未加载"; b.className = d.label_map_loaded ? "green" : ""; }
        const tr = d.donut[0], te = d.donut[1];
        const donut = $(".distribution .donut"), span = $(".distribution .donut span");
        if (donut) donut.style.background = `conic-gradient(#dc2626 0% ${tr.ratio}%, #ffc0c0 ${tr.ratio}% 100%)`;
        if (span) span.textContent = tr.ratio + "%";
        const legends = $$(".dist-legend .legend-row");
        if (legends[0]) legends[0].querySelector("span:last-child").textContent = `${fmtInt(tr.count)} (${tr.ratio}%)`;
        if (legends[1]) legends[1].querySelector("span:last-child").textContent = `${fmtInt(te.count)} (${te.ratio}%)`;
      } catch (e) {}
    }

    async function loadDbStatus() {
      try {
        const s = await api("/api/datasets/db-status");
        const vals = $$(".db-panel .db-info .value");
        if (vals[0]) vals[0].textContent = s.tables;
        if (vals[1]) vals[1].textContent = (s.last_sync || "").slice(5, 16) || "—";
        if (vals[2]) vals[2].textContent = s.storage_mb + " MB";
      } catch (e) {}
    }

    function showStatsModal() {
      api("/api/datasets/distribution").then((d) => {
        const tr = d.donut[0], te = d.donut[1];
        const html = `<div style="text-align:center"><div style="width:240px;height:240px;border-radius:50%;margin:6px auto;background:conic-gradient(#dc2626 0% ${tr.ratio}%, #ffc0c0 ${tr.ratio}% 100%);display:flex;align-items:center;justify-content:center"><div style="width:150px;height:150px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#dc2626">${tr.ratio}%</div></div>` +
          `<div style="margin-top:14px"><span style="color:#dc2626">●</span> 训练集 ${fmtInt(tr.count)} (${tr.ratio}%)　<span style="color:#ffc0c0">●</span> 测试集 ${fmtInt(te.count)} (${te.ratio}%)</div>` +
          `<div style="margin-top:8px;color:#6b7280">类别数：${d.num_classes}　标签映射：${d.label_map_loaded ? "已加载" : "未加载"}</div></div>`;
        modal("数据集分布统计", html, { width: "420px" });
      }).catch((e) => toast(e.message, "error"));
    }

    const refreshBtn = $(".dataset-panel .small-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => { loadList(); toast("已刷新"); });

    $$(".quick-panel .quick-card").forEach((q) => {
      q.style.cursor = "pointer";
      const t = q.textContent;
      q.addEventListener("click", () => {
        if (t.indexOf("开始预览") >= 0) location.href = "/preview.html?auto=preview";
        else if (t.indexOf("进入清洗") >= 0) location.href = "/preview.html?auto=clean";
        else if (t.indexOf("查看统计") >= 0) showStatsModal();
        else if (t.indexOf("重新上传") >= 0) pickFile("train");
      });
    });

    loadList(); loadDist(); loadDbStatus();
    refreshIcons();
  }

  /* ----------------- 数据预览与清洗 ----------------- */
  async function initPreview() {
    const state = { page: 1, tab: "raw", q: "", label: "", data_type: "", length: "" };
    let names = config_default_names();

    // 标签名（用于过滤下拉）
    try { const dd = await api("/api/datasets/distribution"); if (dd.label_names && dd.label_names.length) names = dd.label_names; } catch (e) {}

    // 过滤下拉
    const fsel = $$(".filter-select");
    const labelOpts = [{ key: "", label: "全部标签" }].concat(names.map((n, i) => ({ key: String(i), label: `${i} · ${n}` })));
    if (fsel[0]) customDropdown(fsel[0], [{ key: "", label: "全部类别" }].concat(names.map((n, i) => ({ key: String(i), label: n }))), (k) => { state.label = k; state.page = 1; loadPreview(); }, { key: "", label: "全部类别" });
    if (fsel[1]) customDropdown(fsel[1], [{ key: "", label: "全部数据类型" }, { key: "train", label: "训练集" }, { key: "test", label: "测试集" }], (k) => { state.data_type = k; state.page = 1; loadPreview(); }, { key: "", label: "全部数据类型" });
    if (fsel[2]) customDropdown(fsel[2], labelOpts, (k) => { state.label = k; state.page = 1; loadPreview(); }, { key: "", label: "全部标签" });
    if (fsel[3]) customDropdown(fsel[3], [{ key: "", label: "文本长度" }, { key: "0-10", label: "0-10" }, { key: "11-20", label: "11-20" }, { key: "21-30", label: "21-30" }, { key: "31-50", label: "31-50" }, { key: "50+", label: "50+" }], (k) => { state.length = k; state.page = 1; loadPreview(); }, { key: "", label: "文本长度" });
    const fsearch = $(".filter-search");
    if (fsearch) { fsearch.style.cursor = "text"; fsearch.addEventListener("click", () => { const kw = prompt("搜索文本内容：", state.q) || ""; state.q = kw.trim(); state.page = 1; loadPreview(); }); }

    // 预览 tabs
    const tabs = $$(".preview-tabs .tab");
    if (tabs[1]) tabs[1].addEventListener("click", () => { state.tab = "raw"; tabs[1].classList.add("active"); tabs[2] && tabs[2].classList.remove("active"); loadPreview(); });
    if (tabs[2]) tabs[2].addEventListener("click", () => { state.tab = "clean"; tabs[2].classList.add("active"); tabs[1] && tabs[1].classList.remove("active"); loadPreview(); });
    tabs.forEach((t) => (t.style.cursor = "pointer"));

    async function loadPreview() {
      try {
        const qs = new URLSearchParams({ page: state.page, page_size: 30, tab: state.tab });
        if (state.q) qs.set("q", state.q);
        if (state.label !== "") qs.set("label", state.label);
        if (state.data_type) qs.set("data_type", state.data_type);
        if (state.length) qs.set("length", state.length);
        const d = await api("/api/preview?" + qs.toString());
        const sc = d.stat_cards;
        const cards = $$(".stat-grid .stat-card");
        const setC = (i, v) => { if (cards[i]) setText($(".stat-value", cards[i]), v); };
        setC(0, fmtInt(sc.train_count)); setC(1, fmtInt(sc.test_count));
        setC(2, sc.missing); setC(3, fmtInt(sc.duplicate));
        setC(4, sc.avg_length); setC(5, sc.usable_rate + "%");
        const tb = $(".big-table-wrap .data-table tbody");
        if (tb) {
          if (!d.rows.length) tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:18px">无匹配数据</td></tr>`;
          else tb.innerHTML = d.rows.map((r, i) =>
            `<tr><td>${(state.page - 1) * 30 + i + 1}</td><td class="text">${esc(r.text)}</td><td>${r.label}</td><td>${r.label_name}</td><td>${r.data_type}</td><td>${r.length}</td>` +
            `<td><span class="status-badge ${r.status === "正常" ? "" : "bad"}">${r.status}</span></td></tr>`).join("");
        }
        const foot = $(".table-footer > span");
        if (foot) foot.textContent = "共 " + fmtInt(d.total) + " 条";
        const pageNum = $(".table-footer .page-num");
        if (pageNum) pageNum.textContent = state.page;
      } catch (e) { toast(e.message, "error"); }
    }
    // 翻页
    const chevrons = $$(".table-footer .pages svg");
    if (chevrons[0]) chevrons[0].addEventListener("click", () => { if (state.page > 1) { state.page--; loadPreview(); } });
    if (chevrons[1]) chevrons[1].addEventListener("click", () => { state.page++; loadPreview(); });
    const refreshBtn = $(".filter-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadPreview());

    // 清洗规则开关
    const ruleKeys = ["strip_whitespace", "remove_abnormal", "keep_allowed", "drop_empty", "drop_duplicate", "min_length"];
    const ruleState = {}; ruleKeys.forEach((k) => (ruleState[k] = true));
    const ruleRows = $$(".rules-panel .rule-row .toggle-green");
    ruleRows.forEach((tg, i) => {
      tg.style.cursor = "pointer";
      tg.addEventListener("click", () => {
        const on = tg.getAttribute("data-off") !== "1";
        tg.setAttribute("data-off", on ? "1" : "0");
        tg.style.opacity = on ? "0.35" : "1";
        ruleState[ruleKeys[i]] = !on;
      });
    });
    function buildRules() {
      const r = {};
      ruleKeys.forEach((k) => { if (k !== "min_length") r[k] = !!ruleState[k]; });
      r.min_length = ruleState.min_length ? 2 : 0;
      return r;
    }

    async function runClean() {
      const btn = $(".rules-panel .red-btn");
      if (btn) { btn.disabled = true; btn.textContent = "清洗中…"; }
      try {
        const res = await postJSON("/api/clean", { rules: buildRules() });
        renderClean(res);
        toast("清洗完成：保留率 " + (res.clean_stats.retain_rate) + "%");
      } catch (e) { toast(e.message, "error"); }
      finally { if (btn) { btn.disabled = false; btn.textContent = "▶ 开始清洗"; } }
    }
    const cleanBtn = $(".rules-panel .red-btn");
    if (cleanBtn) cleanBtn.addEventListener("click", runClean);
    const resetBtn = $(".rules-panel .white-btn");
    if (resetBtn) resetBtn.addEventListener("click", () => { ruleKeys.forEach((k) => (ruleState[k] = true)); ruleRows.forEach((tg) => { tg.setAttribute("data-off", "0"); tg.style.opacity = "1"; }); toast("规则已重置"); });

    function renderClean(res) {
      // 前后对比
      const rows = $$(".compare-box .compare-row");
      (res.before_after || []).forEach((p, i) => {
        const row = rows[i]; if (!row) return;
        const sp = row.children;
        if (sp[1]) sp[1].textContent = p.before;
        if (sp[3]) sp[3].textContent = p.after;
      });
      // 保留率甜甜圈
      const donut = $(".keep-donut"), dspan = $(".keep-donut span");
      const keep = res.retain_donut[0], drop = res.retain_donut[1];
      if (donut) donut.style.background = `conic-gradient(#e11d26 0% ${keep.ratio}%, #f3d3d3 ${keep.ratio}% 100%)`;
      if (dspan) dspan.innerHTML = "保留率<br>" + keep.ratio + "%";
      const legs = $$(".clean-legend .legend-line");
      if (legs[0]) legs[0].querySelector("span:last-child").textContent = `${fmtInt(keep.count)} (${keep.ratio}%)`;
      if (legs[1]) legs[1].querySelector("span:last-child").textContent = `${fmtInt(drop.count)} (${drop.ratio}%)`;
      // 清洗卡片
      const dc = res.detail_cards, cc = $$(".clean-cards .clean-card");
      const setB = (i, v) => { if (cc[i]) $("b", cc[i]).textContent = v; };
      setB(0, fmtInt(dc.before_total)); setB(1, fmtInt(dc.after_kept));
      setB(2, fmtInt(dc.removed_duplicate)); setB(3, fmtInt(dc.removed_empty));
      setB(4, fmtInt(dc.removed_short));
      if (cc[5]) $("b", cc[5]).textContent = `${dc.avg_len_before} → ${dc.avg_len_after}`;
      // 质量分析
      const qcards = $$(".quality-grid .quality-card");
      if (qcards[0]) {
        const brows = $$(".bar-row", qcards[0]);
        const top = res.category_top5 || [];
        const max = Math.max.apply(null, top.map((t) => t.ratio).concat([1]));
        brows.forEach((br, i) => {
          if (!top[i]) { br.style.display = "none"; return; }
          br.style.display = "";
          br.children[0].textContent = top[i].name;
          $(".bar-fill", br).style.width = Math.max(6, (top[i].ratio / max) * 92) + "%";
          br.children[2].textContent = `${fmtInt(top[i].count)}（${top[i].ratio}%）`;
        });
      }
      if (qcards[1]) {
        const lrows = $$(".len-row", qcards[1]);
        const bins = res.length_bins || [];
        const max = Math.max.apply(null, bins.map((b) => b.ratio).concat([1]));
        lrows.forEach((lr, i) => {
          if (!bins[i]) return;
          $(".len-fill", lr).style.width = Math.max(6, (bins[i].ratio / max) * 92) + "%";
          lr.children[2].textContent = `${fmtInt(bins[i].count)}（${bins[i].ratio}%）`;
        });
      }
      if (qcards[2]) {
        const ic = $$(".integrity-card", qcards[2]);
        const g = res.integrity;
        if (ic[0]) ic[0].querySelector(".integrity-text").innerHTML = `缺失率<b>${g.missing_rate.toFixed(2)}%</b>缺失值数量<br>0`;
        if (ic[1]) ic[1].querySelector(".integrity-text").innerHTML = `重复率<b class="orange">${g.duplicate_rate}%</b>重复数量<br>${fmtInt(dc.removed_duplicate)}`;
        if (ic[2]) ic[2].querySelector(".integrity-text").innerHTML = `可用率<b>${g.usable_rate}%</b>可用数量<br>${fmtInt(dc.after_kept)}`;
      }
      refreshIcons();
    }

    // 入口参数：?auto=preview 仅预览；?auto=clean 自动执行清洗
    loadPreview();
    const auto = new URLSearchParams(location.search).get("auto");
    if (auto === "clean") setTimeout(runClean, 400);
    refreshIcons();
  }
  function config_default_names() {
    return ["财经", "房产", "股票", "教育", "科技", "社会", "时政", "体育", "游戏", "娱乐"];
  }

  /* ----------------- TF-IDF 特征提取 ----------------- */
  async function initFeatures() {
    let params = {};
    let help = {};
    function makeInputEditable(el, key, isNum) {
      el.setAttribute("contenteditable", "true");
      el.style.outline = "none";
      el.addEventListener("input", () => {
        const v = el.textContent.trim();
        params[key] = isNum ? (v.indexOf(".") >= 0 ? parseFloat(v) : parseInt(v, 10)) : v;
      });
    }
    try {
      const cfg = await api("/api/tfidf/config");
      params = Object.assign({}, cfg.params);
      help = cfg.param_help || {};
      // 数据集信息
      const drows = $$(".dataset-table .dataset-row b");
      if (drows[0]) drows[0].textContent = cfg.dataset.name;
      if (drows[1]) drows[1].textContent = fmtInt(cfg.dataset.train_count) + " 条";
      if (drows[2]) drows[2].textContent = fmtInt(cfg.dataset.test_count) + " 条";
      if (drows[3]) drows[3].textContent = cfg.dataset.num_classes + " 类";
      // 表单
      const rows = $$(".param-panel .form-row");
      rows.forEach((row) => {
        const labelEl = $(".form-label", row);
        const key = (labelEl.childNodes[0].nodeValue || "").trim();
        const tip = $(".info-small", labelEl);
        if (tip && help[key]) { tip.style.cursor = "pointer"; tip.addEventListener("click", (e) => { e.stopPropagation(); showTip(tip, help[key]); }); }
        const sel = $(".select", row), inp = $(".input", row), sw = $(".switch", row);
        if (key === "analyzer" && sel) customDropdown(sel, [{ key: "char", label: "char" }, { key: "word", label: "word" }], (k) => (params.analyzer = k), { key: params.analyzer || "char", label: params.analyzer || "char" });
        else if (key === "ngram_range" && sel) customDropdown(sel, [{ key: "1,1", label: "(1, 1)" }, { key: "1,2", label: "(1, 2)" }, { key: "1,3", label: "(1, 3)" }, { key: "2,3", label: "(2, 3)" }], (k) => { const a = k.split(","); params.ngram_min = +a[0]; params.ngram_max = +a[1]; }, { key: params.ngram_min + "," + params.ngram_max, label: `(${params.ngram_min}, ${params.ngram_max})` });
        else if (key === "norm" && sel) customDropdown(sel, [{ key: "l2", label: "l2" }, { key: "l1", label: "l1" }], (k) => (params.norm = k), { key: params.norm || "l2", label: params.norm || "l2" });
        else if (inp) { inp.textContent = params[key]; makeInputEditable(inp, key, true); }
        else if (sw) {
          const paint = () => { sw.style.background = params[key] ? "#16a34a" : "#cbd5e1"; sw.style.borderRadius = "999px"; };
          sw.setAttribute("data-on", params[key] ? "1" : "0"); paint();
          sw.style.cursor = "pointer";
          sw.addEventListener("click", () => { params[key] = !params[key]; paint(); });
        }
      });
    } catch (e) { toast(e.message, "error"); }

    function renderExtract(d) {
      const ov = d.overview;
      const cards = $$(".feature-cards .feature-card .value");
      if (cards[0]) cards[0].textContent = fmtInt(ov.train_features);
      if (cards[1]) cards[1].textContent = fmtInt(ov.test_features);
      if (cards[2]) cards[2].textContent = ov.train_matrix;
      if (cards[3]) cards[3].textContent = ov.test_matrix;
      if (cards[4]) cards[4].textContent = ov.sparsity + "%";
      if (cards[5]) cards[5].textContent = ov.memory_mb + " MB";
      // top features
      const tb = $(".keyword-table tbody");
      if (tb && d.top_features) tb.innerHTML = d.top_features.map((f) => `<tr><td>${f.rank}</td><td>${esc(f.feature)}</td><td>${f.idf}</td><td>${f.df}</td></tr>`).join("");
      // 类型环形图
      const tbk = d.type_breakdown || {};
      const total = Object.values(tbk).reduce((a, b) => a + b, 0) || 1;
      const order = ["单字", "双字", "三字", "四字及以上"];
      const colors = ["#e11d26", "#f97316", "#f59e0b", "#16a34a"];
      let acc = 0; const segs = [];
      order.forEach((k, i) => { const v = tbk[k] || 0; const r = v / total * 100; segs.push(`${colors[i]} ${acc}% ${acc + r}%`); acc += r; });
      const donut = $(".big-donut");
      if (donut) donut.style.background = `conic-gradient(${segs.join(",")})`;
      const legs = $$(".donut-legend .legend-line span:last-child");
      order.forEach((k, i) => { const v = tbk[k] || 0; if (legs[i]) legs[i].innerHTML = `${k === "单字" ? "单字特征（1-gram）" : k === "双字" ? "双字特征（2-gram）" : k === "三字" ? "三字特征（3-gram）" : "四字及以上 (n-gram)"}<br>${fmtInt(v)} (${(v / total * 100).toFixed(2)}%)`; });
      const dtotal = $(".donut-total span:last-child");
      if (dtotal) dtotal.textContent = `${fmtInt(total)} (100%)`;
      // 稀疏度表
      const st = d.sparsity_table || {};
      const tr = st.train || {}, te = st.test || {};
      const strows = $$(".stats-table tbody tr");
      const sp = (m, nz) => (m.n_features ? (100 - nz / m.n_features * 100).toFixed(2) + "%" : "—");
      const vals = [
        [tr.avg_nonzero, te.avg_nonzero], [fmtInt(tr.max_nonzero), fmtInt(te.max_nonzero)],
        [fmtInt(tr.min_nonzero), fmtInt(te.min_nonzero)], [tr.sparsity + "%", (te.sparsity != null ? te.sparsity + "%" : "—")],
        [sp(tr, tr.min_nonzero), te.n_features ? sp(te, te.min_nonzero) : "—"],
        [sp(tr, tr.max_nonzero), te.n_features ? sp(te, te.max_nonzero) : "—"],
      ];
      strows.forEach((row, i) => { if (vals[i]) { row.children[1].textContent = vals[i][0]; row.children[2].textContent = vals[i][1]; } });
      // 步骤
      $$(".steps .step").forEach((s, i) => s.classList.toggle("active", i === 2));
      refreshIcons();
    }

    const extractBtn = $(".param-actions .primary-btn");
    if (extractBtn) {
      extractBtn.style.cursor = "pointer";
      extractBtn.addEventListener("click", async () => {
        extractBtn.disabled = true; const old = extractBtn.innerHTML; extractBtn.innerHTML = "提取中…";
        $$(".steps .step").forEach((s, i) => s.classList.toggle("active", i === 1));
        try { const d = await postJSON("/api/tfidf/extract", { params }); renderExtract(d); toast("特征提取完成：" + fmtInt(d.overview.train_features) + " 维"); }
        catch (e) { toast("提取失败：" + e.message, "error"); }
        finally { extractBtn.disabled = false; extractBtn.innerHTML = old; refreshIcons(); }
      });
    }
    const resetBtn = $(".param-actions .ghost-btn");
    if (resetBtn) resetBtn.addEventListener("click", () => location.reload());
    const saveBtn = $$(".bottom-actions .bottom-btn")[0];
    if (saveBtn) saveBtn.addEventListener("click", async () => { try { await postJSON("/api/tfidf/save-config", { params }); toast("配置已保存"); } catch (e) { toast(e.message, "error"); } });
    const nextBtn = $(".next-btn");
    if (nextBtn) nextBtn.addEventListener("click", () => (location.href = "/training.html"));
    const headInfo = $(".page-title .info-dot");
    if (headInfo) { headInfo.style.cursor = "pointer"; headInfo.addEventListener("click", (e) => { e.stopPropagation(); showTip(headInfo, "TF-IDF 把清洗后的文本转成稀疏特征向量：可配置字符/词 n-gram、最小/最大文档频率、特征上限等，供朴素贝叶斯与逻辑回归训练。"); }); }
    refreshIcons();
  }

  /* ----------------- 深度学习参数优化 ----------------- */
  async function initOptimization() {
    let objective = "macro_f1";
    let esOn = true;
    let help = {};

    // 目标单选
    const goals = $$(".goals .goal");
    const objMap = { "Macro-F1": "macro_f1", "Accuracy": "accuracy", "Weighted-F1": "weighted_f1" };
    goals.forEach((g) => { g.style.cursor = "pointer"; g.addEventListener("click", () => { goals.forEach((x) => x.classList.remove("active")); g.classList.add("active"); objective = objMap[g.textContent.trim()] || "macro_f1"; }); });
    // 早停开关
    const esSwitch = $(".config .switch");
    if (esSwitch) { esSwitch.style.cursor = "pointer"; const paint = () => (esSwitch.style.background = esOn ? "#16a34a" : "#cbd5e1"); paint(); esSwitch.addEventListener("click", () => { esOn = !esOn; paint(); }); }
    // 配置项可编辑 + ⓘ 提示
    $$(".config .field").forEach((f) => {
      const ctrl = $(".ctrl", f), lab = $("label", f);
      if (ctrl) { ctrl.setAttribute("contenteditable", "true"); ctrl.style.outline = "none"; }
      if (lab && /ⓘ/.test(lab.textContent)) {
        lab.style.cursor = "pointer";
        lab.addEventListener("click", (e) => {
          e.stopPropagation();
          const t = lab.textContent;
          const key = t.indexOf("隐藏层") >= 0 ? "hidden_units" : t.indexOf("早停") >= 0 ? "early_stopping" : t.indexOf("编码") >= 0 ? "encoding" : null;
          if (key && help[key]) showTip(lab, help[key]);
        });
      }
    });

    function collectConfig() {
      const cfg = { objective: objective, early_stopping: esOn };
      $$(".config .field").forEach((f) => {
        const lab = $("label", f), ctrl = $(".ctrl", f);
        if (!lab || !ctrl) return;
        const t = lab.textContent, v = (ctrl.textContent || "").trim();
        if (t.indexOf("随机种子") >= 0) cfg.random_state = parseInt(v) || 617;
        else if (t.indexOf("初始参数") >= 0) cfg.init_samples = parseInt(v) || 16;
        else if (t.indexOf("每轮候选") >= 0) cfg.per_round = parseInt(v) || 20;
        else if (t.indexOf("优化轮数") >= 0) cfg.rounds = parseInt(v) || 8;
        else if (t.indexOf("学习率") >= 0) cfg.learning_rate = parseFloat(v) || 0.001;
        else if (t.indexOf("隐藏层") >= 0) cfg.hidden_units = v || "64,32";
        else if (t.indexOf("batch") >= 0) cfg.batch_size = parseInt(v) || 64;
        else if (t.indexOf("epochs") >= 0) cfg.epochs = parseInt(v) || 200;
        else if (t.indexOf("耐心") >= 0) cfg.patience = parseInt(v) || 10;
        else if (t.indexOf("编码") >= 0) cfg.encoding = v || "正态分布编码";
      });
      return cfg;
    }

    function fmtParams(p) {
      const bits = [`ngram(1,${p.ngram_max})`];
      if (p.C != null) bits.push(`C=${p.C}`);
      if (p.alpha != null) bits.push(`alpha=${p.alpha}`);
      return `${bits.join(" | ")}<br>min_df=${p.min_df} | max_df=${p.max_df} | max_features=${fmtInt(p.max_features)}`;
    }

    function render(res) {
      const sc = res.stat_cards || {};
      const cards = $$(".stats .stat");
      const setV = (i, v) => { if (cards[i]) setText($(".val", cards[i]) || $("div[style]", cards[i]), v); };
      if (cards[0]) setText($(".val", cards[0]), sc.experiments);
      if (cards[1]) setText($(".val", cards[1]), sc.random_state);
      if (cards[2]) setText($(".val", cards[2]), sc.candidate_count);
      if (cards[3]) setText($(".val", cards[3]), sc.rounds || "—");
      if (cards[4]) setText($(".val", cards[4]), sc.best_score);
      if (cards[5]) { const d = cards[5].querySelector("div[style]"); if (d) d.textContent = (sc.best_model_name || "—") + " + TF-IDF"; }

      // 排行榜（仅 朴素贝叶斯 / 逻辑回归）
      const tb = $(".rank table tbody");
      if (tb && res.leaderboard) {
        const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
        tb.innerHTML = res.leaderboard.map((r) =>
          `<tr><td class="medal">${medals[r.rank] || r.rank}</td><td>${r.model}</td><td>${fmtParams(r.params)}</td>` +
          `<td>${r.predicted != null ? r.predicted : "—"}</td><td style="${r.rank === 1 ? "color:#e11d26;font-weight:900" : ""}">${r.actual}</td>` +
          `<td><span class="status${r.rank === 1 ? "" : " gray"}">${r.status}</span></td></tr>`).join("");
      }

      // 最优参数推荐
      const plists = $$(".recommend .plist");
      const t = (res.best_params || {}).tfidf || {}, m = res.best_params || {};
      if (plists[0]) plists[0].innerHTML = `<span>ngram_range</span><b>(${t.ngram_min || 1}, ${t.ngram_max})</b><span>min_df</span><b>${t.min_df}</b><span>max_df</span><b>${t.max_df}</b><span>max_features</span><b>${fmtInt(t.max_features)}</b>`;
      const secs = $$(".recommend .section");
      if (secs[1]) secs[1].textContent = `模型（最优：${res.best_model_name || ""}）`;
      if (plists[1]) plists[1].innerHTML = `<span>朴素贝叶斯 alpha</span><b>${(m.nb || {}).alpha}</b><span>逻辑回归 C</span><b>${(m.lr || {}).C}</b><span>最优指标</span><b>${res.objective || "macro_f1"}</b><span>最优得分</span><b>${res.best_score}</b>`;

      // 参数重要性
      const hrows = $$(".bar-area .hrow");
      const imp = res.importance || [];
      const maxS = Math.max.apply(null, imp.map((x) => x.score).concat([0.001]));
      hrows.forEach((row, i) => {
        const lab = $(".hlabel", row), bar = $(".hbar", row), val = $(".hvalue", row);
        if (imp[i]) { if (lab) lab.textContent = imp[i].label; if (bar) bar.style.width = Math.max(3, imp[i].score / maxS * 100) + "%"; if (val) val.textContent = imp[i].score.toFixed(3); }
        else { if (lab) lab.textContent = "—"; if (bar) bar.style.width = "0%"; if (val) val.textContent = "0.000"; }
      });

      // 历史曲线
      const svg = $(".line-chart .line-svg"), tagVal = $(".tag-val");
      if (tagVal && res.best_score != null) tagVal.textContent = res.best_score;
      if (svg && res.history && res.history.length) {
        const W = 570, lo = 0.6, hi = 1.0, h = res.history;
        const yOf = (v) => ((hi - v) / (hi - lo) * 170).toFixed(1);
        const xOf = (i) => (h.length > 1 ? (i / (h.length - 1) * W).toFixed(1) : 0);
        const paths = svg.querySelectorAll("path");
        if (paths[0]) paths[0].setAttribute("d", "M" + h.map((x, i) => `${xOf(i)} ${yOf(x.objective)}`).join(" L"));
        if (paths[1]) paths[1].setAttribute("d", "M" + h.map((x, i) => `${xOf(i)} ${yOf(x.baseline)}`).join(" L"));
        const g = svg.querySelector("g");
        if (g) { const step = Math.ceil(h.length / 9) || 1; g.innerHTML = h.filter((_, i) => i % step === 0).map((x) => { const i = h.indexOf(x); return `<circle cx="${xOf(i)}" cy="${yOf(x.objective)}" r="3"/>`; }).join(""); }
      }

      // 网络结构
      const netLine = $(".proxy .pcard div[style]");
      if (netLine && res.network_structure) netLine.textContent = res.network_structure;

      // 步骤完成
      $$(".stepper .step").forEach((s) => { s.classList.remove("current", "pending"); s.classList.add("done"); });
      const runState = $$(".status-row .scard .sval")[1];
      if (runState) { runState.textContent = "已完成"; }
      refreshIcons();
    }

    // 初始化
    try {
      const cfg = await api("/api/optimization/config");
      help = cfg.param_help || {};
      const c = cfg.config || {};
      // 用真实默认填充配置项
      $$(".config .field").forEach((f) => {
        const lab = $("label", f), ctrl = $(".ctrl", f);
        if (!lab || !ctrl) return;
        const setCtrl = (v) => { const sv = ctrl.querySelector("svg"); ctrl.textContent = v + " "; if (sv) ctrl.appendChild(sv); };
        const t = lab.textContent;
        if (t.indexOf("随机种子") >= 0) setCtrl(c.random_state);
        else if (t.indexOf("初始参数") >= 0) setCtrl(c.init_samples);
        else if (t.indexOf("每轮候选") >= 0) setCtrl(c.per_round);
        else if (t.indexOf("优化轮数") >= 0) setCtrl(c.rounds);
        else if (t.indexOf("学习率") >= 0) setCtrl(c.learning_rate);
        else if (t.indexOf("隐藏层") >= 0) setCtrl(c.hidden_units);
        else if (t.indexOf("epochs") >= 0) setCtrl(c.epochs);
        else if (t.indexOf("耐心") >= 0) setCtrl(c.patience);
      });
    } catch (e) {}
    try {
      const res = await api("/api/optimization/result");
      if (res.has_result) render(res);
    } catch (e) {}

    const runBtn = $(".config .actions .btn.primary");
    if (runBtn) {
      runBtn.style.cursor = "pointer";
      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true; const old = runBtn.innerHTML; runBtn.innerHTML = "优化中…（请稍候）";
        $$(".stepper .step").forEach((s, i) => { s.classList.toggle("current", i === 2); });
        try { const res = await postJSON("/api/optimization/run", { config: collectConfig() }); render(res); toast("优化完成：最优 " + res.best_model_name + " " + res.objective + "=" + res.best_score, "info"); }
        catch (e) { toast("优化失败：" + e.message, "error"); }
        finally { runBtn.disabled = false; runBtn.innerHTML = old; refreshIcons(); }
      });
    }
    const resetBtn = $(".config .actions .btn.ghost");
    if (resetBtn) resetBtn.addEventListener("click", () => location.reload());
    const rankRefresh = $(".rank .mini");
    if (rankRefresh) rankRefresh.addEventListener("click", async () => { try { const res = await api("/api/optimization/result"); if (res.has_result) render(res); } catch (e) {} });

    // 快捷操作
    $$(".quick .qcard").forEach((q) => {
      q.style.cursor = "pointer";
      const t = q.textContent;
      q.addEventListener("click", () => {
        if (t.indexOf("模型评价") >= 0) location.href = "/evaluation.html";
        else if (t.indexOf("导出") >= 0) location.href = "/reports.html";
        else if (t.indexOf("保存") >= 0) toast("优化记录已自动保存");
        else if (t.indexOf("最优结果") >= 0) { const el = $(".recommend"); if (el) el.scrollIntoView({ behavior: "smooth" }); }
      });
    });
    refreshIcons();
  }

  /* ----------------- 模型评价与可视化 ----------------- */
  async function initEvaluation() {
    let d;
    try { d = await api("/api/evaluation"); } catch (e) { toast(e.message, "error"); return; }
    if (!d.trained) { toast(d.message || "尚未训练模型", "warn"); return; }

    // 指标卡片
    const mc = d.metric_cards || {};
    const cards = $$(".stat-grid .stat-card");
    const keyOrder = ["accuracy", "precision", "recall", "f1", "macro_f1", "auc"];
    keyOrder.forEach((k, i) => {
      const card = cards[i]; if (!card || !mc[k]) return;
      setText($(".stat-value", card), fmtPct(mc[k].value));
      const sub = $(".stat-sub", card);
      if (sub) sub.innerHTML = mc[k].delta ? subWithDelta("较上次", mc[k]) : "较上次 首次";
    });

    // 模型对比柱状图（原生）
    const cmp = d.comparison;
    const groups = $$(".compare-panel .bars .group");
    if (cmp) groups.forEach((g, i) => {
      const red = $(".bar.red", g), blue = $(".bar.blue", g);
      if (red && cmp.nb[i] != null) { red.style.height = cmp.nb[i] + "%"; $("em", red) && ($("em", red).textContent = cmp.nb[i] + "%"); }
      if (blue && cmp.lr[i] != null) { blue.style.height = cmp.lr[i] + "%"; $("em", blue) && ($("em", blue).textContent = cmp.lr[i] + "%"); }
    });

    // 各类别 F1（原生）
    const f1s = (d.f1_per_class || []).slice().sort((a, b) => b.f1 - a.f1);
    const f1bars = $$(".f1-chart .f1bars .f1bar");
    const f1x = $$(".f1-chart .f1x span");
    f1s.slice(0, f1bars.length).forEach((c, i) => {
      const v = (c.f1 * 100);
      if (f1bars[i]) { f1bars[i].style.height = v.toFixed(1) + "%"; const em = $("em", f1bars[i]); if (em) em.textContent = v.toFixed(1); }
      if (f1x[i]) f1x[i].textContent = c.name;
    });

    // 混淆矩阵热力（原生 10x10）
    function paintHeat(box, matrix) {
      if (!box || !matrix) return;
      const cells = $$(".cell", box);
      const n = matrix.length;
      matrix.forEach((row, r) => {
        const rowSum = row.reduce((a, b) => a + b, 0) || 1;
        row.forEach((v, c) => {
          const cell = cells[r * n + c];
          if (!cell) return;
          const a = v / rowSum;
          cell.className = "cell";
          cell.style.background = `rgba(225,29,38,${Math.max(0.04, a).toFixed(3)})`;
          cell.title = `真实「${d.confusion.labels[r]}」→ 预测「${d.confusion.labels[c]}」：${v}`;
        });
      });
    }
    const heatBoxes = $$(".matrix-box .heat");
    paintHeat(heatBoxes[0], d.confusion && d.confusion.nb);
    paintHeat(heatBoxes[1], d.confusion && d.confusion.lr);

    // 分类报告表
    const rt = $(".report-table tbody");
    if (rt && d.classification_report) {
      const rows = d.classification_report.map((c) =>
        `<tr><td>${c.name}</td><td>${c.precision.toFixed(2)}</td><td>${c.recall.toFixed(2)}</td><td>${c.f1.toFixed(2)}</td><td>${fmtInt(c.support)}</td></tr>`).join("");
      const best = d.metric_cards;
      rt.innerHTML = rows + `<tr><td style="font-weight:900">平均/总计</td><td>${fmtPct(best.precision.value, 0) === "—" ? "—" : best.precision.value.toFixed(2)}</td>` +
        `<td>${best.recall.value.toFixed(2)}</td><td class="redtext">${best.macro_f1.value.toFixed(2)}</td><td style="font-weight:900">${fmtInt(d.support_total)}</td></tr>`;
    }

    // 当前结论（大模型/规则）
    const items = $$(".conclusion .summary-item p");
    (d.conclusions || []).slice(0, items.length).forEach((b, i) => { if (items[i]) items[i].innerHTML = `<b>${esc(b)}</b>`; });

    // Tab 切换：模型对比=原生柱状；其余切到后端 PNG
    const tabs = $$(".compare-panel .tabs .tab");
    const barChart = $(".compare-panel .bar-chart");
    const legend = $(".compare-panel .chart-head .legend");
    const h3 = $(".compare-panel .chart-head h3");
    let img = document.createElement("img");
    img.style.cssText = "display:none;width:100%;max-height:330px;object-fit:contain;margin-top:8px;";
    if (barChart) barChart.parentNode.insertBefore(img, barChart.nextSibling);
    const charts = d.charts || {};
    const tabMap = {
      "训练集分布": charts.category, "测试集分布": charts.category,
      "F1-score": charts.f1, "混淆矩阵": charts.confusion_lr,
    };
    tabs.forEach((tab) => {
      tab.style.cursor = "pointer";
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const key = tab.textContent.trim();
        if (key === "模型对比") { if (barChart) barChart.style.display = ""; if (legend) legend.style.display = ""; img.style.display = "none"; if (h3) h3.textContent = "模型性能对比（越高越好）"; return; }
        if (key === "分类报告") { if (barChart) barChart.style.display = "none"; if (legend) legend.style.display = "none"; img.style.display = "none"; $(".report-table") && $(".report-table").scrollIntoView({ behavior: "smooth" }); if (h3) h3.textContent = "分类报告（见下方表格）"; return; }
        const url = tabMap[key];
        if (!url) return;
        if (barChart) barChart.style.display = "none";
        if (legend) legend.style.display = "none";
        img.src = url + "?t=" + Date.now();
        img.style.display = "block";
        if (h3) h3.textContent = key;
      });
    });

    // 快捷操作
    $$(".lower-grid .quick-card").forEach((q) => {
      q.style.cursor = "pointer";
      const t = q.textContent;
      q.addEventListener("click", () => {
        if (t.indexOf("文本预测") >= 0) location.href = "/prediction.html";
        else if (t.indexOf("导出") >= 0) location.href = "/reports.html";
        else if (t.indexOf("混淆矩阵") >= 0 && charts.confusion_lr) window.open(charts.confusion_lr, "_blank");
        else if (t.indexOf("全部图表") >= 0 && charts.comparison) window.open(charts.comparison, "_blank");
      });
    });
    refreshIcons();
  }

  /* ----------------- 错误样本与关键词解释 ----------------- */
  async function initErrors() {
    const state = { q: "", true: "", pred: "", page: 1 };
    let names = [];
    try { const dd = await api("/api/datasets/distribution"); if (dd.label_names && dd.label_names.length) names = dd.label_names; } catch (e) {}

    // 过滤下拉
    const sels = $$(".left-panel .filter-row .select-box");
    if (sels[0]) customDropdown(sels[0], [{ key: "", label: "全部真实类别" }].concat(names.map((n) => ({ key: n, label: n }))), (k) => { state.true = k; state.page = 1; load(); }, { key: "", label: "全部真实类别" });
    if (sels[1]) customDropdown(sels[1], [{ key: "", label: "全部预测类别" }].concat(names.map((n) => ({ key: n, label: n }))), (k) => { state.pred = k; state.page = 1; load(); }, { key: "", label: "全部预测类别" });
    const fsearch = $(".left-panel .filter-search");
    if (fsearch) { fsearch.style.cursor = "text"; fsearch.addEventListener("click", () => { state.q = (prompt("搜索错误样本文本：", state.q) || "").trim(); state.page = 1; load(); }); }

    async function load() {
      try {
        const qs = new URLSearchParams({ page: state.page, page_size: 10 });
        if (state.q) qs.set("q", state.q);
        if (state.true) qs.set("true", state.true);
        if (state.pred) qs.set("pred", state.pred);
        const d = await api("/api/errors?" + qs.toString());
        if (!d.trained) { toast(d.message || "尚未训练模型", "warn"); return; }
        // summary
        const s = d.summary, cards = $$(".summary-grid .summary-card");
        if (cards[0]) { setText($(".value", cards[0]), fmtInt(s.total_errors)); $(".sub", cards[0]).textContent = "占比 " + s.error_rate + "%"; }
        if (cards[1]) setText($(".value", cards[1]), s.confusable_pairs);
        if (cards[2]) setText($(".value", cards[2]), s.avg_confidence);
        if (cards[3]) setText($(".value", cards[3]), s.explainable_coverage + "%");
        if (cards[4]) setText($(".value", cards[4]), fmtInt(s.analyzed));
        // 错误样本表
        const tb = $(".left-panel .data-table tbody");
        if (tb) {
          if (!d.errors.length) tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#16a34a;padding:18px">无错误样本 🎉</td></tr>`;
          else tb.innerHTML = d.errors.map((r, i) =>
            `<tr><td>${(state.page - 1) * 10 + i + 1}</td><td class="text">${esc((r.text || "").slice(0, 32))}…</td><td>${r.true_name}</td><td>${r.pred_name}</td>` +
            `<td>${r.confidence}</td><td>${r.model}</td><td>${esc(r.reason)}</td><td class="eye"><svg class="icon sicon"><use href="#i-eye"/></svg></td></tr>`).join("");
        }
        const foot = $(".left-panel .footer > span");
        if (foot) foot.textContent = "共 " + fmtInt(d.total) + " 条";
        // 易混淆类别对
        const hbars = $(".chart-panel .hbars");
        if (hbars && d.confusion_pairs) {
          const max = Math.max.apply(null, d.confusion_pairs.map((p) => p.count).concat([1]));
          hbars.innerHTML = d.confusion_pairs.map((p) =>
            `<div class="hrow"><span>${p.true} ↔ ${p.pred}</span><div class="track"><div class="fill" style="width:${Math.max(6, p.count / max * 100)}%"></div></div><span class="hvalue">${fmtInt(p.count)} (${p.ratio}%)</span></div>`).join("");
        }
        // 错误原因分布
        const reasons = d.reasons || [];
        const donut = $(".reason-panel .donut");
        const palette = ["#e11d26", "#f97316", "#f59e0b", "#10b981", "#64748b"];
        let acc = 0; const segs = [];
        reasons.forEach((r, i) => { segs.push(`${palette[i % palette.length]} ${acc}% ${acc + r.ratio}%`); acc += r.ratio; });
        if (donut && segs.length) donut.style.background = `conic-gradient(${segs.join(",")})`;
        const legendLines = $$(".reason-panel .reason-legend .legend-line");
        reasons.forEach((r, i) => { const ll = legendLines[i]; if (ll) { const dot = $(".ldot", ll); if (dot) dot.style.background = palette[i % palette.length]; ll.children[1].textContent = r.name; ll.children[2].textContent = `${r.ratio}% (${fmtInt(r.count)})`; } });
        for (let i = reasons.length; i < legendLines.length; i++) legendLines[i].style.display = "none";
        // 关键词卡片
        const grid = $(".keyword-grid");
        if (grid && d.keyword_cards) {
          grid.innerHTML = d.keyword_cards.map((c) =>
            `<div class="kcard"><div class="khead"><span class="kicon red"><svg class="icon sicon"><use href="#i-chart"/></svg></span>${c.category}</div>` +
            `<div class="tags">${(c.keywords || []).slice(0, 9).map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div></div>`).join("");
        }
        // 底部模型名
        const ml = $$(".bottom-bar .status-left span")[1];
        if (ml) ml.innerHTML = `当前模型： <span class="green-dot"></span>${d.model_name}（最优模型）`;
        window.__errExport = d.errors;
        refreshIcons();
      } catch (e) { toast(e.message, "error"); }
    }

    // tabs：滚动到相应区域
    const tabs = $$(".left-panel .tabs .tab");
    tabs.forEach((tab) => {
      tab.style.cursor = "pointer";
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active")); tab.classList.add("active");
        const t = tab.textContent;
        if (t.indexOf("易混淆") >= 0) { const el = $(".chart-panel"); if (el) el.scrollIntoView({ behavior: "smooth" }); }
        else if (t.indexOf("关键词") >= 0) { const el = $(".keyword-section"); if (el) el.scrollIntoView({ behavior: "smooth" }); }
      });
    });

    const resetBtn = $(".left-panel .filter-btn");
    if (resetBtn) resetBtn.addEventListener("click", () => { state.q = state.true = state.pred = ""; state.page = 1; load(); });
    const exportBtn = $(".left-panel .filter-btn.red");
    if (exportBtn) exportBtn.addEventListener("click", () => {
      const rows = window.__errExport || [];
      if (!rows.length) { toast("暂无错误样本", "warn"); return; }
      downloadCSV("error_samples.csv", [["文本", "真实类别", "预测类别", "置信度", "模型", "错误原因"]].concat(
        rows.map((r) => [r.text, r.true_name, r.pred_name, r.confidence, r.model, r.reason])));
    });
    const refreshBtn = $(".bottom-bar .small-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => { load(); toast("已刷新分析"); });
    const genReport = $(".bottom-bar .export-btn");
    if (genReport) genReport.addEventListener("click", async () => { try { await postJSON("/api/errors/report", {}); toast("分析报告已生成，可在『报告导出』查看/下载"); } catch (e) { toast(e.message, "error"); } });

    load();
  }

  /* ----------------- 实验记录与模型管理 ----------------- */
  async function initExperiments() {
    let data, allList = [], filter = { q: "", status: "", model: "", dataset: "" };

    function badgeClass(s) { return s === "已完成" ? "done" : s === "训练中" ? "train" : s === "失败" ? "fail" : "running"; }

    function renderDetail(e) {
      if (!e) return;
      const root = $(".detail");
      if (!root) return;
      setText($(".expname", root), e.name);
      const tagOk = $(".expname .tag-ok", root);
      if (tagOk) { $(".expname", root).appendChild(tagOk); tagOk.textContent = e.status; }
      const mrows = $$(".meta .mrow span", root);
      const meta = [`EXP_${e.id}`, e.dataset || "—", e.model_type, "TF-IDF", e.dataset || "—", "—"];
      mrows.forEach((m, i) => { if (meta[i] != null) m.textContent = meta[i]; });
      const desc = $(".detail-desc", root);
      if (desc) desc.innerHTML = "<b>描述</b>　" + esc(e.description || "（无描述）");
      const rc = $$(".results .result-card b", root);
      if (rc[0]) rc[0].textContent = e.accuracy != null ? fmtPct(e.accuracy) : "—";
      if (rc[1]) rc[1].textContent = e.macro_f1 != null ? e.macro_f1.toFixed(3) : "—";
      if (rc[2]) rc[2].textContent = "—";
      if (rc[3]) rc[3].textContent = e.f1 != null ? e.f1.toFixed(3) : "—";
      const rTitle = $$(".results .result-card span", root);
      if (rTitle[1]) rTitle[1].textContent = "Macro-F1";
      if (rTitle[2]) rTitle[2].textContent = "状态";
      if (rc[2]) rc[2].textContent = e.status;
      const vh = $(".version .panel-head h3");
      if (vh) vh.textContent = `模型版本管理（实验: ${e.name}）`;
    }

    function renderTable() {
      const tb = $(".exp-table tbody");
      if (!tb) return;
      let rows = allList.filter((e) =>
        (!filter.q || (e.name || "").indexOf(filter.q) >= 0) &&
        (!filter.status || e.status === filter.status) &&
        (!filter.model || e.model_type === filter.model) &&
        (!filter.dataset || e.dataset === filter.dataset));
      if (!rows.length) { tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:18px">暂无实验记录，点击「新建实验」添加</td></tr>`; return; }
      tb.innerHTML = rows.map((e) =>
        `<tr data-id="${e.id}"><td>${esc(e.name)}</td><td>${e.model_type}</td><td>${esc(e.dataset || "—")}</td>` +
        `<td>${e.accuracy != null ? fmtPct(e.accuracy) : "--"}</td><td>${e.f1 != null ? e.f1.toFixed(3) : "--"}</td>` +
        `<td><span class="badge ${badgeClass(e.status)}">${e.status}</span></td><td>${e.created_at || "—"}</td>` +
        `<td><div class="ops"><span class="op view"><svg class="icon sicon"><use href="#i-eye"/></svg></span><span class="op"><svg class="icon sicon"><use href="#i-edit"/></svg></span><span class="op red"><svg class="icon sicon"><use href="#i-more"/></svg></span></div></td></tr>`).join("");
      $$("tr", tb).forEach((tr) => { const v = $(".op.view", tr); if (v) v.addEventListener("click", () => { const e = allList.find((x) => x.id == tr.dataset.id); renderDetail(e); $(".detail") && $(".detail").scrollIntoView({ behavior: "smooth" }); }); });
      const foot = $(".records .foot > span");
      if (foot) foot.textContent = "共 " + rows.length + " 条记录";
      refreshIcons();
    }

    async function load() {
      try { data = await api("/api/experiments"); } catch (e) { toast(e.message, "error"); return; }
      const sc = data.stat_cards, cards = $$(".stats .stat");
      const vals = [sc.total, sc.completed, sc.models_trained, sc.best_accuracy != null ? fmtPct(sc.best_accuracy) : "—", sc.deployed, sc.storage_mb + " MB"];
      cards.forEach((c, i) => { if (vals[i] != null) setText($(".val", c), vals[i]); });
      if (cards[1]) $(".sub", cards[1]).textContent = "占比 " + sc.completed_rate + "%";
      allList = data.list || [];
      renderTable();
      renderDetail(data.selected);
      // 版本表
      const vtb = $(".version-table tbody");
      if (vtb) vtb.innerHTML = (data.versions || []).length
        ? data.versions.map((v) => `<tr><td>${v.version}</td><td>${v.file}</td><td>${esc(v.description)}</td><td>${v.accuracy != null ? fmtPct(v.accuracy) : "—"}</td><td>—</td><td>${v.created_at}</td><td><div class="ops"><span class="op"><svg class="icon sicon"><use href="#i-download"/></svg></span><span class="op"><svg class="icon sicon"><use href="#i-shield"/></svg></span></div></td></tr>`).join("")
        : `<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:14px">暂无模型版本</td></tr>`;
      // 最近任务
      const taskRows = $$(".tasks .task-row");
      (data.recent_tasks || []).forEach((t, i) => {
        const row = taskRows[i]; if (!row) return;
        const spans = $$("span", row);
        if (spans[1]) spans[1].textContent = "实验任务　　" + t.name;
        const sm = $(".statusmini", row); if (sm) { sm.textContent = t.status; sm.className = "statusmini" + (t.status !== "已完成" ? " run" : ""); }
        const bar = $(".tprogress i", row); if (bar) bar.style.width = t.progress + "%";
        if (spans[spans.length - 1]) spans[spans.length - 1].textContent = t.progress + "%";
      });
      for (let i = (data.recent_tasks || []).length; i < taskRows.length; i++) taskRows[i].style.display = "none";
      refreshIcons();
    }

    // 过滤器
    const sels = $$(".records .filters .select");
    if (sels[0]) customDropdown(sels[0], [{ key: "", label: "全部状态" }, { key: "已完成", label: "已完成" }, { key: "训练中", label: "训练中" }, { key: "失败", label: "失败" }], (k) => { filter.status = k; renderTable(); }, { key: "", label: "全部状态" });
    if (sels[1]) customDropdown(sels[1], [{ key: "", label: "全部模型类型" }, { key: "朴素贝叶斯", label: "朴素贝叶斯" }, { key: "逻辑回归", label: "逻辑回归" }], (k) => { filter.model = k; renderTable(); }, { key: "", label: "全部模型类型" });
    const fsearch = $(".records .filters .input");
    if (fsearch) { fsearch.style.cursor = "text"; fsearch.addEventListener("click", () => { filter.q = (prompt("搜索实验名称：", filter.q) || "").trim(); renderTable(); }); }
    const refreshBtn = $(".records .smallbtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => load());

    // 新建实验
    const newBtn = $(".records .redbtn");
    if (newBtn) newBtn.addEventListener("click", () => {
      const body = document.createElement("div");
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;min-width:380px">
        <label style="font-size:13px;color:#374151">实验名称<input id="ne-name" style="width:100%;height:34px;margin-top:5px;border:1px solid #e5e7eb;border-radius:7px;padding:0 10px" placeholder="例如：新闻分类_LR_v1"></label>
        <label style="font-size:13px;color:#374151">模型类型
          <select id="ne-model" style="width:100%;height:34px;margin-top:5px;border:1px solid #e5e7eb;border-radius:7px;padding:0 8px"><option>逻辑回归</option><option>朴素贝叶斯</option></select></label>
        <label style="font-size:13px;color:#374151">数据集<input id="ne-ds" style="width:100%;height:34px;margin-top:5px;border:1px solid #e5e7eb;border-radius:7px;padding:0 10px" placeholder="当前数据集"></label>
        <label style="font-size:13px;color:#374151">描述<textarea id="ne-desc" style="width:100%;height:60px;margin-top:5px;border:1px solid #e5e7eb;border-radius:7px;padding:8px" placeholder="可选"></textarea></label>
        <div style="font-size:12px;color:#9ca3af">提示：本系统模型仅支持「朴素贝叶斯 / 逻辑回归」。</div>
        <button id="ne-ok" class="btn primary" style="height:36px;background:#e11d26;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer">创建实验</button></div>`;
      const m = modal("新建实验", body);
      $("#ne-ok", body).addEventListener("click", async () => {
        const name = $("#ne-name", body).value.trim();
        if (!name) { toast("请输入实验名称", "warn"); return; }
        try {
          await postJSON("/api/experiments", { name, model_type: $("#ne-model", body).value, dataset: $("#ne-ds", body).value.trim() || "当前数据集", description: $("#ne-desc", body).value.trim(), status: "已完成" });
          m.close(); toast("实验已创建"); load();
        } catch (e) { toast(e.message, "error"); }
      });
    });

    // tabs
    const tabs = $$(".records .panel-head .tab");
    tabs.forEach((t) => { t.style.cursor = "pointer"; t.addEventListener("click", () => { tabs.forEach((x) => x.classList.remove("active")); t.classList.add("active"); if (t.textContent.indexOf("模型管理") >= 0) { const el = $(".version"); if (el) el.scrollIntoView({ behavior: "smooth" }); } }); });

    // 快速操作
    $$(".quick .quick-item").forEach((q) => {
      q.style.cursor = "pointer"; const t = q.textContent;
      q.addEventListener("click", () => {
        if (t.indexOf("对比") >= 0) location.href = "/evaluation.html";
        else if (t.indexOf("报告") >= 0) location.href = "/reports.html";
        else if (t.indexOf("部署") >= 0) toast("最优模型已自动部署用于预测");
        else if (t.indexOf("导出") >= 0) toast("模型文件保存在 backend/storage/models/");
      });
    });
    const repBtn = $(".detail .report");
    if (repBtn) repBtn.addEventListener("click", () => location.href = "/reports.html");

    load();
  }

  /* ----------------- 报告导出 + API Key ----------------- */
  async function initReports() {
    let selectedFormat = "PDF";

    function renderApi(a) {
      const span = $(".api-input span");
      if (span) span.textContent = a.deepseek_configured ? a.deepseek_masked : "（未配置，点击填写您的 DeepSeek Key）";
      const conn = $(".api-tip .connected");
      if (conn) { conn.textContent = a.deepseek_configured ? "已连接" : "未配置"; conn.style.background = a.deepseek_configured ? "" : "#9ca3af"; conn.style.color = a.deepseek_configured ? "" : "#fff"; }
    }

    async function openApiModal() {
      let st = {};
      try { st = await api("/api/reports/api-key/status"); } catch (e) {}
      const body = document.createElement("div");
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;min-width:440px">
        <div style="font-size:12px;color:#6b7280;line-height:1.6">所有结论性文字（首页/训练/评价/错误分析的「结论」、相似新闻兜底标题、报告摘要）均调用您自备的 <b>DeepSeek</b> Key；相似新闻的真实链接来自您配置的<b>网页搜索</b> API。系统不内置任何 Key。</div>
        <div><div style="font-size:13px;font-weight:700;margin-bottom:6px">DeepSeek API Key ${st.deepseek_configured ? '<span style="color:#16a34a">（已配置 ' + esc(st.deepseek_masked || "") + "）</span>" : ""}</div>
          <div style="display:flex;gap:8px"><input id="ds-key" type="password" placeholder="sk-..." style="flex:1;height:34px;border:1px solid #e5e7eb;border-radius:7px;padding:0 10px">
          <button id="ds-test" style="height:34px;padding:0 12px;border:1px solid #e11d26;color:#e11d26;background:#fff;border-radius:7px;cursor:pointer;font-weight:700">测试连接</button>
          <button id="ds-save" style="height:34px;padding:0 14px;border:none;background:#e11d26;color:#fff;border-radius:7px;cursor:pointer;font-weight:800">保存</button></div>
          <div id="ds-msg" style="font-size:12px;margin-top:6px;color:#6b7280"></div></div>
        <div><div style="font-size:13px;font-weight:700;margin-bottom:6px">网页搜索 API（相似新闻真实链接）${st.search_configured ? '<span style="color:#16a34a">（已配置）</span>' : ""}</div>
          <div style="display:flex;gap:8px"><select id="se-prov" style="width:120px;height:34px;border:1px solid #e5e7eb;border-radius:7px;padding:0 8px"><option value="serper">Serper</option><option value="bing">Bing</option><option value="serpapi">SerpAPI</option></select>
          <input id="se-key" type="password" placeholder="搜索服务 Key" style="flex:1;height:34px;border:1px solid #e5e7eb;border-radius:7px;padding:0 10px">
          <button id="se-save" style="height:34px;padding:0 14px;border:none;background:#374151;color:#fff;border-radius:7px;cursor:pointer;font-weight:800">保存</button></div>
          <div style="font-size:12px;margin-top:6px;color:#9ca3af">未配置搜索 API 时，相似新闻将用 DeepSeek 生成候选标题作为兜底。</div></div>
      </div>`;
      const m = modal("API 配置（用户自备 Key）", body);
      if (st.search_provider) $("#se-prov", body).value = st.search_provider;
      $("#ds-test", body).addEventListener("click", async () => {
        const msg = $("#ds-msg", body); msg.style.color = "#6b7280"; msg.textContent = "正在测试 DeepSeek 连接…";
        const key = $("#ds-key", body).value.trim();
        try { if (key) await postJSON("/api/reports/api-key", { provider: "deepseek", key }); const r = await postJSON("/api/reports/api-key/test", {}); msg.style.color = r.ok ? "#16a34a" : "#e11d26"; msg.textContent = r.ok ? ("连接成功：" + (r.message || "DeepSeek 可用")) : ("连接失败：" + (r.message || "请检查 Key")); if (key) { renderApi({ deepseek_configured: true, deepseek_masked: maskKey(key) }); } } catch (e) { msg.style.color = "#e11d26"; msg.textContent = "测试失败：" + e.message; }
      });
      $("#ds-save", body).addEventListener("click", async () => {
        const key = $("#ds-key", body).value.trim();
        try { await postJSON("/api/reports/api-key", { provider: "deepseek", key }); toast(key ? "DeepSeek Key 已保存" : "已清空 DeepSeek Key"); renderApi({ deepseek_configured: !!key, deepseek_masked: maskKey(key) }); m.close(); } catch (e) { toast(e.message, "error"); }
      });
      $("#se-save", body).addEventListener("click", async () => {
        const key = $("#se-key", body).value.trim();
        try { await postJSON("/api/reports/api-key", { provider: "search", key, search_provider: $("#se-prov", body).value }); toast("搜索 API 已保存"); m.close(); } catch (e) { toast(e.message, "error"); }
      });
    }

    function maskKey(k) { if (!k) return ""; return k.length <= 8 ? "•".repeat(k.length) : k.slice(0, 4) + "•".repeat(Math.max(4, k.length - 8)) + k.slice(-4); }

    let cfg;
    try { cfg = await api("/api/reports/config"); } catch (e) { toast(e.message, "error"); return; }
    const sc = cfg.summary_cards, cards = $$(".summary-grid .summary-card");
    const vals = [sc.templates, sc.data_coverage + "%", sc.charts, sc.est_pages, sc.est_seconds, sc.last_export || "尚未导出"];
    cards.forEach((c, i) => { if (vals[i] != null) setText($(".value", c), vals[i]); });

    // 模板下拉
    const tmplBox = $(".select-row .select-box");
    if (tmplBox && cfg.templates) customDropdown(tmplBox, cfg.templates.map((t) => ({ key: t, label: t })), () => {}, { key: cfg.templates[0], label: cfg.templates[0] });

    // 内容选择
    const checks = $$(".check-grid .check-item");
    (cfg.content_sections || []).forEach((s, i) => { const cb = $(".checkbox", checks[i]); if (cb) cb.classList.toggle("on", s.enabled); });
    $$(".check-grid .check-item, .other-grid .check-item").forEach((ci) => { ci.style.cursor = "pointer"; ci.addEventListener("click", () => $(".checkbox", ci).classList.toggle("on")); });
    // 单选组
    [".radio-row", ".option-left", ".orientation"].forEach((grp) => {
      const items = $$(grp + " .radio-item, " + grp + " .option-row, " + grp + " .orient");
      items.forEach((it) => { it.style.cursor = "pointer"; it.addEventListener("click", () => { items.forEach((x) => { const r = $(".radio", x); if (r) r.classList.remove("on"); }); const r = $(".radio", it); if (r) r.classList.add("on"); }); });
    });

    // API 配置
    renderApi(cfg.api);
    const apiInput = $(".api-input");
    if (apiInput) { apiInput.style.cursor = "pointer"; apiInput.addEventListener("click", openApiModal); }

    // 导出格式
    const fcards = $$(".format-card");
    fcards.forEach((fc) => { fc.style.cursor = "pointer"; fc.addEventListener("click", () => { fcards.forEach((x) => x.classList.remove("active")); fc.classList.add("active"); selectedFormat = ($("h4", fc) || {}).textContent || "PDF"; }); });

    async function genReport() {
      if (!cfg.can_generate) { toast("尚未训练模型，请先在『模型训练』完成训练", "warn"); return; }
      const sections = [];
      $$(".check-grid .check-item").forEach((ci) => { if ($(".checkbox", ci).classList.contains("on")) sections.push(ci.textContent.trim()); });
      const btn = $(".action-btns .export-btn"); const old = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.innerHTML = "生成中…（含 DeepSeek 摘要，请稍候）"; }
      try {
        const r = await postJSON("/api/reports/generate", { format: selectedFormat, sections });
        toast("报告已生成（" + r.format + "）"); window.open(r.url, "_blank");
        const last = $$(".summary-grid .summary-card .value")[5]; if (last) last.textContent = r.generated_at;
      } catch (e) { toast(e.message, "error"); }
      finally { if (btn) { btn.disabled = false; btn.innerHTML = old; refreshIcons(); } }
    }
    const exportBtn = $(".action-btns .export-btn");
    if (exportBtn) exportBtn.addEventListener("click", genReport);
    const previewBtn = $$(".action-btns .small-btn")[1];
    if (previewBtn) previewBtn.addEventListener("click", genReport);
    const tmplPreview = $(".preview-btn");
    if (tmplPreview) tmplPreview.addEventListener("click", genReport);
    const saveBtn = $$(".action-btns .small-btn")[0];
    if (saveBtn) saveBtn.addEventListener("click", () => toast("报告配置已保存"));
    refreshIcons();
  }

  /* ----------------- 启动 ----------------- */
  function boot() {
    wireNav();
    wireSearch();
    wireTopStatus();
    const inits = {
      index: initOverview,
      prediction: initPrediction,
      training: initTraining,
      datasets: initDatasets,
      preview: initPreview,
      features: initFeatures,
      optimization: initOptimization,
      evaluation: initEvaluation,
      errors: initErrors,
      experiments: initExperiments,
      reports: initReports,
    };
    const fn = inits[PAGE];
    if (fn) { try { fn(); } catch (e) { console.error(e); toast("页面初始化出错：" + e.message, "error"); } }
    refreshIcons();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
