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
    // credentials:include —— 始终携带会话 Cookie，保证“按登录用户隔离数据”生效
    const res = await fetch(API + path, Object.assign({ headers: {}, credentials: "include" }, opts));
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

  /* ===== 命令面板（⌘K / Ctrl+K 或点击搜索框唤起，可键盘上下选择、回车跳转） ===== */
  const MODULES = [
    { label: "首页总览", slug: "index", icon: "layout-dashboard", desc: "仪表盘 · 性能对比 · 运行状态" },
    { label: "数据集管理", slug: "datasets", icon: "database", desc: "上传 / 校验 / 入库 train、test" },
    { label: "数据预览与清洗", slug: "preview", icon: "table-properties", desc: "样本浏览 · 清洗规则 · 统计" },
    { label: "TF-IDF 特征提取", slug: "features", icon: "spline", desc: "n-gram / min_df / 特征数" },
    { label: "模型训练", slug: "training", icon: "play", desc: "朴素贝叶斯 + 逻辑回归" },
    { label: "深度学习参数优化", slug: "optimization", icon: "settings-2", desc: "贝叶斯优化超参数" },
    { label: "模型评价与可视化", slug: "evaluation", icon: "bar-chart-3", desc: "指标 · 混淆矩阵 · F1" },
    { label: "错误样本与关键词解释", slug: "errors", icon: "search-x", desc: "误判分析 · 关键词归因" },
    { label: "实验记录与模型管理", slug: "experiments", icon: "flask-conical", desc: "历史实验 · 模型版本" },
    { label: "新闻文本预测", slug: "prediction", icon: "newspaper", desc: "单条 / 批量 · 相似新闻" },
    { label: "报告导出", slug: "reports", icon: "file-text", desc: "报告生成 · API Key 配置" },
  ];

  function openCommandPalette() {
    if ($("#__palette")) return;
    const mask = document.createElement("div");
    mask.id = "__palette";
    mask.style.cssText = "position:fixed;inset:0;z-index:9600;background:rgba(17,24,39,.42);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;";
    const box = document.createElement("div");
    box.style.cssText = "width:min(620px,92vw);background:#fff;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;";
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eef0f3;">' +
        '<i data-lucide="search" style="width:20px;color:#9ca3af;"></i>' +
        '<input id="__pal-input" placeholder="搜索模块 / 输入指令…" autocomplete="off" ' +
        'style="flex:1;border:none;outline:none;font-size:16px;color:#111827;background:transparent;"/>' +
        '<span style="font-size:12px;color:#9ca3af;border:1px solid #e5e7eb;border-radius:6px;padding:2px 7px;">Esc</span>' +
      '</div><div id="__pal-list" style="max-height:52vh;overflow:auto;padding:6px;"></div>';
    mask.appendChild(box);
    document.body.appendChild(mask);
    refreshIcons();

    const input = $("#__pal-input");
    const list = $("#__pal-list");
    let active = 0, filtered = MODULES.slice();
    const close = () => mask.remove();
    const go = (m) => { close(); if (m.slug === PAGE) return; location.href = "/" + m.slug + ".html"; };

    function render() {
      if (!filtered.length) {
        list.innerHTML = '<div style="padding:22px;text-align:center;color:#9ca3af;font-size:14px;">未找到匹配模块</div>';
        return;
      }
      list.innerHTML = filtered.map((m, i) =>
        '<div class="pal-row" data-i="' + i + '" style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:9px;cursor:pointer;' +
        (i === active ? "background:#fef2f2;" : "") + '">' +
          '<i data-lucide="' + m.icon + '" style="width:19px;color:#e60012;"></i>' +
          '<div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:700;color:#1f2937;">' + esc(m.label) +
          (m.slug === PAGE ? ' <span style="font-size:11px;color:#9ca3af;font-weight:500;">当前</span>' : "") +
          '</div><div style="font-size:12px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(m.desc) + '</div></div>' +
          '<i data-lucide="corner-down-left" style="width:15px;color:#d1d5db;"></i>' +
        '</div>').join("");
      refreshIcons();
      $$(".pal-row", list).forEach((row) => {
        row.addEventListener("mouseenter", () => { active = +row.dataset.i; paint(); });
        row.addEventListener("click", () => go(filtered[+row.dataset.i]));
      });
    }
    function paint() {
      $$(".pal-row", list).forEach((row, i) => { row.style.background = i === active ? "#fef2f2" : ""; });
    }
    function filter() {
      const q = input.value.trim().toLowerCase().replace(/\s+/g, "");
      filtered = !q ? MODULES.slice() : MODULES.filter((m) =>
        (m.label + m.slug + m.desc).toLowerCase().replace(/\s+/g, "").indexOf(q) >= 0 ||
        (/tfidf|tf-idf|特征/.test(q) && m.slug === "features"));
      active = 0; render();
    }
    input.addEventListener("input", filter);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) go(filtered[active]); }
      else if (e.key === "Escape") { close(); }
    });
    mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
    render();
    setTimeout(() => input.focus(), 30);
  }

  /* 顶部搜索：点击输入框=内联键盘输入(带匹配下拉)；K / ⌘K / Ctrl+K=命令面板弹窗 */
  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = (a.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || a.isContentEditable;
  }
  function matchModules(q) {
    q = (q || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return MODULES.slice(0, 6);
    return MODULES.filter((m) =>
      (m.label + m.slug + m.desc).toLowerCase().replace(/\s+/g, "").indexOf(q) >= 0 ||
      (/tfidf|tf-idf|特征/.test(q) && m.slug === "features"));
  }
  /* 全站统一顶部标题行：把每个页面的 .topbar 重建成与「数据管理」完全一致的结构，
     使用自带 SVG 图标（不依赖各页 sprite / lucide），从根本上消除 features 的红框等差异。 */
  function normalizeTopbar() {
    const bar = $(".topbar");
    if (!bar) return;
    const I = {
      search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
      bell: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      user: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
      chev: '<svg class="icon" style="width:22px;height:22px;color:#2b3445" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    };
    bar.innerHTML =
      '<div class="search">' + I.search +
        '<span>输入指令 / 搜索模块...</span>' +
        '<div class="kbd"><span>⌘</span><span>K</span></div>' +
      '</div>' +
      '<div class="top-actions">' +
        '<div class="pill green">系统在线</div>' +
        '<div class="pill red">模型已加载</div>' +
        '<div class="bell">' + I.bell + '</div>' +
        '<div class="avatar">' + I.user + '</div>' +
        I.chev +
      '</div>';
  }

  function wireSearch() {
    const box = $(".search");
    if (box) {
      const span = $("span", box);
      const kbd = $(".kbd", box);
      box.style.cursor = "text";
      let input = null, dd = null;
      const closeDD = () => { if (dd) { dd.remove(); dd = null; } };
      const restore = () => { closeDD(); if (input) { input.remove(); input = null; } if (span) span.style.display = ""; };
      const jump = (m) => { restore(); if (m && m.slug !== PAGE) location.href = "/" + m.slug + ".html"; };
      function renderDD() {
        const list = matchModules(input.value);
        if (!dd) {
          dd = document.createElement("div");
          dd.style.cssText = "position:fixed;z-index:10001;background:#fff;border:1px solid #eef0f3;border-radius:10px;box-shadow:0 18px 45px rgba(0,0,0,.18);overflow:hidden;padding:6px;";
          document.body.appendChild(dd);
        }
        const r = box.getBoundingClientRect();
        dd.style.left = r.left + "px"; dd.style.top = (r.bottom + 6) + "px"; dd.style.width = Math.max(280, r.width) + "px";
        dd.__list = list;
        dd.innerHTML = list.length ? list.map((m, i) =>
          '<div class="__sg" data-slug="' + m.slug + '" style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer;' + (i === 0 ? "background:#fef2f2;" : "") + '">' +
          '<i data-lucide="' + m.icon + '" style="width:17px;color:#e60012;"></i>' +
          '<div style="flex:1;min-width:0;font-size:14px;color:#1f2937;">' + esc(m.label) +
          (m.slug === PAGE ? ' <span style="font-size:11px;color:#9ca3af;">当前</span>' : "") + '</div></div>').join("")
          : '<div style="padding:14px;color:#9ca3af;font-size:13px;text-align:center;">未找到匹配模块，按 K 打开命令面板</div>';
        refreshIcons();
        $$(".__sg", dd).forEach((row) => row.addEventListener("mousedown", (e) => { e.preventDefault(); jump(MODULES.find((x) => x.slug === row.dataset.slug)); }));
      }
      function activate() {
        if (input) { input.focus(); return; }
        if (span) span.style.display = "none";
        input = document.createElement("input");
        input.setAttribute("autocomplete", "off");
        input.placeholder = span ? span.textContent.trim() : "搜索模块…";
        input.style.cssText = "flex:1;min-width:60px;border:none;outline:none;background:transparent;font-size:inherit;color:#111827;font-family:inherit;";
        box.insertBefore(input, kbd || null);
        input.addEventListener("input", renderDD);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); const l = dd && dd.__list; if (l && l[0]) jump(l[0]); }
          else if (e.key === "Escape") { e.preventDefault(); restore(); }
        });
        input.addEventListener("blur", () => setTimeout(restore, 160));
        input.focus(); renderDD();
      }
      box.addEventListener("click", (e) => {
        if (kbd && (e.target === kbd || kbd.contains(e.target))) { openCommandPalette(); return; }
        activate();
      });
    }
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if ($("#__palette")) $("#__palette").remove(); else openCommandPalette();
        return;
      }
      // 单按 K：仅当未在任何输入框打字时弹出命令面板
      if ((e.key === "k" || e.key === "K") && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping() && !$("#__palette")) {
        e.preventDefault(); openCommandPalette();
      }
    });
  }

  /* iOS 风格开关：开=绿+小球右，关=灰+小球左（覆盖各页原样式，保证一致） */
  function makeSwitch(el, on, onChange) {
    if (!el) return null;
    el.classList.add("__switchified");
    el.innerHTML = "";
    el.style.cssText = "position:relative;display:inline-block;width:42px;height:24px;border-radius:999px;cursor:pointer;transition:background .18s;vertical-align:middle;flex:none;border:none;";
    const knob = document.createElement("span");
    knob.style.cssText = "position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .18s;";
    el.appendChild(knob);
    let state = !!on;
    const paint = () => { el.style.background = state ? "#16a34a" : "#cbd5e1"; knob.style.left = state ? "20px" : "2px"; };
    paint();
    el.addEventListener("click", (e) => { e.stopPropagation(); state = !state; paint(); if (onChange) onChange(state); });
    return { get: () => state, set: (v) => { state = !!v; paint(); } };
  }

  /* 全站统一：顶部系统行 + 导航字号/不加粗 + 滚动条 + 内容滚动容器 */
  function injectCommonCss() {
    if ($("#__common-css")) return;
    const st = document.createElement("style");
    st.id = "__common-css";
    st.textContent = [
      // ===== 统一顶栏（与「数据集管理」一致；左内边距各页自留以避开侧栏）=====
      ".topbar{height:92px !important;border-bottom:1px solid #edf0f4 !important;background:rgba(255,255,255,.84) !important;-webkit-backdrop-filter:blur(16px) !important;backdrop-filter:blur(16px) !important}",
      ".topbar .search{width:662px !important;height:58px !important;border:1.5px solid #f2a0a4 !important;border-radius:8px !important;background:rgba(255,255,255,.9) !important;color:#969eac !important;font-size:16px !important;display:flex !important;align-items:center !important;padding:0 16px !important;flex-shrink:0 !important}",
      ".topbar .search .icon,.topbar .search svg,.topbar .search i{width:25px !important;height:25px !important;margin-right:14px !important;color:#7b8494 !important}",
      ".topbar .search span{font-weight:400 !important;color:#969eac !important;font-size:16px !important}",
      ".topbar .kbd,.topbar .shortcut{margin-left:auto !important;min-width:56px !important;height:32px !important;border:1px solid #dfe4ec !important;background:#fff !important;border-radius:7px !important;color:#687184 !important;display:flex !important;align-items:center !important;justify-content:center !important;gap:6px !important;font-size:15px !important;font-weight:700 !important;padding:0 8px !important}",
      ".top-actions{display:flex !important;align-items:center !important;gap:20px !important;margin-left:18px !important}",
      ".top-actions .pill{height:38px !important;padding:0 18px !important;border-radius:999px !important;display:flex !important;align-items:center !important;gap:10px !important;font-size:15px !important;font-weight:700 !important;white-space:nowrap !important}",
      ".top-actions .pill:before{content:'' !important;width:10px !important;height:10px !important;border-radius:50% !important;background:currentColor !important;display:inline-block !important;flex:none !important}",
      ".top-actions .pill .pill-dot{display:none !important}",
      ".top-actions .pill.green{color:#16a34a !important;background:#e8f8ee !important}",
      ".top-actions .pill.red,.top-actions .redpill{color:#dc1f1f !important;background:#fde6e6 !important}",
      ".top-actions .bell{position:relative !important;width:34px !important;height:34px !important;display:grid !important;place-items:center !important;color:#2b3445 !important}",
      ".top-actions .bell svg,.top-actions .bell .icon,.top-actions .bell i{width:24px !important;height:24px !important}",
      ".top-actions .avatar{width:50px !important;height:50px !important;border-radius:50% !important;background:linear-gradient(145deg,#ef1d27,#b8000e) !important;display:grid !important;place-items:center !important;color:#fff !important;flex:none !important}",
      ".top-actions .avatar svg,.top-actions .avatar .icon,.top-actions .avatar i{width:33px !important;height:33px !important;stroke:#fff !important;fill:#fff !important}",
      ".toggle-green.__switchified:after,.switch.__switchified:after{display:none !important}",
      ".top-actions .admin-pill{background:transparent !important;padding:0 !important;height:auto !important}",
      ".brand{height:92px !important;border-bottom:1px solid #eef1f5 !important;display:flex !important;align-items:center !important;padding-left:18px !important;padding-right:0 !important;overflow:visible !important;background:rgba(255,255,255,.96) !important}",
      ".brand-logo{width:58px !important;height:58px !important;margin-right:16px !important;border-radius:0 !important;flex-shrink:0 !important;position:relative !important;background:linear-gradient(145deg,#c8121b,#ff6b70) !important;box-shadow:0 12px 24px rgba(220,38,38,.25) !important;clip-path:polygon(50% 0,92% 25%,92% 75%,50% 100%,8% 75%,8% 25%) !important}",
      ".brand-logo:before,.brand-logo::before{content:'' !important;position:absolute !important;inset:12px !important;border:3px solid #fff !important;border-radius:4px !important;transform:rotate(30deg) !important}",
      ".brand-logo:after,.brand-logo::after{content:'' !important;position:absolute !important;width:22px !important;height:22px !important;left:18px !important;top:18px !important;border:3px solid #fff !important;border-top:none !important;border-left:none !important;transform:rotate(30deg) !important}",
      ".brand-copy{width:620px !important;flex:0 0 auto !important;overflow:visible !important;position:relative !important;z-index:61 !important}",
      ".brand h1{font-size:25px !important;line-height:1.08 !important;color:#111827 !important;font-weight:900 !important;letter-spacing:-.6px !important;white-space:nowrap !important;overflow:visible !important}",
      ".brand p{margin-top:7px !important;color:#5e6878 !important;font-size:13px !important;line-height:1.35 !important;white-space:nowrap !important;overflow:visible !important}",
      ".menu{padding:22px 14px 0 12px !important}",
      ".menu .menu-item{height:56px !important;display:flex !important;align-items:center !important;gap:17px !important;padding:0 20px !important;border-radius:8px !important;font-size:16px !important;margin-bottom:6px !important;white-space:nowrap !important}",
      ".menu .menu-item .icon,.menu .menu-item svg{width:23px !important;height:23px !important;stroke-width:1.8 !important;flex-shrink:0 !important}",
      ".menu .menu-item,.menu .menu-item span{font-weight:400 !important}",
      ".menu .menu-item.active,.menu .menu-item.active span{font-weight:500 !important}",
      "::-webkit-scrollbar{width:9px;height:9px}",
      "::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:6px}",
      "::-webkit-scrollbar-thumb:hover{background:#b3bac4}",
      "::-webkit-scrollbar-track{background:transparent}",
      ".log-box{max-height:208px;overflow:auto}",
      ".log-box .log-row{grid-template-columns:auto 1fr auto !important;white-space:nowrap !important}",
      ".logbox{overflow:auto !important}",
      ".logbox .loghead{position:sticky;top:0;background:#fff;z-index:1}",
      ".compare-box{max-height:234px;overflow:auto}",
      ".big-table-wrap{overflow:auto}",
      ".__cat-scroll{max-height:150px;overflow:auto;padding-right:4px}",
      ".__sch{max-height:118px;overflow:auto}",
      ".__sch .schema-table thead th{position:sticky;top:0;z-index:1}",
      ".loglist{max-height:190px;overflow:auto}",
      ".__rankscroll{max-height:232px;overflow:auto}",
      ".__rankscroll table thead th{position:sticky;top:0;background:#fff;z-index:1}",
    ].join("\n");
    document.head.appendChild(st);
  }

  /* 页面级 CSS 注入：即使 HTML 被还原也能强制布局（防回退） */
  function injectPageCss(id, css) {
    if (document.getElementById(id)) { document.getElementById(id).textContent = css; return; }
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* 顶部状态灯：系统在线常绿；模型已加载/未加载按真实状态切绿/红（覆盖各页 pill 变体） */
  function paintPill(pill, on, textOn, textOff) {
    if (!pill) return;
    const color = on ? "#16a34a" : "#dc2626";
    const bg = on ? "#e9f8ee" : "#fde8e8";
    pill.style.color = color; pill.style.background = bg;
    const dot = $(".pill-dot", pill);
    if (dot) dot.style.background = color;
    // 替换最后一个文本节点（pill 文案），保留内部 svg / dot
    let textNode = null;
    pill.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) textNode = n; });
    const label = on ? textOn : textOff;
    if (textNode) textNode.textContent = label;
    else pill.appendChild(document.createTextNode(label));
  }
  async function wireTopStatus() {
    const pills = $$(".top-actions .pill");
    let online = pills[0], model = null;
    pills.forEach((p) => { if (/模型/.test(p.textContent)) model = p; });
    if (!model && pills.length > 1) model = pills[1];
    paintPill(online, true, "系统在线", "系统在线");
    if (model) paintPill(model, false, "模型已加载", "模型未加载");
    try {
      const h = await api("/api/health");
      if (model) paintPill(model, !!h.trained, "模型已加载", "模型未加载");
    } catch (e) {}
  }

  /* ===== 顶部铃铛：真实事件通知中心（未读角标 + 下拉列表） ===== */
  function notifReadKey() { return "__notif_read_ts:" + (CURRENT_USER && CURRENT_USER.id ? CURRENT_USER.id : "anon"); }
  function notifReadTs() { return localStorage.getItem(notifReadKey()) || ""; }
  function wireBell() {
    const bell = $(".bell");
    if (!bell) return;
    // 关掉各页写死的红点伪元素，改由数据驱动
    if (!$("#__bell-css")) {
      const st = document.createElement("style");
      st.id = "__bell-css";
      st.textContent = ".bell::after,.bell:after{display:none !important}";
      document.head.appendChild(st);
    }
    bell.style.position = "relative";
    bell.style.cursor = "pointer";
    const badge = document.createElement("span");
    badge.id = "__bell-badge";
    badge.style.cssText = "display:none;position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;" +
      "background:#e60012;color:#fff;border-radius:9px;font-size:11px;font-weight:800;line-height:17px;text-align:center;box-shadow:0 0 0 2px #fff;";
    bell.appendChild(badge);

    let items = [], unread = 0;
    async function load() {
      try {
        const d = await api("/api/system/notifications");
        items = d.items || [];
        const readTs = notifReadTs();
        unread = items.filter((it) => (it.ts || "") > readTs).length;
        badge.style.display = unread > 0 ? "block" : "none";
        badge.textContent = unread > 99 ? "99+" : String(unread);
      } catch (e) {}
    }
    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      const existing = $("#__bell-pop");
      if (existing) { existing.remove(); return; }
      const pop = document.createElement("div");
      pop.id = "__bell-pop";
      const br = bell.getBoundingClientRect();
      pop.style.cssText = "position:fixed;width:360px;max-height:62vh;overflow:auto;" +
        "background:#fff;border:1px solid #eef0f3;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.22);z-index:10002;";
      pop.style.top = (br.bottom + 10) + "px";
      pop.style.left = Math.max(12, Math.min(br.right - 360, window.innerWidth - 372)) + "px";
      const head = '<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #f1f2f4;position:sticky;top:0;background:#fff;">' +
        '<b style="font-size:15px;color:#111827;">通知中心</b>' +
        '<span id="__notif-clear" style="font-size:12px;color:#e60012;cursor:pointer;">全部标记已读</span></div>';
      const body = items.length ? items.map((it) =>
        '<div style="display:flex;gap:11px;padding:12px 16px;border-bottom:1px solid #f6f7f8;' + ((it.ts || "") > notifReadTs() ? "background:#fff7f7;" : "") + '">' +
          '<span style="flex:none;margin-top:2px;width:8px;height:8px;border-radius:50%;background:' + ((it.ts || "") > notifReadTs() ? "#e60012" : "#d1d5db") + ';"></span>' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:#374151;line-height:1.5;">' + esc(it.message) + '</div>' +
          '<div style="font-size:11.5px;color:#9ca3af;margin-top:3px;">' + esc(it.label) + ' · ' + esc(it.ts || "") + '</div></div></div>').join("")
        : '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:14px;">暂无通知</div>';
      pop.innerHTML = head + '<div>' + body + '</div>';
      document.body.appendChild(pop);
      const clr = $("#__notif-clear", pop);
      if (clr) clr.addEventListener("click", () => {
        localStorage.setItem(notifReadKey(), (new Date()).toISOString().slice(0, 19).replace("T", " "));
        unread = 0; badge.style.display = "none"; pop.remove();
      });
      const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== bell && !bell.contains(ev.target)) { pop.remove(); document.removeEventListener("click", off); } };
      setTimeout(() => document.addEventListener("click", off), 30);
    });
    load();
  }

  /* ===== 用户账号：Google 风格下拉 + 登录/注册/退出/切换账号 ===== */
  let CURRENT_USER = null;
  function userAnchor() {
    // 兼容各页：admin-pill（含头像+文字+箭头） / 单独 avatar / avatar+admin / avatar+chevron
    return $(".admin-pill") || $(".avatar");
  }
  function setUserLabel() {
    const name = CURRENT_USER ? CURRENT_USER.username : "未登录";
    const adminPill = $(".admin-pill");
    if (adminPill) {
      let tn = null;
      adminPill.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) tn = n; });
      if (tn) tn.textContent = " " + name + " "; else adminPill.insertBefore(document.createTextNode(" " + name + " "), adminPill.lastChild);
    }
    const admin = $(".admin");
    if (admin) {
      let tn = null;
      admin.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) tn = n; });
      if (tn) tn.textContent = name + " "; else admin.insertBefore(document.createTextNode(name + " "), admin.firstChild);
    }
    // 各页统一：只有「头像 + 箭头」没有用户名文字的页面，注入用户名标签（头像 + 用户名 + 一个箭头）
    if (!adminPill && !admin) {
      const av = $(".avatar");
      if (av) {
        let label = $(".__uname");
        if (!label) {
          label = document.createElement("span");
          label.className = "__uname";
          label.style.cssText = "font-size:14px;font-weight:500;color:#374151;margin:0 2px 0 8px;white-space:nowrap;";
          av.insertAdjacentElement("afterend", label);
        }
        label.textContent = name;
      }
    }
  }
  async function loadMe() {
    try { const d = await api("/api/auth/me"); CURRENT_USER = d.logged_in ? d.user : null; }
    catch (e) { CURRENT_USER = null; }
    setUserLabel();
  }
  function isLoggedIn() { return !!CURRENT_USER; }
  function requireLogin(msg) {
    if (CURRENT_USER) return true;
    toast(msg || "请先登录后再操作", "warn");
    openLoginModal();
    return false;
  }
  function avatarInitial() {
    return CURRENT_USER ? CURRENT_USER.username.slice(0, 1).toUpperCase() : "";
  }
  function openUserMenu(anchor) {
    if ($("#__user-pop")) { $("#__user-pop").remove(); return; }
    const pop = document.createElement("div");
    pop.id = "__user-pop";
    pop.style.cssText = "position:fixed;width:300px;background:#fff;border:1px solid #eef0f3;border-radius:14px;" +
      "box-shadow:0 22px 60px rgba(0,0,0,.22);z-index:9300;overflow:hidden;";
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + "px";
    pop.style.left = Math.max(12, Math.min(r.right - 300, window.innerWidth - 312)) + "px";
    let html = "";
    if (CURRENT_USER) {
      html += '<div style="display:flex;gap:13px;align-items:center;padding:18px 18px 14px;background:linear-gradient(135deg,#fff5f5,#fff);">' +
        '<div style="width:46px;height:46px;border-radius:50%;background:linear-gradient(145deg,#e90012,#b8000d);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800;">' + esc(avatarInitial()) + '</div>' +
        '<div style="min-width:0;"><div style="font-size:16px;font-weight:800;color:#111827;">' + esc(CURRENT_USER.username) + '</div>' +
        '<div style="font-size:12px;color:#9ca3af;">上次登录：' + esc(CURRENT_USER.last_login || "—") + '</div></div></div>';
      html += '<div style="height:1px;background:#f1f2f4;"></div>';
      html += menuRow("settings", "API Key 配置", "go-api") +
              menuRow("repeat", "切换账号", "switch") +
              menuRow("log-out", "退出登录", "logout");
    } else {
      html += '<div style="padding:20px 18px 8px;text-align:center;">' +
        '<div style="width:52px;height:52px;border-radius:50%;background:#f3f4f6;color:#9ca3af;display:grid;place-items:center;margin:0 auto 10px;"><i data-lucide="user-round" style="width:28px;"></i></div>' +
        '<div style="font-size:15px;font-weight:700;color:#374151;">尚未登录</div>' +
        '<div style="font-size:12.5px;color:#9ca3af;margin:4px 0 12px;">登录后可保存你的 API Key 与配置</div></div>';
      html += menuRow("log-in", "登录", "login") + menuRow("user-plus", "注册新账号", "register");
    }
    pop.innerHTML = html;
    document.body.appendChild(pop);
    refreshIcons();
    const act = (sel, fn) => { const el = $('[data-act="' + sel + '"]', pop); if (el) el.addEventListener("click", () => { pop.remove(); fn(); }); };
    act("login", openLoginModal);
    act("register", openRegisterModal);
    act("logout", doLogout);
    act("switch", () => doLogout(true));
    act("go-api", () => { location.href = "/reports.html"; });
    const off = (ev) => { if (!pop.contains(ev.target) && !anchor.contains(ev.target) && ev.target !== anchor) { pop.remove(); document.removeEventListener("click", off); } };
    setTimeout(() => document.addEventListener("click", off), 30);
  }
  function menuRow(icon, label, act) {
    return '<div data-act="' + act + '" style="display:flex;align-items:center;gap:12px;padding:13px 18px;cursor:pointer;font-size:14.5px;color:#374151;" ' +
      'onmouseenter="this.style.background=\'#f9fafb\'" onmouseleave="this.style.background=\'#fff\'">' +
      '<i data-lucide="' + icon + '" style="width:18px;color:#6b7280;"></i>' + esc(label) + '</div>';
  }
  function wireUserMenu() {
    const anchor = userAnchor();
    if (!anchor) return;
    const open = (e) => { e.stopPropagation(); openUserMenu(anchor); };
    // 触发区：头像/管理员胶囊本体 + 相邻的下拉箭头(i/svg) + 独立的 .admin 文案块
    const triggers = [anchor];
    const sib = anchor.nextElementSibling;
    if (sib && /^(svg|i)$/i.test(sib.tagName)) triggers.push(sib);
    const adminLabel = $(".admin");
    if (adminLabel && adminLabel !== anchor) triggers.push(adminLabel);
    triggers.forEach((t) => { t.style.cursor = "pointer"; t.addEventListener("click", open); });
    loadMe();
  }

  /* —— 登录 / 注册 / 退出 —— */
  function pwdRules(pwd) {
    return [
      { ok: pwd.length >= 8, t: "至少 8 位" },
      { ok: /[a-z]/.test(pwd), t: "小写字母" },
      { ok: /[A-Z]/.test(pwd), t: "大写字母" },
      { ok: /\d/.test(pwd), t: "数字" },
      { ok: /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>/?`~\\]/.test(pwd), t: "特殊符号" },
    ];
  }
  function authField(label, type, id, ph) {
    return '<label style="display:block;margin-bottom:14px;"><span style="display:block;font-size:13px;color:#6b7280;margin-bottom:6px;">' + label + '</span>' +
      '<input id="' + id + '" type="' + type + '" placeholder="' + (ph || "") + '" autocomplete="off" ' +
      'style="width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #e5e7eb;border-radius:9px;font-size:15px;outline:none;"/></label>';
  }
  function openLoginModal() {
    const wrap = document.createElement("div");
    wrap.innerHTML = authField("用户名", "text", "__lg-u", "请输入用户名") +
      authField("密码", "password", "__lg-p", "请输入密码") +
      '<button id="__lg-go" style="width:100%;padding:12px;border:none;border-radius:9px;background:#e60012;color:#fff;font-size:15px;font-weight:800;cursor:pointer;">登录</button>' +
      '<div style="text-align:center;margin-top:12px;font-size:13px;color:#6b7280;">还没有账号？<span id="__lg-reg" style="color:#e60012;cursor:pointer;font-weight:700;">注册一个</span></div>';
    const m = modal("登录", wrap, { width: "400px" });
    const go = async () => {
      const username = $("#__lg-u").value.trim(), password = $("#__lg-p").value;
      if (!username || !password) { toast("请输入用户名和密码", "warn"); return; }
      const btn = $("#__lg-go"); btn.disabled = true; btn.textContent = "登录中…";
      try {
        const d = await postJSON("/api/auth/login", { username, password });
        CURRENT_USER = d.user; setUserLabel(); m.close(); toast("欢迎回来，" + d.user.username);
        // 登录后刷新页面：加载该用户名下的数据集与各模块数据
        setTimeout(() => location.reload(), 600);
      } catch (e) { toast(e.message, "error"); btn.disabled = false; btn.textContent = "登录"; }
    };
    $("#__lg-go").addEventListener("click", go);
    $("#__lg-p").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    $("#__lg-reg").addEventListener("click", () => { m.close(); openRegisterModal(); });
    setTimeout(() => $("#__lg-u").focus(), 40);
  }
  function openRegisterModal() {
    const wrap = document.createElement("div");
    wrap.innerHTML = authField("用户名", "text", "__rg-u", "2-32 个字符") +
      authField("密码", "password", "__rg-p", "设置安全密码") +
      '<div id="__rg-rules" style="display:flex;flex-wrap:wrap;gap:8px 14px;margin:-4px 0 14px;"></div>' +
      authField("确认密码", "password", "__rg-p2", "再次输入密码") +
      '<button id="__rg-go" style="width:100%;padding:12px;border:none;border-radius:9px;background:#e60012;color:#fff;font-size:15px;font-weight:800;cursor:pointer;">注册并登录</button>' +
      '<div style="text-align:center;margin-top:12px;font-size:13px;color:#6b7280;">已有账号？<span id="__rg-login" style="color:#e60012;cursor:pointer;font-weight:700;">去登录</span></div>';
    const m = modal("注册新账号", wrap, { width: "420px" });
    const rulesEl = $("#__rg-rules"), pEl = $("#__rg-p");
    const renderRules = () => {
      rulesEl.innerHTML = pwdRules(pEl.value).map((r) =>
        '<span style="font-size:12px;display:inline-flex;align-items:center;gap:4px;color:' + (r.ok ? "#16a34a" : "#9ca3af") + ';">' +
        (r.ok ? "✓" : "○") + " " + r.t + '</span>').join("");
    };
    pEl.addEventListener("input", renderRules); renderRules();
    const go = async () => {
      const username = $("#__rg-u").value.trim(), password = pEl.value, p2 = $("#__rg-p2").value;
      if (!username) { toast("请输入用户名", "warn"); return; }
      if (pwdRules(password).some((r) => !r.ok)) { toast("密码需同时含大小写字母、数字、特殊符号且≥8位", "warn"); return; }
      if (password !== p2) { toast("两次输入的密码不一致", "warn"); return; }
      const btn = $("#__rg-go"); btn.disabled = true; btn.textContent = "注册中…";
      try {
        const d = await postJSON("/api/auth/register", { username, password });
        CURRENT_USER = d.user; setUserLabel(); m.close(); toast("注册成功，已登录：" + d.user.username);
        setTimeout(() => location.reload(), 600);
      } catch (e) { toast(e.message, "error"); btn.disabled = false; btn.textContent = "注册并登录"; }
    };
    $("#__rg-go").addEventListener("click", go);
    $("#__rg-login").addEventListener("click", () => { m.close(); openLoginModal(); });
    setTimeout(() => $("#__rg-u").focus(), 40);
  }
  async function doLogout(thenLogin) {
    try { await postJSON("/api/auth/logout", {}); } catch (e) {}
    CURRENT_USER = null; setUserLabel();
    if (thenLogin) { openLoginModal(); }
    else { toast("已退出登录"); setTimeout(() => location.reload(), 600); }
  }

  /* ----------------- 首页总览 ----------------- */
  async function initOverview() {
    // 底部「当前最优参数」与「运行状态」两面板底部对齐（等高 + 备注贴底）
    const pp = $(".param-panel");
    if (pp && $(".status-panel")) {
      pp.style.height = "194px";
      pp.style.display = "flex";
      pp.style.flexDirection = "column";
      const note = $(".param-note"); if (note) note.style.marginTop = "auto";
    }
    let d;
    try { d = await api("/api/overview"); } catch (e) { toast(e.message, "error"); return; }
    bindTimeline(d.status_timeline);
    wireMetricView();
    wireQuickPredict();
    if (!d.trained) {
      blankOverview();
      toast(d.message || "尚未训练模型，请先上传数据集并训练", "warn");
      refreshIcons();
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
    refreshIcons();
  }

  /* 空白态（尚未训练）：所有统计归零、最优模型=无、性能图与最优参数清空 */
  function blankOverview() {
    const cards = $$(".stat-grid .stat-card");
    const zero = ["0", "0", "0", "0", "—", "—"];
    const subs = ["上传数据后统计", "上传数据后统计", "上传数据后统计", "尚未训练", "尚未训练", "尚未训练"];
    cards.forEach((card, i) => {
      const v = $(".value", card); if (v) v.textContent = zero[i] != null ? zero[i] : "—";
      const s = $(".sub", card); if (s) s.innerHTML = subs[i] || "—";
    });
    $$(".bar-group").forEach((g) => {
      $$(".bar", g).forEach((b) => { b.style.height = "2px"; const bb = $("b", b); if (bb) bb.textContent = "—"; });
    });
    const note = $(".chart-note span");
    if (note) note.textContent = "尚未训练模型。请先在『数据集管理』上传 train/test，再到『模型训练』开始训练，这里会显示真实性能对比。";
    const plist = $(".param-list");
    if (plist) plist.innerHTML = '<div class="param" style="opacity:.7;">尚未训练，暂无最优参数</div>';
    // 快速预测结果区清空示例数据
    $$(".predict-panel .result-value").forEach((el) => (el.textContent = "—"));
    const basis = $(".predict-panel .basis"); if (basis) basis.textContent = "—";
    // tabs 在空白态仅提示
    $$(".tabs .tab").forEach((tab) => {
      tab.style.cursor = "pointer";
      tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        toast("尚未训练模型，暂无图表数据", "warn");
      });
    });
  }

  /* 首页右上角“指标视图”下拉：筛选性能对比中展示的指标列（让下拉真正可用） */
  function wireMetricView() {
    const toolbar = $(".chart-toolbar");
    if (!toolbar || toolbar.__wired) return;
    toolbar.__wired = true;
    const span = $("span", toolbar);
    const options = [
      { key: "all", label: "多指标对比", cols: [0, 1, 2, 3, 4] },
      { key: "core", label: "核心三项（Accuracy/F1/Macro-F1）", cols: [0, 3, 4] },
      { key: "acc", label: "仅 Accuracy", cols: [0] },
      { key: "f1", label: "仅 F1-score", cols: [3] },
      { key: "macro", label: "仅 Macro-F1", cols: [4] },
    ];
    const apply = (cols) => {
      $$(".bar-group").forEach((g, i) => (g.style.display = cols.indexOf(i) >= 0 ? "" : "none"));
      $$(".x-labels span").forEach((s, i) => (s.style.display = cols.indexOf(i) >= 0 ? "" : "none"));
    };
    toolbar.style.cursor = "pointer";
    toolbar.style.position = "relative";
    let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; } };
    toolbar.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu) { close(); return; }
      menu = document.createElement("div");
      menu.style.cssText = "position:absolute;right:0;top:calc(100% + 6px);min-width:240px;background:#fff;border:1px solid #e5e7eb;" +
        "border-radius:9px;box-shadow:0 14px 34px rgba(0,0,0,.16);z-index:60;overflow:hidden;";
      menu.innerHTML = options.map((o) =>
        '<div data-k="' + o.key + '" style="padding:10px 15px;font-size:14px;color:#374151;white-space:nowrap;cursor:pointer;" ' +
        'onmouseenter="this.style.background=\'#fef2f2\'" onmouseleave="this.style.background=\'#fff\'">' + esc(o.label) + '</div>').join("");
      menu.querySelectorAll("[data-k]").forEach((row) => row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const opt = options.find((o) => o.key === row.dataset.k);
        if (span) span.textContent = "指标视图：" + (opt.key === "all" ? "多指标对比" : opt.label);
        apply(opt.cols); close();
      }));
      toolbar.appendChild(menu);
    });
    document.addEventListener("click", close);
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
      // 完成=绿色✓；未完成=红色（与“模型未加载”红色一致，明确提示该步骤尚未进行）
      if (check) {
        check.style.borderColor = check.style.color = ev.done ? "#22c55e" : "#dc2626";
        const icon = check.querySelector("i,svg");
        if (icon) icon.style.opacity = ev.done ? "1" : "0.35";
      }
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
      // 菜单挂到 body 并用 fixed 定位，避免被缩放的 .app / overflow 容器裁剪
      const r = el.getBoundingClientRect();
      menu.style.cssText = "position:fixed;background:#fff;border:1px solid #e5e7eb;border-radius:8px;" +
        "box-shadow:0 12px 30px rgba(0,0,0,.14);z-index:10001;overflow:auto;max-height:60vh;";
      menu.style.left = r.left + "px";
      menu.style.top = (r.bottom + 4) + "px";
      menu.style.minWidth = r.width + "px";
      options.forEach((o) => {
        const row = document.createElement("div");
        row.textContent = o.label;
        row.style.cssText = "padding:10px 16px;font-size:15px;color:#374151;white-space:nowrap;cursor:pointer;";
        row.onmouseenter = () => (row.style.background = "#fef2f2");
        row.onmouseleave = () => (row.style.background = "#fff");
        row.onclick = (ev) => { ev.stopPropagation(); el.__value = o.key; setLabel(o.label); close(); if (onSelect) onSelect(o.key, o.label); };
        menu.appendChild(row);
      });
      document.body.appendChild(menu);
    });
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
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

    // —— 相似新闻 / 历史记录：表格区域加滚动条；隐藏“查看更多”按钮（滚动代替）——
    injectPageCss("__pred-css", [
      ".grid-bottom .table-panel .simple-table{height:auto!important;max-height:232px!important;overflow:auto!important}",
      ".grid-bottom .table-panel .simple-table table thead th{position:sticky;top:0;background:#fff;z-index:2}",
      ".grid-bottom .table-panel .link-btn{display:none!important}",
    ].join("\n"));

    // 统计卡片
    try {
      const s = await api("/api/prediction/stats");
      const cards = $$(".stats .stat");
      const setS = (i, v, sub) => { if (cards[i]) { setText($(".val", cards[i]), v); if (sub !== undefined && $(".sub", cards[i])) $(".sub", cards[i]).textContent = sub; } };
      setS(0, fmtInt(s.today), "今日累计");
      setS(1, fmtInt(s.week), "近 7 日");
      setS(2, s.model_accuracy != null ? fmtPct(s.model_accuracy) : "0", s.current_model ? "当前最优：" + s.current_model : "当前最优：0");
      setS(3, "0", "实时测量");
      setS(4, s.num_classes, "新闻类别覆盖");
      setS(5, fmtInt(s.total), "系统累计");
      const st = $$(".footer-row .status-line span");
      if (st[0]) st[0].innerHTML = `当前模型：<i class="${s.current_model ? "green-dot" : "red-dot"}"></i>${s.current_model || "0"}`;
      if (st[1]) st[1].innerHTML = `模型状态：<i class="${s.current_model ? "green-dot" : "red-dot"}"></i><b style="color:${s.current_model ? "#16a34a" : "#dc2626"}">${s.current_model ? "已加载" : "未加载"}</b>`;
      if (st[2]) st[2].textContent = "最后更新：" + (s.current_model ? new Date().toLocaleString("zh-CN", { hour12: false }) : "—");
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
    blankPrediction();
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
        const dist = $(".dist");
        if (dist) dist.innerHTML = '<div class="dist-row"><span>读取中</span><div class="track"><i style="width:35%"></i></div><span class="dist-val">...</span></div>';
        try {
          const r = await postJSON("/api/prediction/predict", { text, model: selModel, options: opts });
          lastText = text;
          renderPredResult(r);
          if (opts.keywords) renderKeywords(r.keywords || []); else clearKeywords();
          if (opts.similar) loadSimilar(text, r.pred_name); else clearSimilar();
          if (opts.save) { loadHistory(); loadDistribution(); }
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
      const st = $$(".footer-row .status-line span");
      if (st[2]) st[2].textContent = "最后更新：　" + (r.time || new Date().toLocaleString("zh-CN"));
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
      window.__predKeywords = kws || [];
      if (!kws.length) { tb.innerHTML = `<tr><td colspan="4">该文本未命中显著特征</td></tr>`; return; }
      tb.innerHTML = kws.map((k) => `<tr><td>${k.keyword}</td><td>${k.weight}</td><td>${k.contribution}%</td><td>${k.position}</td></tr>`).join("");
    }
    function clearKeywords() {
      window.__predKeywords = [];
      const tb = $(".ktable table tbody");
      if (tb) tb.innerHTML = '<tr><td colspan="4" style="color:#9ca3af">未勾选关键词解释，训练并预测后才显示</td></tr>';
    }
    function clearSimilar() {
      const panel = $$(".grid-bottom .table-panel")[0];
      const tb = panel && $("table tbody", panel);
      if (tb) tb.innerHTML = '<tr><td colspan="4" style="color:#9ca3af">未勾选显示相似新闻</td></tr>';
    }
    function blankPrediction() {
      const pm = $(".result-card .pred-main span"); if (pm) pm.textContent = "0";
      const cf = $(".result-card .confidence b"); if (cf) cf.textContent = "0";
      const metas = $$(".result-card .pred-meta span");
      if (metas[0]) metas[0].innerHTML = "<b>模型：</b> 0";
      if (metas[1]) metas[1].innerHTML = "<b>预测时间：</b> 0";
      const dist = $(".dist"); if (dist) dist.innerHTML = '<div class="dist-row"><span>0</span><div class="track"><i style="width:0%"></i></div><span class="dist-val">0</span></div>';
      clearKeywords();
      clearSimilar();
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
        const items = (r.items || []).filter((it) => it.similarity == null || Number(it.similarity) >= 75);
        window.__similarNews = items;
        if (!items.length) { tb.innerHTML = `<tr><td colspan="4" style="color:#6b7280">${r.note || "暂无 75% 以上相似新闻"}</td></tr>`; return; }
        tb.innerHTML = items.map((it, i) =>
          `<tr><td><a href="#" data-i="${i}" style="color:#dc2626;text-decoration:none;text-align:center">${it.title}</a></td>` +
          `<td>${category || it.site || "-"}</td><td>${it.similarity != null ? it.similarity + "%" : "-"}</td><td>${it.date || "-"}</td></tr>`).join("");
        $$("a[data-i]", tb).forEach((a) => a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const it = window.__similarNews[+a.dataset.i];
          const m = modal("相似新闻详情", `<div style="color:#6b7280">正在抓取网页正文…</div>`, { width: "760px" });
          api("/api/prediction/similar-detail?url=" + encodeURIComponent(it.url || "") + "&title=" + encodeURIComponent(it.title || ""))
            .then((r) => { m.body.innerHTML = `<div style="max-height:60vh;overflow:auto;line-height:1.8;color:#374151"><h3 style="text-align:center;color:#111827;margin-bottom:10px">${esc(r.title || it.title || "")}</h3><pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px">${esc(r.markdown || "")}</pre></div>`; })
            .catch((e) => { m.body.innerHTML = `<div style="color:#dc2626">网页正文抓取失败：${esc(e.message)}</div><p><a href="${it.url || "#"}" target="_blank" rel="noopener">${esc(it.url || "")}</a></p>`; });
        }));
      } catch (e) { tb.innerHTML = `<tr><td colspan="4" style="color:#dc2626">相似新闻获取失败：${e.message}</td></tr>`; }
    }
    const simRefresh = $(".grid-bottom .table-panel .refresh");
    if (simRefresh) { simRefresh.style.cursor = "pointer"; simRefresh.addEventListener("click", () => { if (lastText) loadSimilar(lastText, ($(".result-card .pred-main span") || {}).textContent); else toast("请先预测一条新闻", "warn"); }); }

    // 历史 & 分布
    async function loadHistory() {
      try {
        const r = await api("/api/prediction/history?limit=200");
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
        if (!r.distribution || !r.distribution.length) {
          if (donut) donut.style.background = "conic-gradient(#e5e7eb 0 100%)";
          if (legend) legend.innerHTML = '<div style="display:block;height:auto;color:#9ca3af;white-space:nowrap;font-size:13px">暂无预测数据，预测后生成统计图</div>';
          return;
        }
        const palette = ["#dc2626", "#f97316", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#14b8a6", "#a16207"];
        let acc = 0; const segs = [];
        r.distribution.forEach((d, i) => { const c = palette[i % palette.length]; segs.push(`${c} ${acc}% ${acc + d.ratio}%`); acc += d.ratio; });
        if (donut) donut.style.background = `conic-gradient(${segs.join(",")})`;
        if (legend) legend.innerHTML = r.distribution.map((d, i) =>
          `<div><i class="catdot" style="background:${palette[i % palette.length]}"></i><span>${d.name}</span><b>${d.ratio}%（${fmtInt(d.count)}）</b></div>`).join("");
      } catch (e) {}
    }
    const moreKw = $(".keyword .bottom-btn");
    if (moreKw) moreKw.addEventListener("click", () => {
      const kws = window.__predKeywords || [];
      const rows = kws.length ? kws.map((k) => `<tr><td>${esc(k.keyword || "")}</td><td>${k.weight}</td><td>${k.contribution}%</td><td>${k.position}</td></tr>`).join("") : '<tr><td colspan="4" style="color:#9ca3af">暂无关键词分析</td></tr>';
      modal("全部关键词分析", `<div style="max-height:60vh;overflow:auto"><table style="width:100%;border-collapse:collapse;text-align:center"><thead><tr><th>关键词</th><th>权重</th><th>贡献度</th><th>出现位置</th></tr></thead><tbody>${rows}</tbody></table></div>`, { width: "620px" });
    });
    const detailStats = $(".donut-panel .link-btn");
    if (detailStats) detailStats.addEventListener("click", async () => {
      const r = await api("/api/prediction/distribution");
      const rows = (r.distribution || []).map((d) => `<tr><td>${esc(d.name)}</td><td>${fmtInt(d.count)}</td><td>${d.ratio}%</td></tr>`).join("") || '<tr><td colspan="3" style="color:#9ca3af">暂无预测统计</td></tr>';
      modal("类别分布详细统计", `<table style="width:100%;border-collapse:collapse;text-align:center"><thead><tr><th>类别</th><th>新闻条数</th><th>占比</th></tr></thead><tbody>${rows}</tbody></table>`, { width: "520px" });
    });
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
    // —— 底部四模块：整体上抬一点；“快捷操作”右缘拉伸到与监控模块右缘对齐 ——
    injectPageCss("__training-css", [
      ".bottom{grid-template-columns:440px 540px 390px 1fr!important;height:228px!important;gap:14px!important}",
      ".bottom .panel{height:228px!important}",
    ].join("\n"));
    // 修正首个统计卡标题的笔误（两个都写了“测试集样本数”）
    const statCards = $$(".stats .stat");
    const lab0 = statCards[0] && $(".lab", statCards[0]);
    if (lab0 && lab0.textContent.indexOf("测试") >= 0) lab0.textContent = "训练集样本数";

    // —— 统计卡：值 +「较上次」（首次训练无 deltas → 不显示）——
    function setStat(i, val, deltaText) {
      const card = statCards[i]; if (!card) return;
      const v = $(".val", card); if (v) v.textContent = (val == null || val === "") ? "0" : val;
      const sub = $(".sub", card);
      if (sub) {
        if (deltaText) sub.innerHTML = '较上次 <span class="' + (deltaText === "无变化" ? "" : "up") + '">' + esc(deltaText) + '</span>';
        else sub.textContent = "";
      }
    }
    // —— 进度步骤：blank=全空圆(pending)，done=全红勾 ——
    function setStepper(mode) {
      $$(".train-stepper .tstep").forEach((s) => { s.classList.remove("done", "current", "pending"); s.classList.add(mode === "done" ? "done" : "pending"); });
      const red = $(".train-stepper .line-red"); if (red) red.style.width = mode === "done" ? "575px" : "0";
    }
    // —— 状态行（5格：数据状态/当前阶段/运行状态/最优模型/已用时间）——
    function setStatus(mode, elapsed, hasData) {
      const sv = $$(".status-row .sbox .sval"), boxes = $$(".status-row .sbox");
      const set = (i, txt, cls) => { if (sv[i]) { sv[i].textContent = txt; sv[i].className = "sval" + (cls ? " " + cls : ""); } };
      if (mode === "done") { set(0, "已完成", "green"); set(1, "已完成", "green"); set(2, "已完成", "green"); set(3, "已更新", "green"); set(4, elapsed != null ? elapsed + "s" : "—"); if (boxes[1]) boxes[1].classList.remove("hot"); }
      else if (mode === "running") { set(0, "已就绪", "green"); set(1, "模型训练", "orange"); set(2, "运行中", "blue"); set(3, "计算中"); set(4, "…"); if (boxes[1]) boxes[1].classList.add("hot"); }
      else { set(0, hasData ? "已就绪" : "未就绪", hasData ? "green" : ""); set(1, "未开始"); set(2, "待运行"); set(3, "0"); set(4, "0s"); if (boxes[1]) boxes[1].classList.remove("hot"); }
    }
    // —— Macro-F1 折线图：显隐数据元素（保留网格/坐标轴骨架）——
    const chartSvg = $(".chart-panel svg");
    function chartDataEls() {
      if (!chartSvg) return [];
      return [].concat($$("path[stroke]", chartSvg), $$('g[fill="#e11d26"]', chartSvg), $$('g[fill="#3b82f6"]', chartSvg), $$('g[font-weight="900"]', chartSvg));
    }
    function setChartData(show, mf) {
      chartDataEls().forEach((el) => (el.style.display = show ? "" : "none"));
      if (show && mf && chartSvg) $$("text", chartSvg).forEach((tx) => { const v = tx.getAttribute("fill"); if (v === "#e11d26" && mf.nb != null) tx.textContent = mf.nb.toFixed(4); if (v === "#3b82f6" && mf.lr != null) tx.textContent = mf.lr.toFixed(4); });
    }
    // —— 结果对比表：表头/指标名保留，数据空 ——
    const RESULT_METRICS = ["Accuracy", "Precision", "Recall", "F1-score", "Macro-F1", "训练时间"];
    function blankResultTable() {
      const tb = $(".result-table table tbody");
      if (tb) tb.innerHTML = RESULT_METRICS.map((m) => `<tr><td>${m}</td><td>0</td><td>0</td><td>0</td></tr>`).join("");
    }
    // —— 参数详情/最优候选 ——
    function blankParams() {
      $$(".param-wrap .param-card").forEach((card) => { $$(".prow b", card).forEach((b) => (b.textContent = "0")); const tag = $(".param-head .tag", card); if (tag) tag.remove(); });
      $$(".model-cards .best-tag").forEach((t) => (t.style.display = "none"));
    }
    function setBestCandidate(bestKey) {
      const idx = bestKey === "nb" ? 0 : 1;
      $$(".param-wrap .param-card").forEach((card, i) => {
        let tag = $(".param-head .tag", card);
        if (i === idx) { if (!tag) { tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "最优候选"; const head = $(".param-head", card); if (head) head.appendChild(tag); } tag.style.display = ""; }
        else if (tag) tag.remove();
      });
      $$(".model-cards .model-card").forEach((mc, i) => { const bt = $(".best-tag", mc); if (bt) bt.style.display = (i === idx) ? "" : "none"; });
    }
    // —— 结论区：blank=只有绿点、无答案 ——
    function blankConclusion() {
      const clist = $(".conclusion .clist");
      if (clist) clist.innerHTML = Array(4).fill('<div><span class="cdot">✓</span><span style="color:#9ca3af">训练后由模型结果生成</span></div>').join("");
      const rec = $(".recommend");
      if (rec) { const b = $("b", rec); if (b) b.textContent = "0"; const sp = rec.querySelector("span:last-child"); if (sp) sp.textContent = "Macro-F1 = 0"; }
    }
    // —— 整页空白态 ——
    function blankTraining(hasData) {
      [0, 1, 2, 3, 4, 5].forEach((i) => setStat(i, null, ""));
      const c5v = statCards[5] && $(".val", statCards[5]); if (c5v) c5v.textContent = "0";
      blankParams(); blankResultTable(); blankConclusion();
      setStepper("blank"); setStatus("blank", null, hasData); setChartData(false);
      $$(".cost-card .cost-row").forEach((r) => { const b = $("b", r); if (b) b.textContent = "0"; const bar = $("i", r); if (bar) bar.style.width = "0%"; });
      $$(".round-info > div span").forEach((s) => (s.textContent = "0"));
      const logbox = $(".logbox"); if (logbox) $$(".logrow", logbox).forEach((n) => n.remove());
    }

    function renderTraining(res) {
      if (!res || res.trained === false) return;
      const sc = res.stat_cards || {};
      const d = sc.deltas || null;
      setStat(0, fmtInt(sc.train_count), d && d.train_count);
      setStat(1, fmtInt(sc.test_count), d && d.test_count);
      setStat(2, sc.random_state, d && d.random_state);
      setStat(3, sc.candidate_models, d && d.candidate_models);
      setStat(4, sc.rounds, d && d.rounds);
      setStat(5, sc.best_model, d && d.best_model);

      const pcards = $$(".param-wrap .param-card");
      const fillParams = (card, params) => { if (!card) return; $$(".prow", card).forEach((row) => { const k = $("span", row).textContent.trim(); if (params[k] !== undefined) $("b", row).textContent = params[k]; }); };
      if (res.param_details) { fillParams(pcards[0], res.param_details.nb || {}); fillParams(pcards[1], res.param_details.lr || {}); }
      setBestCandidate(res.best_model);

      const tb = $(".result-table table tbody");
      if (tb && res.result_table) {
        tb.innerHTML = res.result_table.map((r) => {
          const cls = r.metric === "训练时间" ? "" : (r.improve_up ? "green" : "red");
          const lrCell = r.metric === "Macro-F1" ? `<td class="red">${r.lr}</td>` : `<td>${r.lr}</td>`;
          return `<tr><td>${r.metric}</td><td>${r.nb}</td>${lrCell}<td class="${cls}">${r.improve}</td></tr>`;
        }).join("");
      }

      const t = (res.monitor || {}).timings || {};
      const costB = $$(".cost-card .cost-row");
      if (costB[0]) $("b", costB[0]).textContent = (t.nb || 0) + "s";
      if (costB[1]) $("b", costB[1]).textContent = (t.lr || 0) + "s";
      const mx = Math.max(t.nb || 0, t.lr || 0) || 1;
      if (costB[0] && $(".redbar", costB[0])) $(".redbar", costB[0]).style.width = Math.max(8, (t.nb / mx) * 90) + "%";
      if (costB[1] && $(".bluebar", costB[1])) $(".bluebar", costB[1]).style.width = Math.max(8, (t.lr / mx) * 90) + "%";
      const roundInfo = $$(".round-info > div");
      if (roundInfo[0]) $("span", roundInfo[0]).textContent = sc.rounds || "2 / 2";
      if (roundInfo[2]) $("span", roundInfo[2]).textContent = fmtInt(sc.val_count) + " 样本";
      if (roundInfo[3]) $("span", roundInfo[3]).textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });

      setChartData(true, (res.monitor || {}).macro_f1 || {});

      const clist = $(".conclusion .clist");
      if (clist && res.conclusions && res.conclusions.length) clist.innerHTML = res.conclusions.map((c) => `<div><span class="cdot">✓</span>${esc(c)}</div>`).join("");
      const rec = $(".recommend");
      if (rec && res.recommend) { const b = $("b", rec); if (b) b.textContent = res.recommend.model_name || res.best_model_name; const sp = rec.querySelector("span:last-child"); if (sp && res.recommend.macro_f1 != null) sp.textContent = "Macro-F1 = " + res.recommend.macro_f1.toFixed(4); }

      if (res.logs) { const logbox = $(".logbox"); if (logbox) { $$(".logrow", logbox).forEach((n) => n.remove()); res.logs.forEach((lg) => { const row = document.createElement("div"); row.className = "logrow"; row.innerHTML = `<span class="okdot">✓</span><span>${esc(lg.msg)}</span><span class="time">${new Date().toLocaleTimeString("zh-CN", { hour12: false })}</span>`; logbox.appendChild(row); }); } }

      setStepper("done"); setStatus("done", res.elapsed);
      refreshIcons();
    }

    // 训练设置：每项下拉可选 / random_state 可输入
    const ctrls = $$(".form .field .ctrl");
    const fieldCtrl = (kw) => ctrls.find((c) => { const l = c.parentElement.querySelector("label"); return l && l.textContent.indexOf(kw) >= 0; });
    const splitCtrl = fieldCtrl("划分方式");
    if (splitCtrl) customDropdown(splitCtrl, [{ key: "分层抽样", label: "分层抽样" }, { key: "随机抽样", label: "随机抽样" }], null, { key: "分层抽样", label: "分层抽样" });
    const metricCtrl = fieldCtrl("评价指标");
    if (metricCtrl) customDropdown(metricCtrl, [{ key: "Macro-F1", label: "Macro-F1" }, { key: "Accuracy", label: "Accuracy" }, { key: "F1-score", label: "F1-score" }], null, { key: "Macro-F1", label: "Macro-F1" });
    const saveCtrl = fieldCtrl("保存");
    if (saveCtrl) customDropdown(saveCtrl, [{ key: "是", label: "是" }, { key: "否", label: "否" }], null, { key: "是", label: "是" });
    const ratioCtrl = fieldCtrl("验证集比例");
    if (ratioCtrl) customDropdown(ratioCtrl, [{ key: "0.1", label: "0.1" }, { key: "0.15", label: "0.15" }, { key: "0.2", label: "0.2" }, { key: "0.25", label: "0.25" }, { key: "0.3", label: "0.3" }], null, { key: "0.2", label: "0.2" });
    const rsCtrl = fieldCtrl("random_state");
    if (rsCtrl) { rsCtrl.setAttribute("contenteditable", "true"); rsCtrl.style.cursor = "text"; rsCtrl.style.outline = "none"; }

    // 初始：拉取已有训练结果，否则进入空白态
    try {
      const res = await api("/api/training/result");
      if (res.trained) renderTraining(res);
      else {
        const cfg = await api("/api/training/config");
        blankTraining(!!(cfg.has_train && cfg.has_test));
        if (ratioCtrl) customDropdown(ratioCtrl, [{ key: "0.1", label: "0.1" }, { key: "0.15", label: "0.15" }, { key: "0.2", label: "0.2" }, { key: "0.25", label: "0.25" }, { key: "0.3", label: "0.3" }], null, { key: String(cfg.training_settings.val_ratio), label: String(cfg.training_settings.val_ratio) });
        if (rsCtrl) rsCtrl.textContent = cfg.training_settings.random_state;
        if (!cfg.has_train || !cfg.has_test) toast("未找到训练/测试集，请先在『数据集管理』上传数据。", "warn");
      }
    } catch (e) { blankTraining(false); toast(e.message, "error"); }

    // 开始训练
    const trainBtn = $(".config .actions .btn.primary");
    if (trainBtn) {
      trainBtn.style.cursor = "pointer";
      trainBtn.addEventListener("click", async () => {
        trainBtn.disabled = true;
        const old = trainBtn.innerHTML;
        trainBtn.innerHTML = "训练中…";
        $$(".step-tabs .step-tab").forEach((s, i) => s.classList.toggle("active", i === 1));
        setStatus("running");
        try {
          const res = await postJSON("/api/training/run", {});
          renderTraining(res);
          $$(".step-tabs .step-tab").forEach((s, i) => s.classList.toggle("active", i === 2));
          toast("训练完成：最优 " + (res.best_model_name || ""), "info");
        } catch (e) { setStatus("blank", null, true); toast("训练失败：" + e.message, "error"); }
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
    makeSwitch($(".toggle .switch"), true, (v) => { autoValidate = v; });
    // 初始空白：清掉写死的导入日志
    $$(".log-box .log-row").forEach((n) => n.remove());
    const pg = { page: 1, size: 5, list: [], selected: null, query: "" };

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
        loadAll();
      } catch (e) { appendLog("上传失败：" + e.message, false); toast("上传失败：" + e.message, "error"); }
    }
    function pickFile(dtype) {
      if (!requireLogin("请先登录后再上传数据集")) return;
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
        if (!f) return;
        if (!requireLogin("请先登录后再上传数据集")) return;
        doUpload(/test/i.test(f.name) ? "test" : "train", f);
      });
    }
    const clearLog = $(".clear-log");
    if (clearLog) clearLog.addEventListener("click", () => $$(".log-box .log-row").forEach((n) => n.remove()));

    function rowHTML(r) {
      return `<tr data-id="${r.id}"><td><div class="file-name"><span class="file-icon"><svg class="icon small-icon"><use href="#i-file"/></svg></span>${esc(r.name)}</div></td>` +
        `<td><span class="tag ${r.dtype === "train" ? "blue" : "green"}">${r.type_label}</span></td>` +
        `<td>${fmtInt(r.sample_count)}</td><td>${r.num_classes}</td><td>${(r.uploaded_at || "").slice(0, 16)}</td>` +
        `<td><span class="tag ${r.status === "已入库" ? "loaded" : "orange"}">${r.status}</span></td>` +
        `<td><span class="link-blue act-preview">预览</span><span class="link-red act-del">删除</span></td></tr>`;
    }
    function renderListPage() {
      const tb = $(".data-table tbody");
      const q = (pg.query || "").toLowerCase();
      const view = q ? pg.list.filter((d) => (d.name || "").toLowerCase().includes(q)) : pg.list;
      const total = view.length;
      const pages = Math.max(1, Math.ceil(total / pg.size));
      if (pg.page > pages) pg.page = pages;
      if (pg.page < 1) pg.page = 1;
      const slice = view.slice((pg.page - 1) * pg.size, (pg.page - 1) * pg.size + pg.size);
      if (tb) tb.innerHTML = total ? slice.map(rowHTML).join("")
        : `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:18px">${q ? "未找到匹配的数据集" : "暂无数据集，请上传 train.txt / test.txt"}</td></tr>`;
      const cnt = $(".pagination > span");
      if (cnt) cnt.textContent = "共 " + total + " 条";
      const pageNum = $(".pagination .page-num");
      if (pageNum) pageNum.textContent = pages > 1 ? `${pg.page} / ${pages}` : String(pg.page);
      $$(".data-table tbody tr").forEach((tr) => {
        const id = tr.getAttribute("data-id");
        const r = view.find((x) => String(x.id) === String(id));
        const pv = $(".act-preview", tr);
        if (pv) { pv.style.cursor = "pointer"; pv.onclick = () => openFullPreview(id, r && r.name); }
        const del = $(".act-del", tr);
        if (del) { del.style.cursor = "pointer"; del.onclick = async () => { if (!confirm("确认删除该数据集？")) return; try { await api("/api/datasets/" + id, { method: "DELETE" }); toast("已删除"); loadAll(); } catch (e) { toast(e.message, "error"); } }; }
      });
      refreshIcons();
    }

    let dsSelBuilt = false;
    function buildDatasetSelect() {
      const el = $(".dataset-select");
      if (!el) return;
      const setLabel = (txt) => { Array.from(el.childNodes).forEach((n) => { if (n.nodeType === 3) el.removeChild(n); }); el.insertBefore(document.createTextNode((txt || "（无数据集）") + " "), el.firstChild); };
      setLabel(pg.selected);
      if (dsSelBuilt) return;
      dsSelBuilt = true;
      el.style.position = "relative"; el.style.cursor = "pointer";
      let menu = null;
      const close = () => { if (menu) { menu.remove(); menu = null; } };
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (menu) { close(); return; }
        const names = Array.from(new Set(pg.list.map((d) => d.name)));
        menu = document.createElement("div");
        menu.style.cssText = "position:absolute;right:0;top:calc(100% + 6px);min-width:190px;max-height:240px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.14);z-index:60;";
        if (!names.length) menu.innerHTML = '<div style="padding:12px 16px;color:#9ca3af;font-size:14px;">暂无数据集</div>';
        names.forEach((nm) => {
          const row = document.createElement("div");
          row.textContent = nm;
          row.style.cssText = "padding:10px 16px;font-size:14px;color:#374151;cursor:pointer;white-space:nowrap;";
          row.onmouseenter = () => (row.style.background = "#fef2f2");
          row.onmouseleave = () => (row.style.background = "#fff");
          row.onclick = async (ev) => { ev.stopPropagation(); close(); try { await postJSON("/api/datasets/select", { name: nm }); pg.selected = nm; setLabel(nm); toast("已切换：" + nm); loadDist(); loadSchema(); } catch (e) { toast(e.message, "error"); } };
          menu.appendChild(row);
        });
        el.appendChild(menu);
      });
      document.addEventListener("click", close);
    }

    async function loadSchema() {
      try {
        const q = pg.selected ? "?name=" + encodeURIComponent(pg.selected) : "";
        const d = await api("/api/datasets/schema" + q);
        const tb = $(".schema-table tbody");
        if (tb) tb.innerHTML = d.fields.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.type)}</td><td>${esc(f.desc)}</td></tr>`).join("");
      } catch (e) {}
    }

    function selectedDatasetId() {
      const sel = pg.list.filter((d) => !pg.selected || d.name === pg.selected);
      const train = sel.find((d) => d.dtype === "train") || sel[0] || pg.list[0];
      return train ? train.id : null;
    }
    function openFullPreview(dsId, name) {
      if (!dsId) { toast("请先上传数据集", "warn"); return; }
      const wrap = document.createElement("div");
      wrap.innerHTML =
        '<div class="__fp-meta" style="margin-bottom:10px;color:#6b7280;font-size:13px;">加载中…</div>' +
        '<div class="__fp-scroll" style="max-height:60vh;overflow:auto;border:1px solid #eef0f3;border-radius:8px;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="position:sticky;top:0;background:#f9fafb;z-index:1;">' +
        '<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #eef0f3;">#</th>' +
        '<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #eef0f3;">text（新闻文本）</th>' +
        '<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #eef0f3;">label</th>' +
        '<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #eef0f3;">类别</th></tr></thead><tbody class="__fp-body"></tbody></table></div>';
      modal("数据集预览" + (name ? "：" + name : ""), wrap, { width: "780px" });
      const scroll = $(".__fp-scroll", wrap), body = $(".__fp-body", wrap), meta = $(".__fp-meta", wrap);
      let offset = 0, total = 0, loading = false, done = false;
      async function loadMore() {
        if (loading || done) return;
        loading = true;
        try {
          const d = await api("/api/datasets/" + dsId + "/rows?offset=" + offset + "&limit=100");
          total = d.total;
          body.insertAdjacentHTML("beforeend", d.rows.map((r) =>
            `<tr><td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;color:#9ca3af;">${r.idx}</td>` +
            `<td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;">${esc(r.text)}</td>` +
            `<td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;">${r.label}</td>` +
            `<td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;">${esc(r.label_name)}</td></tr>`).join(""));
          offset += d.rows.length;
          meta.textContent = `共 ${fmtInt(total)} 条，已加载 ${fmtInt(offset)} 条` + (offset >= total ? "（已全部加载）" : "，向下滚动加载更多");
          if (offset >= total || !d.rows.length) done = true;
        } catch (e) { meta.textContent = "加载失败：" + e.message; done = true; }
        finally { loading = false; }
      }
      scroll.addEventListener("scroll", () => { if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 60) loadMore(); });
      loadMore();
    }

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
        pg.list = d.list || [];
        pg.selected = d.selected;
        renderListPage();
        buildDatasetSelect();
      } catch (e) { toast(e.message, "error"); }
    }
    function loadAll() { loadList(); loadDist(); loadDbStatus(); loadSchema(); }

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
    if (refreshBtn) refreshBtn.addEventListener("click", () => { loadAll(); toast("已刷新"); });

    // 分页：每页条数下拉 + 翻页
    const pageSelect = $(".pagination .page-select");
    if (pageSelect) customDropdown(pageSelect, [{ key: "5", label: "5条/页" }, { key: "10", label: "10条/页" }, { key: "20", label: "20条/页" }], (k) => { pg.size = +k; pg.page = 1; renderListPage(); }, { key: "5", label: "5条/页" });
    const navs = $$(".pagination > svg");
    if (navs[0]) { navs[0].style.cursor = "pointer"; navs[0].addEventListener("click", () => { if (pg.page > 1) { pg.page--; renderListPage(); } }); }
    if (navs[1]) { navs[1].style.cursor = "pointer"; navs[1].addEventListener("click", () => { const pages = Math.max(1, Math.ceil(pg.list.length / pg.size)); if (pg.page < pages) { pg.page++; renderListPage(); } }); }

    $$(".quick-panel .quick-card").forEach((q) => {
      q.style.cursor = "pointer";
      const t = q.textContent;
      q.addEventListener("click", () => {
        if (t.indexOf("开始预览") >= 0) openFullPreview(selectedDatasetId(), pg.selected);
        else if (t.indexOf("进入清洗") >= 0) location.href = "/preview.html?auto=clean";
        else if (t.indexOf("查看统计") >= 0) showStatsModal();
        else if (t.indexOf("重新上传") >= 0) pickFile("train");
      });
    });

    // 数据集名称搜索：点击转为输入框，实时过滤列表
    const listSearch = $(".list-search");
    if (listSearch) {
      listSearch.style.cursor = "text";
      listSearch.addEventListener("click", () => {
        let inp = $("input", listSearch);
        if (inp) { inp.focus(); return; }
        Array.from(listSearch.childNodes).forEach((n) => { if (n.nodeType === 3) n.remove(); });
        inp = document.createElement("input");
        inp.placeholder = "搜索数据集名称...";
        inp.value = pg.query || "";
        inp.style.cssText = "flex:1;min-width:60px;border:none;outline:none;background:transparent;font-size:13px;color:#111827;font-family:inherit;";
        listSearch.appendChild(inp);
        inp.focus();
        inp.addEventListener("input", () => { pg.query = inp.value.trim(); pg.page = 1; renderListPage(); });
      });
    }

    // 字段结构列表：包一层滚动容器（带滚动条，内容多时可滚动看全）
    const schemaTbl = $(".schema-table");
    if (schemaTbl && schemaTbl.parentElement && !schemaTbl.parentElement.classList.contains("__sch")) {
      const w = document.createElement("div");
      w.className = "__sch";
      schemaTbl.parentNode.insertBefore(w, schemaTbl);
      w.appendChild(schemaTbl);
    }

    loadAll();
    refreshIcons();
  }

  /* ----------------- 数据预览与清洗 ----------------- */
  async function initPreview() {
    const state = { page: 1, page_size: 30, total: 0, tab: "raw", q: "", label: "", data_type: "", length: "" };
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
        const qs = new URLSearchParams({ page: state.page, page_size: state.page_size, tab: state.tab });
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
            `<tr><td>${(state.page - 1) * state.page_size + i + 1}</td><td class="text">${esc(r.text)}</td><td>${r.label}</td><td>${r.label_name}</td><td>${r.data_type}</td><td>${r.length}</td>` +
            `<td><span class="status-badge ${r.status === "正常" ? "" : "bad"}">${r.status}</span></td></tr>`).join("");
        }
        const foot = $(".table-footer > span");
        if (foot) foot.textContent = "共 " + fmtInt(d.total) + " 条";
        state.total = d.total || 0;
        renderPager();
      } catch (e) { toast(e.message, "error"); }
    }

    // —— 分页器：动态页码（当前红框）+ 左右翻页 + 每页条数 + 可输入跳页 ——
    function totalPages() { return Math.max(1, Math.ceil((state.total || 0) / state.page_size)); }
    function pageWindow(page, pages) {
      const out = [];
      if (pages <= 7) { for (let i = 1; i <= pages; i++) out.push(i); return out; }
      out.push(1);
      let lo = Math.max(2, page - 1), hi = Math.min(pages - 1, page + 1);
      if (lo > 2) out.push("…");
      for (let i = lo; i <= hi; i++) out.push(i);
      if (hi < pages - 1) out.push("…");
      out.push(pages);
      return out;
    }
    // 重建页码容器：去掉写死的页码 span，仅保留 .page-select，并插入 .page-nums
    const pagesEl = $(".table-footer .pages");
    if (pagesEl) {
      Array.from(pagesEl.querySelectorAll("span")).forEach((s) => { if (!s.classList.contains("page-select")) s.remove(); });
      if (!$(".page-nums", pagesEl)) {
        const nums = document.createElement("span");
        nums.className = "page-nums";
        nums.style.cssText = "display:flex;align-items:center;gap:12px;";
        const rightChev = $$("svg", pagesEl)[1];
        if (rightChev) pagesEl.insertBefore(nums, rightChev); else pagesEl.appendChild(nums);
      }
    }
    function renderPager() {
      const pages = totalPages();
      if (state.page > pages) state.page = pages;
      if (state.page < 1) state.page = 1;
      const cont = $(".table-footer .page-nums");
      if (cont) {
        cont.innerHTML = "";
        pageWindow(state.page, pages).forEach((p) => {
          const sp = document.createElement("span");
          if (p === "…") { sp.textContent = "…"; sp.style.color = "#9ca3af"; }
          else if (p === state.page) { sp.className = "page-num"; sp.textContent = String(p); }
          else { sp.textContent = String(p); sp.style.cssText = "cursor:pointer;color:#5f6878;min-width:14px;text-align:center;"; sp.onclick = () => { state.page = p; loadPreview(); }; }
          cont.appendChild(sp);
        });
      }
      const pin = $(".table-footer .page-input");
      if (pin && document.activeElement !== pin) pin.textContent = String(state.page);
    }
    const chevrons = $$(".table-footer .pages svg");
    chevrons.forEach((svg) => {
      const href = (svg.querySelector("use") || {}).getAttribute && (svg.querySelector("use") || {}).getAttribute("href");
      svg.style.cursor = "pointer";
      if (href && href.indexOf("chevron-left") >= 0) {
        svg.addEventListener("click", () => { if (state.page > 1) { state.page--; loadPreview(); } });
      } else if (href && href.indexOf("chevron-right") >= 0) {
        svg.addEventListener("click", () => { if (state.page < totalPages()) { state.page++; loadPreview(); } });
      }
    });
    const pageSel = $(".table-footer .page-select");
    if (pageSel) customDropdown(pageSel, [{ key: "10", label: "10条/页" }, { key: "20", label: "20条/页" }, { key: "30", label: "30条/页" }], (k) => { state.page_size = +k; state.page = 1; loadPreview(); }, { key: "30", label: "30条/页" });
    const pin = $(".table-footer .page-input");
    if (pin) {
      pin.setAttribute("contenteditable", "true");
      pin.style.cursor = "text"; pin.style.outline = "none";
      pin.addEventListener("focus", () => {
        const sel = window.getSelection && window.getSelection();
        if (sel) { const r = document.createRange(); r.selectNodeContents(pin); sel.removeAllRanges(); sel.addRange(r); }
      });
      const commitPageInput = () => {
        let v = parseInt((pin.textContent || "").trim(), 10);
        if (isNaN(v)) v = state.page;
        v = Math.min(totalPages(), Math.max(1, v));
        if (v !== state.page) { state.page = v; loadPreview(); }
        else pin.textContent = String(state.page);
      };
      pin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pin.blur(); } });
      pin.addEventListener("blur", commitPageInput);
    }
    const refreshBtn = $(".filter-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => { loadPreview(); toast("已刷新"); });

    // 清洗规则开关（统一 iOS 风格：开=绿+球右，关=灰+球左）
    const ruleKeys = ["strip_whitespace", "remove_abnormal", "keep_allowed", "drop_empty", "drop_duplicate", "min_length"];
    const ruleState = {}; ruleKeys.forEach((k) => (ruleState[k] = true));
    const ruleSwitches = $$(".rules-panel .rule-row .toggle-green").map((tg, i) =>
      makeSwitch(tg, true, (v) => { ruleState[ruleKeys[i]] = v; }));
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
    if (resetBtn) resetBtn.addEventListener("click", () => { ruleKeys.forEach((k) => (ruleState[k] = true)); ruleSwitches.forEach((s) => s && s.set(true)); toast("规则已重置"); });

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
      // 质量分析：类别分布（全部类别，可滚动；有数据填红）
      const qcards = $$(".quality-grid .quality-card");
      renderCategoryDist(res.category_distribution || res.category_top5 || []);
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

    // 类别分布：统一渲染（空数据=灰色骨架，有数据=灰底填红）
    function renderCategoryDist(dist) {
      const q0 = $$(".quality-grid .quality-card")[0];
      if (!q0) return;
      const h4 = $("h4", q0); if (h4) h4.innerHTML = h4.innerHTML.replace(/（前\s*5）/, "（全部类别）");
      $$(".bar-row", q0).forEach((n) => n.remove());
      let scroll = $(".__cat-scroll", q0);
      if (!scroll) { scroll = document.createElement("div"); scroll.className = "__cat-scroll"; q0.appendChild(scroll); }
      const list = (dist && dist.length) ? dist : names.map((n) => ({ name: n, count: 0, ratio: 0 }));
      const max = Math.max.apply(null, list.map((t) => t.ratio).concat([1]));
      scroll.innerHTML = list.map((t) =>
        '<div style="display:flex;align-items:center;gap:8px;margin:8px 0;">' +
        '<span style="width:54px;flex:none;color:#374151;font-size:13px;white-space:nowrap;">' + esc(t.name) + '</span>' +
        '<div class="bar-bg" style="flex:1;"><div class="bar-fill" style="width:' + (t.ratio > 0 ? Math.max(6, (t.ratio / max) * 100) : 0) + '%"></div></div>' +
        '<span style="width:132px;flex:none;text-align:right;color:#6b7280;font-size:12.5px;white-space:nowrap;">' + (t.ratio > 0 ? (fmtInt(t.count) + '（' + t.ratio + '%）') : '—') + '</span></div>').join("");
    }

    function blankPreview() {
      // 较上次：无历史对比 → —
      $$(".stat-grid .stat-card .stat-sub").forEach((s) => { s.innerHTML = '较上次 <span style="color:#9ca3af">—</span>'; });
      // 清洗统计：圆环灰、卡片无值
      const donut = $(".keep-donut"); if (donut) donut.style.background = "conic-gradient(#e5e7eb 0% 100%)";
      const dspan = $(".keep-donut span"); if (dspan) dspan.innerHTML = "保留率<br>—";
      $$(".clean-legend .legend-line").forEach((l) => { const s = l.querySelector("span:last-child"); if (s) s.textContent = "—"; });
      $$(".clean-cards .clean-card b").forEach((b) => { b.textContent = "—"; });
      // 前后对比清空
      $$(".compare-box .compare-row").forEach((r) => { const c = r.children; if (c[1]) c[1].textContent = ""; if (c[3]) c[3].textContent = ""; });
      // 质量分析：类别分布画灰色骨架（全部类别，bar 为灰色无红填充）、长度分布清空，完整性归零
      renderCategoryDist([]);
      const q1 = $$(".quality-grid .quality-card")[1];
      if (q1) $$(".len-row", q1).forEach((lr) => { const f = $(".len-fill", lr); if (f) f.style.width = "0%"; if (lr.children[2]) lr.children[2].textContent = "—"; });
      const q2 = $$(".quality-grid .quality-card")[2];
      if (q2) {
        const ic = $$(".integrity-card", q2);
        if (ic[0]) ic[0].querySelector(".integrity-text").innerHTML = '缺失率<b>0.00%</b>缺失值数量<br>0';
        if (ic[1]) ic[1].querySelector(".integrity-text").innerHTML = '重复率<b class="orange">0.00%</b>重复数量<br>0';
        if (ic[2]) ic[2].querySelector(".integrity-text").innerHTML = '可用率<b>0%</b>可用数量<br>0';
      }
    }

    // 初始空白态：先清空清洗/质量区，再加载预览（统计卡由后端返回，空库即 0）
    blankPreview();
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
    let hasData = false;
    const chartPanels = $$(".charts-grid .chart-panel");
    const dfArea = chartPanels[0] && $(".chart-area", chartPanels[0]);
    const idfArea = chartPanels[1] && $(".chart-area", chartPanels[1]);
    // 按需求隐藏 DF/IDF 两张图的纵坐标文本，仅保留网格和图形。
    [dfArea, idfArea].forEach((a) => {
      if (!a) return;
      const yl = $(".ylabels", a); if (yl) yl.style.display = "none";
      const vl = $(".vlabel", a); if (vl) vl.style.display = "none";
    });
    function makeInputEditable(el, key, isNum) {
      el.setAttribute("contenteditable", "true");
      el.style.outline = "none";
      el.addEventListener("input", () => {
        const v = el.textContent.trim();
        params[key] = isNum ? (v.indexOf(".") >= 0 ? parseFloat(v) : parseInt(v, 10)) : v;
      });
    }
    // 步骤指示器：完成数 n，已完成=绿，未完成=红
    function setSteps(n) {
      $$(".steps .step").forEach((s, i) => {
        const done = i < n;
        s.style.color = done ? "#16a34a" : "#dc2626";
        const num = $(".num", s);
        if (num) { num.style.background = done ? "#16a34a" : "#fde8e8"; num.style.color = done ? "#fff" : "#dc2626"; num.style.border = done ? "none" : "1px solid #f3a0a4"; num.style.boxShadow = "none"; }
      });
      $$(".steps .step-line").forEach((ln, i) => { ln.style.background = i < n - 1 ? "#86e0a3" : "#f0caca"; });
    }
    function bottomItems() { const w = $(".bottom-bar .status-items"); return w ? Array.from(w.children) : []; }
    function setBottomDataset(name) {
      const items = bottomItems();
      if (items[0]) {
        const dot = $(".red-dot", items[0]);
        let tn = null; items[0].childNodes.forEach((nd) => { if (nd.nodeType === 3 && nd.textContent.trim()) tn = nd; });
        const label = name || "—";
        if (tn) tn.textContent = label; else items[0].appendChild(document.createTextNode(label));
        if (dot) dot.style.background = name ? "#16a34a" : "#dc2626";
      }
    }
    function setFeatureStatus(done) {
      const items = bottomItems();
      if (items[1]) { const gc = $(".green-check", items[1]); if (gc) { gc.textContent = done ? "✓ 已完成" : "● 未提取"; gc.style.color = done ? "#16a34a" : "#dc2626"; } }
      if (items[2]) items[2].textContent = "最后更新：　　" + new Date().toLocaleString("zh-CN");
    }
    function fmtY(v) { v = Math.round(v); if (v >= 1000) { const k = v / 1000; return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")) + "k"; } return String(v); }
    function setYLabels(area, max) {
      [".y1", ".y2", ".y3", ".y4", ".y5", ".y6"].forEach((cls, i) => {
        const el = $(cls, area); if (!el) return;
        el.textContent = fmtY(max * (1 - i / 5));   // 顶部=max，底部=0（与柱/线方向一致）
        el.style.color = "#4b5565";
      });
    }
    function clearCharts() {
      if (dfArea) { const svg = $(".line-svg", dfArea); if (svg) { $$("path", svg).forEach((p) => p.setAttribute("d", "")); $$("circle", svg).forEach((c) => c.remove()); } }
      if (idfArea) { const bars = $(".bar-chart", idfArea); if (bars) $$(".bar", bars).forEach((b) => (b.style.height = "0%")); }
      [dfArea, idfArea].forEach((a) => { if (a) $$(".ylabels span", a).forEach((s) => (s.style.color = "#cbd5e1")); });
    }
    function drawDF(dist) {
      if (!dfArea || !dist || !dist.length) return;
      const svg = $(".line-svg", dfArea); if (!svg) return;
      const max = Math.max.apply(null, dist.map((d) => d.count).concat([1]));
      const n = dist.length, W = 560, H = 198, top = 10;
      const pts = dist.map((d, i) => [n === 1 ? 0 : (i / (n - 1)) * W, H - (d.count / max) * (H - top)]);
      const line = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
      const paths = $$("path", svg);
      if (paths[0]) paths[0].setAttribute("d", line + ` L${W} ${H} L0 ${H} Z`);
      if (paths[1]) paths[1].setAttribute("d", line);
      $$("circle", svg).forEach((c) => c.remove());
      const g = $("g", svg);
      if (g) pts.forEach((p) => { const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]); c.setAttribute("r", "2"); g.appendChild(c); });
      setYLabels(dfArea, max);
    }
    function drawIDF(hist) {
      if (!idfArea || !hist || !hist.length) return;
      const bars = $(".bar-chart", idfArea);
      const max = Math.max.apply(null, hist.map((h) => h.count).concat([1]));
      if (bars) bars.innerHTML = hist.map((h) => '<div class="bar" style="height:' + Math.max(2, (h.count / max) * 100) + '%"></div>').join("");
      setYLabels(idfArea, max);
      const xn = $(".xnums", idfArea); if (xn) xn.innerHTML = hist.map((h) => "<span>" + (Math.round(h.bin * 10) / 10) + "</span>").join("");
    }
    function blankFeatures() {
      $$(".feature-cards .feature-card .value").forEach((v) => (v.textContent = "—"));
      $$(".stats-table tbody tr").forEach((row) => { if (row.children[1]) row.children[1].textContent = "—"; if (row.children[2]) row.children[2].textContent = "—"; });
      const kw = $(".keyword-table tbody"); if (kw) kw.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:14px;">提取后显示高权重特征</td></tr>';
      const donut = $(".big-donut"); if (donut) donut.style.background = "conic-gradient(#e5e7eb 0% 100%)";
      $$(".donut-legend .legend-line span:last-child").forEach((s) => { s.innerHTML = s.innerHTML.replace(/<br>[\s\S]*/, "<br>—"); });
      const dtotal = $(".donut-total span:last-child"); if (dtotal) dtotal.textContent = "—";
      clearCharts();
      setFeatureStatus(false);
    }
    try {
      const cfg = await api("/api/tfidf/config");
      params = Object.assign({}, cfg.params);
      help = cfg.param_help || {};
      hasData = !!cfg.has_data;
      // 当前数据集（空库 → —）
      const drows = $$(".dataset-table .dataset-row b");
      if (drows[0]) drows[0].textContent = cfg.dataset.name || "—";
      if (drows[1]) drows[1].textContent = hasData ? fmtInt(cfg.dataset.train_count) + " 条" : "—";
      if (drows[2]) drows[2].textContent = hasData ? fmtInt(cfg.dataset.test_count) + " 条" : "—";
      if (drows[3]) drows[3].textContent = hasData ? cfg.dataset.num_classes + " 类" : "—";
      setBottomDataset(cfg.dataset.name);
      setSteps(hasData ? 1 : 0);
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
        else if (sw) { makeSwitch(sw, !!params[key], (v) => { params[key] = v; }); }
      });
    } catch (e) { toast(e.message, "error"); }

    // 初始空白：卡片/统计/图表无值，状态为"未提取"，时间为当前
    blankFeatures();

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
      // 图表（提取后才绘制）+ 步骤全部完成 + 底部状态/时间
      drawDF(d.df_distribution);
      drawIDF(d.idf_histogram);
      setSteps(3);
      setFeatureStatus(true);
      refreshIcons();
    }

    const extractBtn = $(".param-actions .primary-btn");
    if (extractBtn) {
      extractBtn.style.cursor = "pointer";
      extractBtn.addEventListener("click", async () => {
        if (!hasData) { toast("请先在『数据集管理』上传训练集", "warn"); return; }
        extractBtn.disabled = true; const old = extractBtn.innerHTML; extractBtn.innerHTML = "提取中…";
        setSteps(2);
        try { const d = await postJSON("/api/tfidf/extract", { params }); renderExtract(d); toast("特征提取完成：" + fmtInt(d.overview.train_features) + " 维"); }
        catch (e) { setSteps(hasData ? 1 : 0); toast("提取失败：" + e.message, "error"); }
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
    // —— 候选参数排行榜：表格区域可滚动，分页行固定在模块最底部 ——
    injectPageCss("__opt-css", [
      ".rank{display:flex!important;flex-direction:column!important}",
      ".rank .flexhead{flex:0 0 42px!important}",
      ".rank .__rankscroll{flex:1 1 auto!important;min-height:0!important;max-height:none!important;overflow:auto!important}",
      ".rank .foot{flex:0 0 42px!important;margin-top:0!important}",
    ].join("\n"));
    let objective = "macro_f1";
    let esOn = true;
    let help = {};
    let optAllLogs = [];
    const rankState = { page: 1, pageSize: 7, rows: [] };
    let optRunStartedAt = null;

    function fmtClock(d) {
      return d ? d.toLocaleTimeString("zh-CN", { hour12: false }) : "—";
    }
    function formatDuration(sec) {
      sec = Math.max(0, Math.round(sec || 0));
      return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    }
    function startTimeFromResult(res) {
      if (!res || !res.created_at) return optRunStartedAt;
      const end = new Date(String(res.created_at).replace(" ", "T"));
      if (Number.isNaN(end.getTime())) return optRunStartedAt;
      return new Date(end.getTime() - (Number(res.elapsed) || 0) * 1000);
    }
    function setOptStepper(mode) {
      const steps = $$(".stepper .step");
      const line = $(".stepper .done-line");
      steps.forEach((s, i) => {
        s.classList.remove("done", "current", "pending");
        if (mode === "done") s.classList.add("done");
        else if (mode === "running") s.classList.add(i === 0 ? "current" : "pending");
        else s.classList.add("pending");
      });
      if (line) {
        if (mode === "done") { line.style.width = "auto"; line.style.right = "105px"; }
        else { line.style.width = "0"; line.style.right = "auto"; }
      }
    }

    // 目标单选
    const goals = $$(".goals .goal");
    const objMap = { "Macro-F1": "macro_f1", "Accuracy": "accuracy", "Weighted-F1": "weighted_f1" };
    goals.forEach((g) => { g.style.cursor = "pointer"; g.addEventListener("click", () => { goals.forEach((x) => x.classList.remove("active")); g.classList.add("active"); objective = objMap[g.textContent.trim()] || "macro_f1"; }); });
    // 早停开关
    const esSwitch = $(".config .switch");
    if (esSwitch) { esSwitch.style.cursor = "pointer"; const paint = () => (esSwitch.style.background = esOn ? "#16a34a" : "#cbd5e1"); paint(); esSwitch.addEventListener("click", () => { esOn = !esOn; paint(); }); }
    // 配置项可编辑 + ⓘ 提示（超参直接键盘输入并去掉下拉图标；编码方式单独做成下拉）
    $$(".config .field").forEach((f) => {
      const ctrl = $(".ctrl", f), lab = $("label", f);
      const isEncoding = !!(lab && lab.textContent.indexOf("编码") >= 0);
      if (ctrl && !isEncoding) {
        ctrl.setAttribute("contenteditable", "true"); ctrl.style.outline = "none";
        const chev = ctrl.querySelector("svg"); if (chev) chev.style.display = "none";
      }
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
    // 参数编码方式：做成下拉（正态分布 / 均匀分布 / 对数归一化 / 独热）
    const encField = $$(".config .field").find((f) => { const l = $("label", f); return l && l.textContent.indexOf("编码") >= 0; });
    if (encField) {
      const ectrl = $(".ctrl", encField);
      if (ectrl) customDropdown(ectrl, [
        { key: "正态分布编码", label: "正态分布编码" }, { key: "均匀分布编码", label: "均匀分布编码" },
        { key: "对数归一化编码", label: "对数归一化编码" }, { key: "独热编码", label: "独热编码" },
      ], null, { key: "正态分布编码", label: "正态分布编码" });
    }
    // 去掉"预计剩余"卡（与模型训练一致，只保留真实"已耗时"）
    const _scards = $$(".status-row .scard"); if (_scards[3]) _scards[3].style.display = "none";

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
      if (cards[3]) { setText($(".val", cards[3]), sc.rounds || "—"); const s3 = $(".sub", cards[3]); if (s3) s3.textContent = "进度 100%"; const mp3 = $(".mini-progress i", cards[3]); if (mp3) mp3.style.width = "100%"; }
      if (cards[4]) setText($(".val", cards[4]), sc.best_score);
      if (cards[5]) { const d = cards[5].querySelector("div[style]"); if (d) d.textContent = (sc.best_model_name || "—") + " + TF-IDF"; }

      // 排行榜（仅 朴素贝叶斯 / 逻辑回归）
      if (res.leaderboard) { rankState.rows = res.leaderboard.slice(); rankState.page = 1; renderRankPage(); }

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
      if (tagVal) tagVal.style.display = "none";
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
      clearProxyCurves();
      const proxyStatus = $(".proxy .pstatus span");
      if (proxyStatus) proxyStatus.textContent = "已完成";
      $$(".proxy .progress i").forEach((i) => (i.style.width = "100%"));

      // 步骤完成
      setOptStepper("done");
      const svals = $$(".status-row .scard .sval");
      if (svals[1]) { svals[1].textContent = "已完成"; svals[1].classList.add("g"); }
      if (svals[0]) svals[0].textContent = "已完成";
      if (svals[2] && res.elapsed != null) svals[2].textContent = formatDuration(res.elapsed);
      const started = startTimeFromResult(res);
      const sub = $$(".status-row .scard .ssub")[1];
      if (sub) sub.textContent = "开始于 " + fmtClock(started);

      // 较上次：与上一次优化对比（首次无对比）
      try {
        const prev = JSON.parse(localStorage.getItem("__opt_prev") || "null");
        const cur = { experiments: +sc.experiments || 0, candidate: +sc.candidate_count || 0, best: parseFloat(sc.best_score) || 0 };
        const subs = $$(".stats .stat .sub");
        const setSub = (i, d, digits) => {
          if (!subs[i]) return;
          if (!prev) { subs[i].innerHTML = '较上次 <span style="color:#9ca3af">首次</span>'; return; }
          const up = d >= 0; const txt = (d > 0 ? "+" : "") + (digits ? d.toFixed(digits) : d) + (up ? " ↑" : " ↓");
          subs[i].innerHTML = '较上次 <span class="' + (d === 0 ? "" : "up") + '">' + txt + "</span>";
        };
        setSub(0, prev ? cur.experiments - prev.experiments : 0);
        setSub(2, prev ? cur.candidate - prev.candidate : 0);
        setSub(4, prev ? cur.best - prev.best : 0, 4);
        localStorage.setItem("__opt_prev", JSON.stringify(cur));
      } catch (e) {}

      // 优化日志：由结果合成（查看更多看全部）
      const loglist = $(".loglist");
      if (loglist) {
        const now = new Date(); const ts = () => now.toLocaleTimeString("zh-CN", { hour12: false });
        const cfg = res.config || {};
        optAllLogs = [];
        optAllLogs.push(`优化任务已启动，随机种子：${cfg.random_state != null ? cfg.random_state : "—"}，目标：${res.objective}`);
        optAllLogs.push(`初始参数采样完成，初始 ${cfg.init_samples != null ? cfg.init_samples : "—"} 组`);
        (res.history || []).forEach((h) => optAllLogs.push(`第 ${h.iter} 次评估，当前最优 ${res.objective}=${h.objective}（基线 ${h.baseline}）`));
        optAllLogs.push(`代理网络拟合完成，网络结构 ${res.network_structure || "—"}`);
        optAllLogs.push(`优化完成：最优 ${res.best_model_name}，${res.objective}=${res.best_score}，较基线提升 ${res.improvement}`);
        loglist.innerHTML = optAllLogs.slice(-8).map((m, i) => `<div class="logrow${i === optAllLogs.slice(-8).length - 1 ? " orange" : ""}"><span>${ts()}</span><span>${esc(m)}</span></div>`).join("");
      }
      refreshIcons();
    }

    // 空白态：未运行优化前，所有数据位为空，仅保留坐标轴/网格骨架
    function clearOptCharts() {
      const svg = $(".line-chart .line-svg");
      if (svg) { $$("path", svg).forEach((p) => p.setAttribute("d", "")); const g = $("g", svg); if (g) g.innerHTML = ""; }
      const tagVal = $(".tag-val"); if (tagVal) tagVal.style.display = "none";
      $$(".bar-area .hrow").forEach((row) => { const bar = $(".hbar", row), val = $(".hvalue", row); if (bar) bar.style.width = "0%"; if (val) val.textContent = "0.000"; });
    }
    function clearProxyCurves() {
      $$(".proxy .spark2").forEach((row) => {
        const b = $("b", row); if (b) b.textContent = "";
        const path = $("path", row); if (path) path.setAttribute("d", "");
      });
    }
    function renderRankPage() {
      const tb = $(".rank table tbody"); if (!tb) return;
      const total = rankState.rows.length;
      const pages = Math.max(1, Math.ceil(total / rankState.pageSize));
      rankState.page = Math.min(Math.max(1, rankState.page), pages);
      if (!total) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:18px">点击「开始优化」后显示候选参数排行</td></tr>';
      } else {
        const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
        const start = (rankState.page - 1) * rankState.pageSize;
        tb.innerHTML = rankState.rows.slice(start, start + rankState.pageSize).map((r) =>
          `<tr><td class="medal">${medals[r.rank] || r.rank}</td><td>${r.model}</td><td>${fmtParams(r.params)}</td>` +
          `<td>${r.predicted != null ? r.predicted : "—"}</td><td style="${r.rank === 1 ? "color:#e11d26;font-weight:900" : ""}">${r.actual}</td>` +
          `<td><span class="status${r.rank === 1 ? "" : " gray"}">${r.status}</span></td></tr>`).join("");
      }
      const foot = $(".rank .foot");
      if (foot) {
        foot.innerHTML = `<span>${rankState.pageSize}条/页</span><span class="rank-prev" style="cursor:pointer">‹</span><span class="page">${rankState.page}</span><span>/ ${pages} 页</span><span class="rank-next" style="cursor:pointer">›</span><span>共 ${total} 条</span><span>前往 <input class="rank-page-input" value="${rankState.page}"> 页</span>`;
        const prev = $(".rank-prev", foot), next = $(".rank-next", foot);
        if (prev) prev.onclick = () => { if (rankState.page > 1) { rankState.page--; renderRankPage(); } };
        if (next) next.onclick = () => { if (rankState.page < pages) { rankState.page++; renderRankPage(); } };
        const input = $(".rank-page-input", foot);
        if (input) {
          const go = () => {
            let v = parseInt(input.value, 10);
            if (isNaN(v)) v = rankState.page;
            rankState.page = Math.min(pages, Math.max(1, v));
            renderRankPage();
          };
          input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } };
          input.onblur = go;
        }
      }
    }
    function blankOptimization() {
      $$(".stats .stat").forEach((card, i) => {
        const v = $(".val", card); if (v) v.textContent = "—";
        const big = card.querySelector("div[style]"); if (big && !v) big.textContent = "—";
        const sub = $(".sub", card);
        if (sub) {
          if (i === 3) sub.textContent = "进度 —";
          else if (i === 5) sub.textContent = "等待优化";
          else sub.innerHTML = '较上次 <span style="color:#9ca3af">—</span>';
        }
      });
      const mp = $(".stats .mini-progress i"); if (mp) mp.style.width = "0%";
      clearOptCharts();
      rankState.rows = []; rankState.page = 1; renderRankPage();
      $$(".recommend .plist b").forEach((b) => (b.textContent = "—"));
      const netLine = $(".proxy .pcard div[style]"); if (netLine) netLine.textContent = "—";
      $$(".proxy .progress i").forEach((i) => (i.style.width = "0%"));
      clearProxyCurves();
      const pst = $(".proxy .pstatus span"); if (pst) pst.textContent = "未开始";
      setOptStepper("blank");
      const svals = $$(".status-row .scard .sval");
      if (svals[0]) svals[0].textContent = "未开始";
      if (svals[1]) { svals[1].textContent = "待运行"; svals[1].classList.remove("g"); }
      if (svals[2]) svals[2].textContent = "—";
      const sub = $$(".status-row .scard .ssub")[1]; if (sub) sub.textContent = "开始于 —";
      const loglist = $(".loglist"); if (loglist) loglist.innerHTML = '<div class="logrow"><span>—</span><span>运行「开始优化」后显示优化日志</span></div>';
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
      if (res.has_result) render(res); else blankOptimization();
    } catch (e) { blankOptimization(); }

    const runBtn = $(".config .actions .btn.primary");
    if (runBtn) {
      runBtn.style.cursor = "pointer";
      runBtn.addEventListener("click", async () => {
        optRunStartedAt = new Date();
        runBtn.disabled = true; const old = runBtn.innerHTML; runBtn.innerHTML = "优化中…（请稍候）";
        setOptStepper("running");
        const svals = $$(".status-row .scard .sval");
        if (svals[0]) svals[0].textContent = "参数采样";
        if (svals[1]) { svals[1].textContent = "运行中"; svals[1].classList.add("g"); }
        if (svals[2]) svals[2].textContent = "00:00";
        const sub = $$(".status-row .scard .ssub")[1]; if (sub) sub.textContent = "开始于 " + fmtClock(optRunStartedAt);
        try { const res = await postJSON("/api/optimization/run", { config: collectConfig() }); render(res); toast("优化完成：最优 " + res.best_model_name + " " + res.objective + "=" + res.best_score, "info"); }
        catch (e) { toast("优化失败：" + e.message, "error"); }
        finally { runBtn.disabled = false; runBtn.innerHTML = old; refreshIcons(); }
      });
    }
    const resetBtn = $(".config .actions .btn.ghost");
    if (resetBtn) resetBtn.addEventListener("click", () => location.reload());
    const rankRefresh = $(".rank .mini");
    if (rankRefresh) rankRefresh.addEventListener("click", async () => { try { const res = await api("/api/optimization/result"); if (res.has_result) render(res); else { blankOptimization(); toast("暂无优化结果", "warn"); } } catch (e) {} });

    // 候选参数排行榜：套一层滚动容器（显示前 7 条，可滚动）
    const rankTable = $(".rank table");
    if (rankTable && rankTable.parentElement && !rankTable.parentElement.classList.contains("__rankscroll")) {
      const w = document.createElement("div"); w.className = "__rankscroll";
      rankTable.parentNode.insertBefore(w, rankTable); w.appendChild(rankTable);
    }

    // 优化日志「查看更多」：弹窗看全部
    const moreLog = $(".log .loghead span");
    if (moreLog) {
      moreLog.style.cursor = "pointer";
      moreLog.addEventListener("click", () => {
        if (!optAllLogs.length) { toast("暂无日志，请先开始优化", "warn"); return; }
        const html = '<div style="max-height:60vh;overflow:auto;font-size:13px;line-height:1.9;color:#374151">' +
          optAllLogs.map((m, i) => `<div style="display:flex;gap:10px;padding:3px 0;border-bottom:1px solid #f3f4f6"><span style="color:#9ca3af;flex:none">${String(i + 1).padStart(2, "0")}</span><span>${esc(m)}</span></div>`).join("") + "</div>";
        modal("优化日志（全部 " + optAllLogs.length + " 条）", html, { width: "640px" });
      });
    }

    // 快捷操作
    $$(".quick .qcard").forEach((q) => {
      q.style.cursor = "pointer";
      const t = q.textContent;
      q.addEventListener("click", async () => {
        if (t.indexOf("模型评价") >= 0) location.href = "/evaluation.html";
        else if (t.indexOf("导出") >= 0) location.href = "/reports.html";
        else if (t.indexOf("保存") >= 0) {
          try {
            const r = await api("/api/optimization/result");
            if (!r.has_result) { toast("暂无可保存的优化结果，请先开始优化", "warn"); return; }
            const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = "optimization_record_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "") + ".json";
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
            toast("优化记录已保存到本地（JSON）");
          } catch (e) { toast("保存失败：" + e.message, "error"); }
        }
        else if (t.indexOf("最优结果") >= 0) { const el = $(".recommend"); if (el) el.scrollIntoView({ behavior: "smooth" }); }
      });
    });
    refreshIcons();
  }

  /* ----------------- 模型评价与可视化 ----------------- */
  async function initEvaluation() {
    let d;
    try { d = await api("/api/evaluation"); } catch (e) { toast(e.message, "error"); return; }

    // —— 强制布局（即使 HTML 被还原也生效）——
    injectPageCss("__eval-css", [
      ".content{overflow:auto!important}",
      ".middle-grid{grid-template-columns:minmax(0,1fr) 520px!important;height:664px!important;margin-bottom:14px!important}",
      ".compare-panel .tabs{height:50px!important;gap:8px!important}",
      ".compare-panel .tab{width:128px!important;cursor:pointer}",
      ".compare-panel .select-box{display:none!important}",
      ".compare-panel .chart-head{height:46px!important}",
      ".compare-panel .chart-note{display:none!important}",
      ".compare-panel .bar-chart{height:556px!important;background:none!important}",
      ".compare-panel .chart-head h3{margin-top:-6px!important}",
      ".compare-panel .axis-title{top:6px!important;left:2px!important}",
      ".compare-panel .bars{height:455px!important;bottom:55px!important;background:repeating-linear-gradient(to top,transparent 0 90px,#edf0f4 90px 91px)!important}",
      ".compare-panel .y-axis{height:455px!important;top:auto!important;bottom:55px!important}",
      ".compare-panel .y-axis .y0{bottom:-7px!important}.compare-panel .y-axis .y20{bottom:84px!important}.compare-panel .y-axis .y40{bottom:175px!important}",
      ".compare-panel .y-axis .y60{bottom:266px!important}.compare-panel .y-axis .y80{bottom:357px!important}.compare-panel .y-axis .y100{bottom:448px!important}",
      ".compare-panel .xlabels{bottom:26px!important}",
      ".lower-grid{display:none!important}",
      ".indicator-panel .indicator-list{height:300px!important}",
      ".indicator-panel .eval-report-host{margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff}",
      ".indicator-panel .eval-report-host .report-table{width:100%;border-collapse:collapse}",
      ".indicator-panel .eval-report-host .report-table th,.indicator-panel .eval-report-host .report-table td{text-align:center!important;padding-left:0!important}",
      ".indicator-panel .eval-report-host .report-table thead,.indicator-panel .eval-report-host .report-table tbody tr{display:table;width:100%;table-layout:fixed}",
      ".indicator-panel .eval-report-host .report-table tbody{display:block;max-height:236px;overflow:auto}",
      ".report-note{display:none!important}",
      ".conclusion{height:116px!important}",
    ].join("\n"));
    // 仅保留 4 个可切换标签：数据集分布 / 模型对比 / F1-score / 混淆矩阵
    const tabsBox = $(".compare-panel .tabs");
    if (tabsBox) tabsBox.innerHTML = ["数据集分布", "模型对比", "F1-score", "混淆矩阵"]
      .map((t, i) => `<div class="tab${i === 1 ? " active" : ""}">${t}</div>`).join("");

    const reportPanel = $$(".lower-grid .small-panel")[2];
    const indicator = $(".indicator-panel .indicator-list");
    const reportTable = reportPanel && $(".report-table", reportPanel);
    if (indicator && reportTable && !$(".eval-report-host", indicator.parentElement)) {
      const host = document.createElement("div");
      host.className = "eval-report-host";
      host.innerHTML = '<div style="height:38px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:14px;font-weight:900;color:#111827"><span>分类报告摘要</span></div>';
      host.appendChild(reportTable);
      indicator.parentElement.appendChild(host);
    }

    function blankEvaluation() {
      $$(".stat-grid .stat-card").forEach((card) => {
        const v = $(".stat-value", card), sub = $(".stat-sub", card);
        if (v) v.textContent = "0";
        if (sub) sub.textContent = "较上次 0";
      });
      $$(".compare-panel .bar").forEach((b) => { b.style.height = "0%"; const em = $("em", b); if (em) em.textContent = ""; });
      const rt = $(".report-table tbody");
      if (rt) rt.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:18px">训练完成后显示分类报告</td></tr>';
      $$(".conclusion .summary-item p").forEach((p) => (p.innerHTML = "<b>API 被调用后将给出结论</b>"));
    }
    if (!d.trained) { blankEvaluation(); toast(d.message || "尚未训练模型", "warn"); return; }

    // 指标卡片
    const mc = d.metric_cards || {};
    const cards = $$(".stat-grid .stat-card");
    const keyOrder = ["accuracy", "precision", "recall", "f1", "macro_f1", "auc"];
    keyOrder.forEach((k, i) => {
      const card = cards[i]; if (!card || !mc[k]) return;
      setText($(".stat-value", card), fmtPct(mc[k].value));
      const sub = $(".stat-sub", card);
      if (sub) sub.innerHTML = mc[k].delta ? subWithDelta("较上次", mc[k]) : "较上次 0";
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
    function splitChartHTML(titleLeft, titleRight, urlLeft, urlRight) {
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;height:548px;margin-top:6px">` +
        `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;text-align:center"><div style="font-size:14px;font-weight:900;margin-bottom:6px">${titleLeft}</div>${urlLeft ? `<img src="${urlLeft}?t=${Date.now()}" style="max-width:100%;max-height:486px;object-fit:contain">` : '<div style="height:486px;background:#f3f4f6;border-radius:6px"></div>'}</div>` +
        `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;text-align:center"><div style="font-size:14px;font-weight:900;margin-bottom:6px">${titleRight}</div>${urlRight ? `<img src="${urlRight}?t=${Date.now()}" style="max-width:100%;max-height:486px;object-fit:contain">` : '<div style="height:486px;background:#f3f4f6;border-radius:6px"></div>'}</div>` +
        `</div>`;
    }
    tabs.forEach((tab) => {
      tab.style.cursor = "pointer";
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const key = tab.textContent.trim();
        if (key === "模型对比") { if (barChart) barChart.style.display = ""; if (legend) legend.style.display = ""; img.style.display = "none"; img.replaceChildren && img.replaceChildren(); if (h3) h3.textContent = "模型性能对比（越高越好）"; return; }
        if (barChart) barChart.style.display = "none";
        if (legend) legend.style.display = "none";
        img.removeAttribute("src");
        img.outerHTML = '<div class="eval-split-chart"></div>';
        img = $(".eval-split-chart");
        if (key === "数据集分布") img.innerHTML = splitChartHTML("训练集", "测试集", charts.category, charts.category);
        else if (key === "F1-score") img.innerHTML = splitChartHTML("训练集 F1-score", "测试集 F1-score", charts.f1, charts.f1);
        else if (key === "混淆矩阵") img.innerHTML = splitChartHTML("朴素贝叶斯", "逻辑回归", charts.confusion_nb, charts.confusion_lr);
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
    const state = { q: "", true: "", pred: "", model: "", confidence: "", page: 1, page_size: 10, total: 0 };
    let names = [];
    try { const dd = await api("/api/datasets/distribution"); if (dd.label_names && dd.label_names.length) names = dd.label_names; } catch (e) {}

    // —— 强制布局（即使 HTML 被还原也生效）：仅留“错误样本列表”，列表可滚动，去掉导出 ——
    injectPageCss("__errors-css", [
      ".left-panel .data-table-wrap{overflow-x:hidden!important;overflow-y:scroll!important}",
      ".left-panel .data-table thead th{position:sticky;top:0;background:#f8fafc;z-index:2}",
      ".left-panel .filter-btn.red{display:none!important}",
      ".left-panel .footer .pages span,.left-panel .footer .pages .page{cursor:pointer}",
    ].join("\n"));
    $$(".left-panel .tabs .tab").forEach((t, i) => { if (i > 0) t.remove(); });

    // 过滤下拉
    const sels = $$(".left-panel .filter-row .select-box");
    if (sels[0]) customDropdown(sels[0], [{ key: "", label: "全部真实类别" }].concat(names.map((n) => ({ key: n, label: n }))), (k) => { state.true = k; state.page = 1; load(); }, { key: "", label: "全部真实类别" });
    if (sels[1]) customDropdown(sels[1], [{ key: "", label: "全部预测类别" }].concat(names.map((n) => ({ key: n, label: n }))), (k) => { state.pred = k; state.page = 1; load(); }, { key: "", label: "全部预测类别" });
    if (sels[2]) customDropdown(sels[2], [{ key: "", label: "全部模型" }, { key: "朴素贝叶斯", label: "朴素贝叶斯" }, { key: "逻辑回归", label: "逻辑回归" }], (k) => { state.model = k; state.page = 1; load(); }, { key: "", label: "全部模型" });
    if (sels[3]) customDropdown(sels[3], [{ key: "", label: "置信度范围" }, { key: "0-0.5", label: "0 - 0.5" }, { key: "0.5-0.7", label: "0.5 - 0.7" }, { key: "0.7-0.9", label: "0.7 - 0.9" }, { key: "0.9+", label: "0.9 以上" }], (k) => { state.confidence = k; state.page = 1; load(); }, { key: "", label: "置信度范围" });
    const fsearch = $(".left-panel .filter-search");
    if (fsearch) { fsearch.style.cursor = "text"; fsearch.addEventListener("click", () => { state.q = (prompt("搜索错误样本文本：", state.q) || "").trim(); state.page = 1; load(); }); }

    async function load() {
      try {
        const qs = new URLSearchParams({ page: state.page, page_size: state.page_size });
        if (state.q) qs.set("q", state.q);
        if (state.true) qs.set("true", state.true);
        if (state.pred) qs.set("pred", state.pred);
        if (state.model) qs.set("model", state.model);
        if (state.confidence) qs.set("confidence", state.confidence);
        const d = await api("/api/errors?" + qs.toString());
        if (!d.trained) { blankErrors(); toast(d.message || "尚未训练模型", "warn"); return; }
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
            `<tr><td>${(state.page - 1) * state.page_size + i + 1}</td><td class="text">${esc((r.text || "").slice(0, 32))}…</td><td>${r.true_name}</td><td>${r.pred_name}</td>` +
            `<td>${r.confidence}</td><td>${r.model}</td><td>${esc(r.reason)}</td><td class="eye"><svg class="icon sicon"><use href="#i-eye"/></svg></td></tr>`).join("");
        }
        const foot = $(".left-panel .footer > span");
        if (foot) foot.textContent = "共 " + fmtInt(d.total) + " 条";
        state.total = d.total || 0;
        renderErrorPager();
        // 易混淆类别对
        const hbars = $(".chart-panel .hbars");
        if (hbars && d.confusion_pairs) {
          const max = Math.max.apply(null, d.confusion_pairs.map((p) => p.count).concat([1]));
          hbars.innerHTML = d.confusion_pairs.length ? d.confusion_pairs.map((p) =>
            `<div class="hrow"><span>${p.true} ↔ ${p.pred}</span><div class="track"><div class="fill" style="width:${Math.max(6, p.count / max * 100)}%"></div></div><span class="hvalue">${fmtInt(p.count)} (${p.ratio}%)</span></div>`).join("")
            : '<div style="padding:26px;text-align:center;color:#9ca3af">0</div>';
        }
        // 错误原因分布
        const reasons = d.reasons || [];
        const donut = $(".reason-panel .donut");
        const palette = ["#e11d26", "#f97316", "#f59e0b", "#10b981", "#64748b"];
        let acc = 0; const segs = [];
        reasons.forEach((r, i) => { segs.push(`${palette[i % palette.length]} ${acc}% ${acc + r.ratio}%`); acc += r.ratio; });
        if (donut) donut.style.background = segs.length ? `conic-gradient(${segs.join(",")})` : "conic-gradient(#e5e7eb 0 100%)";
        const legendLines = $$(".reason-panel .reason-legend .legend-line");
        reasons.forEach((r, i) => { const ll = legendLines[i]; if (ll) { const dot = $(".ldot", ll); if (dot) dot.style.background = palette[i % palette.length]; ll.children[1].textContent = r.name; ll.children[2].textContent = `${r.ratio}% (${fmtInt(r.count)})`; } });
        for (let i = reasons.length; i < legendLines.length; i++) { legendLines[i].style.display = ""; if (legendLines[i].children[2]) legendLines[i].children[2].textContent = "0% (0)"; }
        // 关键词卡片
        const grid = $(".keyword-grid");
        if (grid && d.keyword_cards) {
          grid.innerHTML = d.keyword_cards.length ? d.keyword_cards.map((c) =>
            `<div class="kcard"><div class="khead"><span class="kicon red"><svg class="icon sicon"><use href="#i-chart"/></svg></span>${c.category}</div>` +
            `<div class="tags">${(c.keywords || []).slice(0, 9).map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div></div>`).join("")
            : '<div style="grid-column:1 / -1;text-align:center;color:#9ca3af;padding:30px">0</div>';
        }
        // 底部模型名
        const ml = $$(".bottom-bar .status-left span")[1];
        if (ml) ml.innerHTML = `当前模型： <span class="green-dot"></span>${d.model_name}（最优模型）`;
        window.__errExport = d.errors;
        refreshIcons();
      } catch (e) { toast(e.message, "error"); }
    }

    function totalErrorPages() { return Math.max(1, Math.ceil((state.total || 0) / state.page_size)); }
    function renderErrorPager() {
      const pages = totalErrorPages();
      state.page = Math.min(Math.max(1, state.page), pages);
      const cont = $(".left-panel .footer .pages");
      if (cont) {
        const win = [];
        for (let i = Math.max(1, state.page - 2); i <= Math.min(pages, state.page + 2); i++) win.push(i);
        cont.innerHTML = `<span class="page-select">${state.page_size}条/页 <svg class="icon sicon"><use href="#i-chevron-down"/></svg></span><span class="err-prev" style="cursor:pointer">‹</span>` +
          win.map((p) => `<span class="error-page-num${p === state.page ? " active" : ""}" data-p="${p}">${p}</span>`).join("") +
          `<span class="err-next" style="cursor:pointer">›</span>`;
        const ps = $(".page-select", cont);
        if (ps) customDropdown(ps, [{ key: "10", label: "10条/页" }, { key: "20", label: "20条/页" }, { key: "30", label: "30条/页" }], (k) => { state.page_size = +k; state.page = 1; load(); }, { key: String(state.page_size), label: state.page_size + "条/页" });
        $$(".error-page-num", cont).forEach((n) => n.addEventListener("click", () => { state.page = +n.dataset.p; load(); }));
        const prev = $(".err-prev", cont), next = $(".err-next", cont);
        if (prev) prev.onclick = () => { if (state.page > 1) { state.page--; load(); } };
        if (next) next.onclick = () => { if (state.page < pages) { state.page++; load(); } };
        refreshIcons();
      }
      const pin = $(".left-panel .footer .page-input");
      if (pin) { pin.textContent = String(state.page); pin.setAttribute("contenteditable", "true"); pin.style.cursor = "text"; pin.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); pin.blur(); } }; pin.onblur = () => { let v = parseInt(pin.textContent, 10); if (isNaN(v)) v = state.page; state.page = Math.min(pages, Math.max(1, v)); load(); }; }
    }

    function blankErrors() {
      $$(".summary-grid .summary-card .value").forEach((v) => (v.textContent = "0"));
      $$(".summary-grid .summary-card .sub").forEach((s) => (s.textContent = "0"));
      const tb = $(".left-panel .data-table tbody");
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:18px">训练模型后显示错误样本</td></tr>';
      const hbars = $(".chart-panel .hbars"); if (hbars) hbars.innerHTML = '<div style="padding:26px;text-align:center;color:#9ca3af">训练模型后显示</div>';
      const grid = $(".keyword-grid"); if (grid) grid.innerHTML = '<div style="grid-column:1 / -1;text-align:center;color:#9ca3af;padding:30px">训练模型后显示</div>';
      const donut = $(".reason-panel .donut"); if (donut) donut.style.background = "conic-gradient(#e5e7eb 0 100%)";
      $$(".reason-panel .reason-legend .legend-line").forEach((ll) => { if (ll.children[2]) ll.children[2].textContent = "0% (0)"; });
      state.total = 0; renderErrorPager();
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
    if (resetBtn) resetBtn.addEventListener("click", () => { state.q = state.true = state.pred = state.model = state.confidence = ""; state.page = 1; load(); });
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
    const pg = { page: 1, size: 10 };

    // —— 列表/版本表滚动、分页样式、运行任务状态色 ——
    injectPageCss("__exp-css", [
      ".records .filters{grid-template-columns:190px 135px 150px 150px 82px 110px!important}",
      ".exp-table{overflow-x:hidden!important;overflow-y:scroll!important}",
      ".exp-table thead th{position:sticky;top:0;background:#f8fafc;z-index:2}",
      ".version-table{max-height:172px!important;overflow-x:hidden!important;overflow-y:auto!important}",
      ".version-table thead th{position:sticky;top:0;background:#fff;z-index:2}",
      ".statusmini.run{background:#dbeafe!important;color:#2b7de9!important}",
      ".records .foot .pagebox span{cursor:pointer}",
      ".records .foot .page-num{min-width:30px;height:30px;border-radius:5px;display:inline-grid;place-items:center;font-weight:900;cursor:pointer;color:#374151}",
      ".records .foot .page-num.active{background:#e60012;color:#fff}",
    ].join("\n"));

    function badgeClass(s) { return s === "已完成" ? "done" : s === "训练中" ? "train" : s === "失败" ? "fail" : "running"; }

    function renderDetail(e) {
      const root = $(".detail");
      if (!root) return;
      if (!e) {
        const exp = $(".expname", root);
        if (exp) exp.innerHTML = '— <span class="tag-ok" style="background:#fee2e2;color:#ef4444">未完成</span>';
        $$(".meta .mrow span", root).forEach((m) => (m.textContent = ""));
        const desc = $(".detail-desc", root); if (desc) desc.innerHTML = "<b>描述</b>　";
        $$(".results .result-card b", root).forEach((b) => (b.textContent = ""));
        const curve = $(".chartbox", root); if (curve) curve.style.display = "none";
        return;
      }
      const curve = $(".chartbox", root); if (curve) curve.style.display = e.status === "已完成" ? "" : "none";
      const expName = $(".expname", root);
      if (expName) {
        const ok = e.status === "已完成";
        expName.innerHTML = `${esc(e.name)} <span class="tag-ok" style="background:${ok ? "#dcfce7" : "#fee2e2"};color:${ok ? "#16a34a" : "#ef4444"}">${esc(e.status || "未完成")}</span>`;
      }
      const mrows = $$(".meta .mrow span", root);
      const meta = [`EXP_${e.id}`, e.dataset || "—", e.model_type, "TF-IDF", e.dataset || "—", "—"];
      mrows.forEach((m, i) => { if (meta[i] != null) m.textContent = meta[i]; });
      const desc = $(".detail-desc", root);
      if (desc) desc.innerHTML = "<b>描述</b>　" + esc(e.description || "（无描述）");
      const rc = $$(".results .result-card b", root);
      if (rc[0]) rc[0].textContent = e.accuracy != null ? fmtPct(e.accuracy) : "";
      if (rc[1]) rc[1].textContent = e.macro_f1 != null ? e.macro_f1.toFixed(3) : "";
      if (rc[2]) rc[2].textContent = "";
      if (rc[3]) rc[3].textContent = e.f1 != null ? e.f1.toFixed(3) : "";
      const rTitle = $$(".results .result-card span", root);
      if (rTitle[1]) rTitle[1].textContent = "Macro-F1";
      if (rTitle[2]) rTitle[2].textContent = "状态";
      if (rc[2]) rc[2].textContent = e.status;
      const vh = $(".version .panel-head h3");
      if (vh) vh.textContent = "模型版本管理";
    }

    function renderTable() {
      const tb = $(".exp-table tbody");
      if (!tb) return;
      let rows = allList.filter((e) =>
        (!filter.q || (e.name || "").indexOf(filter.q) >= 0) &&
        (!filter.status || e.status === filter.status) &&
        (!filter.model || e.model_type === filter.model) &&
        (!filter.dataset
          || (filter.dataset === "训练集" ? /train|训练/i.test(e.dataset || "")
            : filter.dataset === "测试集" ? /test|测试/i.test(e.dataset || "")
              : e.dataset === filter.dataset)));
      const pages = Math.max(1, Math.ceil(rows.length / pg.size));
      pg.page = Math.min(Math.max(1, pg.page), pages);
      if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:18px">暂无实验记录，点击「新建实验」添加</td></tr>`;
      } else {
        const slice = rows.slice((pg.page - 1) * pg.size, pg.page * pg.size);
        tb.innerHTML = slice.map((e) =>
          `<tr data-id="${e.id}"><td>${esc(e.name)}</td><td>${e.model_type}</td><td>${esc(e.dataset || "—")}</td>` +
          `<td>${e.accuracy != null ? fmtPct(e.accuracy) : "--"}</td><td>${e.f1 != null ? e.f1.toFixed(3) : "--"}</td>` +
          `<td><span class="badge ${badgeClass(e.status)}">${e.status}</span></td><td>${e.created_at || "—"}</td>` +
          `<td><div class="ops"><span class="op view"><svg class="icon sicon"><use href="#i-eye"/></svg></span><span class="op"><svg class="icon sicon"><use href="#i-edit"/></svg></span><span class="op red"><svg class="icon sicon"><use href="#i-more"/></svg></span></div></td></tr>`).join("");
        $$("tr", tb).forEach((tr) => { const v = $(".op.view", tr); if (v) v.addEventListener("click", () => { const e = allList.find((x) => x.id == tr.dataset.id); renderDetail(e); $(".detail") && $(".detail").scrollIntoView({ behavior: "smooth" }); }); });
      }
      renderFoot(rows.length, pages);
      refreshIcons();
    }

    function renderFoot(total, pages) {
      const foot = $(".records .foot");
      if (!foot) return;
      const totalSpan = foot.querySelector("span");
      if (totalSpan) totalSpan.textContent = "共 " + total + " 条记录";
      const pagebox = $(".pagebox", foot);
      if (pagebox) {
        const win = [];
        for (let i = Math.max(1, pg.page - 2); i <= Math.min(pages, pg.page + 2); i++) win.push(i);
        pagebox.innerHTML = `<div class="per">${pg.size}条/页 <svg class="icon sicon"><use href="#i-chevron"/></svg></div>` +
          `<span class="exp-prev">‹</span>` + win.map((p) => `<span class="page-num${p === pg.page ? " active" : ""}" data-p="${p}">${p}</span>`).join("") + `<span class="exp-next">›</span>`;
        const per = $(".per", pagebox);
        if (per) customDropdown(per, [{ key: "10", label: "10条/页" }, { key: "20", label: "20条/页" }, { key: "30", label: "30条/页" }], (k) => { pg.size = +k; pg.page = 1; renderTable(); }, { key: String(pg.size), label: pg.size + "条/页" });
        $$(".page-num", pagebox).forEach((n) => n.addEventListener("click", () => { pg.page = +n.dataset.p; renderTable(); }));
        const prev = $(".exp-prev", pagebox), next = $(".exp-next", pagebox);
        if (prev) prev.addEventListener("click", () => { if (pg.page > 1) { pg.page--; renderTable(); } });
        if (next) next.addEventListener("click", () => { if (pg.page < pages) { pg.page++; renderTable(); } });
      }
      const jin = $(".jump input", foot);
      if (jin) { jin.value = pg.page; jin.onchange = () => { let v = parseInt(jin.value, 10); if (isNaN(v)) v = pg.page; pg.page = Math.min(pages, Math.max(1, v)); renderTable(); }; }
      refreshIcons();
    }

    async function load() {
      try { data = await api("/api/experiments"); } catch (e) { toast(e.message, "error"); return; }
      const sc = data.stat_cards, cards = $$(".stats .stat");
      const vals = [sc.total || "0", sc.completed || "0", sc.models_trained || "0", sc.best_accuracy != null ? fmtPct(sc.best_accuracy) : "0", sc.deployed || "0", (sc.storage_mb || 0) + " MB"];
      cards.forEach((c, i) => { if (vals[i] != null) setText($(".val", c), vals[i]); });
      const subs = ["较上次 -", sc.total ? ("占比 " + sc.completed_rate + "%") : "占比 0", "较上次 -", "较上次 -", sc.deployed ? "生产环境运行中" : "未部署", "本地模型存储"];
      cards.forEach((c, i) => { const sub = $(".sub", c); if (sub && subs[i] != null) sub.innerHTML = subs[i]; });
      allList = data.list || [];
      renderTable();
      renderDetail(data.selected);
      // 版本表
      const vtb = $(".version-table tbody");
      if (vtb) vtb.innerHTML = (data.versions || []).length
        ? data.versions.map((v) => `<tr><td>${v.version}</td><td>${v.file}</td><td>${esc(v.description)}</td><td>${v.accuracy != null ? fmtPct(v.accuracy) : "—"}</td><td>—</td><td>${v.created_at}</td><td><div class="ops"><span class="op"><svg class="icon sicon"><use href="#i-download"/></svg></span><span class="op"><svg class="icon sicon"><use href="#i-shield"/></svg></span></div></td></tr>`).join("")
        : `<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:14px">暂无模型版本</td></tr>`;
      // 最近任务：运行中=蓝点、已完成=绿点，并给出运行百分比
      const taskRows = $$(".tasks .task-row");
      const tasks = data.recent_tasks || [];
      if (!tasks.length) {
        if (taskRows[0]) { taskRows[0].style.display = ""; taskRows[0].innerHTML = '<span class="tdot" style="background:#e5e7eb"></span><span style="color:#9ca3af">暂无运行任务</span><span></span><div class="tprogress"><i style="width:0%"></i></div><span></span>'; }
        for (let i = 1; i < taskRows.length; i++) taskRows[i].style.display = "none";
      } else {
        tasks.forEach((t, i) => {
          const row = taskRows[i]; if (!row) return;
          row.style.display = "";
          const running = t.status !== "已完成";
          row.innerHTML = `<span class="tdot${running ? " blue" : ""}"></span><span>实验任务　　${esc(t.name)}</span>` +
            `<span class="statusmini${running ? " run" : ""}">${esc(t.status)}</span>` +
            `<div class="tprogress"><i class="${running ? "blue" : ""}" style="width:${t.progress}%"></i></div><span>${t.progress}%</span>`;
        });
        for (let i = tasks.length; i < taskRows.length; i++) taskRows[i].style.display = "none";
      }
      // 底部状态：当前数据库 / 系统状态 / 最后更新（均取真实值，不写死）
      const fs = $$(".footer-status span");
      if (fs[0]) fs[0].innerHTML = `当前数据库：<i class="${data.current_dataset ? "green-dot" : "red-dot"}"></i>${esc(data.current_dataset || "—")}`;
      if (fs[1]) fs[1].innerHTML = `系统状态：<i class="${data.trained ? "green-dot" : "gray-dot"}"></i><span style="color:${data.trained ? "#16a34a" : "#9ca3af"};font-weight:900">${data.trained ? "运行正常" : "等待训练"}</span>`;
      if (fs[2]) fs[2].innerHTML = `<i class="gray-dot"></i>最后更新：　${esc(data.server_time || new Date().toLocaleString("zh-CN", { hour12: false }))}`;
      refreshIcons();
    }

    // 过滤器（先删除已废弃的「创建时间」下拉，再绑定；即使 HTML 被还原也生效）
    $$(".records .filters .select").forEach((s) => { if (/创建时间/.test(s.textContent)) s.remove(); });
    const sels = $$(".records .filters .select");
    if (sels[0]) customDropdown(sels[0], [{ key: "", label: "全部状态" }, { key: "已完成", label: "已完成" }, { key: "训练中", label: "训练中" }, { key: "失败", label: "失败" }], (k) => { filter.status = k; pg.page = 1; renderTable(); }, { key: "", label: "全部状态" });
    if (sels[1]) customDropdown(sels[1], [{ key: "", label: "全部模型类型" }, { key: "朴素贝叶斯", label: "朴素贝叶斯" }, { key: "逻辑回归", label: "逻辑回归" }], (k) => { filter.model = k; pg.page = 1; renderTable(); }, { key: "", label: "全部模型类型" });
    if (sels[2]) customDropdown(sels[2], [{ key: "", label: "全部数据集" }, { key: "训练集", label: "训练集" }, { key: "测试集", label: "测试集" }], (k) => { filter.dataset = k; pg.page = 1; renderTable(); }, { key: "", label: "全部数据集" });
    const fsearch = $(".records .filters .input");
    if (fsearch) { fsearch.style.cursor = "text"; fsearch.addEventListener("click", () => { filter.q = (prompt("搜索实验名称：", filter.q) || "").trim(); pg.page = 1; renderTable(); }); }
    const refreshBtn = $(".records .smallbtn");
    if (refreshBtn) { refreshBtn.style.cursor = "pointer"; refreshBtn.addEventListener("click", async () => { await load(); toast("已刷新"); }); }

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

    // —— 轻量 Markdown 渲染（在线预览用）——
    function mdToHtml(md) {
      const e2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const inl = (s) => e2(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">$1</code>');
      const lines = md.split("\n"); let html = "", i = 0;
      while (i < lines.length) {
        const ln = lines[i];
        if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1])) {
          const head = ln.trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim()); i += 2; const rows = [];
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim())); i++; }
          html += '<table style="border-collapse:collapse;width:100%;margin:8px 0"><thead><tr>' +
            head.map((h) => `<th style="border:1px solid #e5d0d0;background:#fde8e8;color:#991b1b;padding:6px;font-size:12px">${inl(h)}</th>`).join("") + "</tr></thead><tbody>" +
            rows.map((r) => "<tr>" + r.map((c) => `<td style="border:1px solid #eee;padding:6px;font-size:12px;text-align:center">${inl(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
          continue;
        }
        if (/^#\s+/.test(ln)) { html += `<h1 style="color:#dc2626;font-size:20px;margin:8px 0;border-bottom:2px solid #f3a6aa;padding-bottom:6px">${inl(ln.replace(/^#\s+/, ""))}</h1>`; i++; continue; }
        if (/^##\s+/.test(ln)) { html += `<h2 style="color:#b91c1c;font-size:16px;margin:12px 0 4px">${inl(ln.replace(/^##\s+/, ""))}</h2>`; i++; continue; }
        if (/^###\s+/.test(ln)) { html += `<h3 style="font-size:14px;margin:8px 0 4px">${inl(ln.replace(/^###\s+/, ""))}</h3>`; i++; continue; }
        if (/^>\s?/.test(ln)) { html += `<blockquote style="background:#fff7ed;border-left:4px solid #f97316;padding:8px 12px;color:#9a3412;margin:6px 0">${inl(ln.replace(/^>\s?/, ""))}</blockquote>`; i++; continue; }
        if (/^---+\s*$/.test(ln)) { html += '<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0">'; i++; continue; }
        if (/^[-*]\s+/.test(ln)) { const items = []; while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(inl(lines[i].replace(/^[-*]\s+/, ""))); i++; } html += "<ul style='margin:4px 0 4px 18px'>" + items.map((it) => `<li style="margin:2px 0">${it}</li>`).join("") + "</ul>"; continue; }
        if (ln.trim() === "") { i++; continue; }
        html += `<p style="margin:6px 0;line-height:1.7">${inl(ln)}</p>`; i++;
      }
      return html;
    }

    function collectOpts() {
      const sections = [];
      $$(".check-grid .check-item").forEach((ci) => { if ($(".checkbox", ci).classList.contains("on")) sections.push(ci.textContent.trim()); });
      const scopeEl = $(".radio-row .radio-item .radio.on");
      const scope = scopeEl ? scopeEl.parentElement.textContent.trim() : "全部数据";
      const dcb = $(".other-grid .check-item .checkbox");
      return { template: state.template, sections, scope, format: state.format, paper: state.paper, quality: state.quality, detail_table: dcb ? dcb.classList.contains("on") : true };
    }

    async function showPreview() {
      const m = modal("报告预览（Markdown）", '<div style="color:#6b7280">正在读取后台结果生成预览…</div>', { width: "840px" });
      try {
        const r = await postJSON("/api/reports/preview", collectOpts());
        m.body.innerHTML = `<div style="max-height:64vh;overflow:auto;padding:4px 10px;color:#1f2937">${mdToHtml(r.markdown || "")}</div>`;
      } catch (e) { m.body.innerHTML = `<div style="color:#dc2626">预览失败：${esc(e.message)}</div>`; }
    }

    async function genReport() {
      const btn = $(".action-btns .export-btn"); const old = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.innerHTML = "生成中…（读取后台结果，调用 DeepSeek）"; }
      try {
        const r = await postJSON("/api/reports/generate", collectOpts());
        toast("报告已生成（" + r.format + "），开始下载");
        const a = document.createElement("a"); a.href = r.url; a.download = r.filename || ""; document.body.appendChild(a); a.click(); a.remove();
        const last = $$(".summary-grid .summary-card .value")[5]; if (last) last.textContent = r.generated_at;
      } catch (e) { toast(e.message, "error"); }
      finally { if (btn) { btn.disabled = false; btn.innerHTML = old; refreshIcons(); } }
    }

    let cfg;
    try { cfg = await api("/api/reports/config"); } catch (e) { toast(e.message, "error"); return; }
    const state = { template: (cfg.templates || ["标准分析报告"])[0], format: "PDF", paper: "A4", quality: "300 DPI" };

    // —— 防回退：reports.html 可能被外部还原；用 JS 彻底删除已废弃的选项并修正布局 ——
    injectPageCss("__rep-css", [
      ".format-grid{grid-template-columns:repeat(3,1fr)!important}",
      ".option-body{grid-template-columns:1fr!important;gap:0!important}",
    ].join("\n"));
    // 报告范围：删除「自定义范围」
    $$(".radio-row .radio-item").forEach((it) => { if (/自定义/.test(it.textContent)) it.remove(); });
    // 删除「时间范围」整组（标题 + 日期框）
    $$(".config-body .group-title").forEach((g) => { if (/时间范围/.test(g.textContent)) g.remove(); });
    const _dbox = $(".date-box"); if (_dbox) _dbox.remove();
    // 其他设置：只保留第一项「包含详细数据表格」
    $$(".other-grid .check-item").forEach((ci, i) => { if (i > 0) ci.remove(); });
    // 导出格式：删除 PPT / Excel
    $$(".format-card").forEach((fc) => { if (/PPT|Excel/i.test((($("h4", fc) || {}).textContent || ""))) fc.remove(); });
    // 导出选项：删除左侧单选（完整/简洁/自定义页面范围）与分隔线，仅留页面设置 + 图表质量
    const _ol = $(".option-left"); if (_ol) _ol.remove();
    const _vl = $(".vline"); if (_vl) _vl.remove();

    // 顶部统计卡（未传数据时为 0 / —）
    const sc = cfg.summary_cards, cards = $$(".summary-grid .summary-card");
    const vals = [sc.templates, (sc.data_coverage || 0) + "%", sc.charts, sc.est_pages, sc.est_seconds, sc.last_export || "尚未导出"];
    cards.forEach((c, i) => { if (vals[i] != null) setText($(".value", c), vals[i]); });

    // 模板下拉
    const tmplBox = $(".select-row .select-box");
    if (tmplBox && cfg.templates) customDropdown(tmplBox, cfg.templates.map((t) => ({ key: t, label: t })), (k) => { state.template = k; }, { key: state.template, label: state.template });

    // 报告内容选择（默认勾选来自后端）
    const checks = $$(".check-grid .check-item");
    (cfg.content_sections || []).forEach((s, i) => { const cb = $(".checkbox", checks[i]); if (cb) cb.classList.toggle("on", s.enabled); });
    $$(".check-grid .check-item, .other-grid .check-item").forEach((ci) => { ci.style.cursor = "pointer"; ci.addEventListener("click", () => $(".checkbox", ci).classList.toggle("on")); });

    // 报告范围 / 方向 单选组
    [".radio-row", ".orientation"].forEach((grp) => {
      const items = $$(grp + " .radio-item, " + grp + " .orient");
      items.forEach((it) => { it.style.cursor = "pointer"; it.addEventListener("click", () => { items.forEach((x) => { const r = $(".radio", x); if (r) r.classList.remove("on"); }); const r = $(".radio", it); if (r) r.classList.add("on"); }); });
    });

    // 页面设置 A4/A3/A5 + 图表质量 300/600（reverted HTML 下两个下拉同属 .setting-form）
    const settingSelects = $$(".setting-form .setting-select");
    const paperSel = settingSelects[0];
    if (paperSel && cfg.papers) customDropdown(paperSel, cfg.papers.map((p) => ({ key: p.key, label: p.label })), (k) => { state.paper = k; }, cfg.papers[0]);
    const qSel = settingSelects[1];
    if (qSel && cfg.qualities) customDropdown(qSel, cfg.qualities.map((q) => ({ key: q, label: q })), (k) => { state.quality = k; }, { key: cfg.qualities[0], label: cfg.qualities[0] });

    // API 配置
    renderApi(cfg.api);
    const apiInput = $(".api-input");
    if (apiInput) { apiInput.style.cursor = "pointer"; apiInput.addEventListener("click", openApiModal); }

    // 导出格式（Markdown→PDF/Word/HTML）
    const fcards = $$(".format-card");
    fcards.forEach((fc) => { fc.style.cursor = "pointer"; fc.addEventListener("click", () => { fcards.forEach((x) => x.classList.remove("active")); fc.classList.add("active"); state.format = (($("h4", fc) || {}).textContent || "PDF").trim(); }); });

    // 底部状态（真实值，不写死）
    const bs = $$(".bottom-bar .status-left > span");
    if (bs[0]) bs[0].innerHTML = `当前数据集： <span class="${cfg.current_dataset ? "green-dot" : "red-dot"}"></span>${esc(cfg.current_dataset || "—")}`;
    if (bs[1]) bs[1].innerHTML = `模型状态： <span class="${cfg.trained ? "green-dot" : "red-dot"}"></span><span class="${cfg.trained ? "green-text" : ""}"${cfg.trained ? "" : ' style="color:#9ca3af;font-weight:900"'}>${cfg.trained ? "运行正常" : "未训练"}</span>`;
    if (bs[2]) bs[2].textContent = "最后更新：　" + (cfg.server_time || new Date().toLocaleString("zh-CN", { hour12: false }));

    // 按钮：预览模板 / 预览报告 = 在线看 Markdown；生成并导出 = 下载；保存配置
    const exportBtn = $(".action-btns .export-btn");
    if (exportBtn) exportBtn.addEventListener("click", genReport);
    const previewReportBtn = $$(".action-btns .small-btn")[1];
    if (previewReportBtn) previewReportBtn.addEventListener("click", showPreview);
    const tmplPreview = $(".preview-btn");
    if (tmplPreview) tmplPreview.addEventListener("click", showPreview);
    const saveBtn = $$(".action-btns .small-btn")[0];
    if (saveBtn) saveBtn.addEventListener("click", () => { try { localStorage.setItem("report_cfg", JSON.stringify(collectOpts())); } catch (e) { } toast("报告配置已保存"); });
    refreshIcons();
  }

  /* ----------------- 启动 ----------------- */
  function boot() {
    injectCommonCss();
    normalizeTopbar();
    wireNav();
    wireSearch();
    wireTopStatus();
    wireBell();
    wireUserMenu();
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
