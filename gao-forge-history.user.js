// ==UserScript==
// @name         Gun Art Online Forge History
// @namespace    gunart-forge
// @version      1.0.0
// @description  鍛造歷史與期望值面板：本地記錄每次鍛造／強化結果，統計成功率與材料消耗，支援 CSV 匯出。Standalone — 不含主題、不含分類器。
// @author       ArcGrove7
// @license      MIT
// @match        https://gunartonline.pages.dev/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* Gun Art Online Forge History
 * ---------------------------------------------------------------------------
 * 實作 UX 提案中的 P0 / UX-01：「鍛造歷史與期望值面板」。
 *
 * 這是一支獨立腳本，可與 gao-eyecare.user.js（護眼主題）與
 * gao-classify.user.js（分類器）併用，也可單獨安裝。三者的全域足跡互不重疊：
 *
 *   | 資源            | 本腳本                                   |
 *   | --------------- | ---------------------------------------- |
 *   | localStorage    | gao_forge_history_v1、gao_forge_ui_v1    |
 *   | window 旗標     | __gaoForgeLoaded、__gaoForgeFetchHook、  |
 *   |                 | __gaoForgeXhrHook                        |
 *   | CSS class / id  | gao-fh-*（自繪 UI，前綴隔離）            |
 *   | 熱鍵            | Alt+3（護眼主題用 Alt+1/2，避開）        |
 *   | fetch / XHR     | 鏈式包裝，永遠呼叫原實作、原封回傳       |
 *
 * 設計原則（對應提案 P1「讓決策留下痕跡」）：遊戲產生了鍛造資料卻沒還給玩家。
 * 本腳本只在「本機」被動側錄鍛造動作的 API 回應，不送出任何額外請求、不修改
 * 遊戲行為、不觸碰任何數值或機率。所有資料留在瀏覽器 localStorage。
 *
 * 相容性備註：遊戲的鍛造動作端點形態未公開，故側錄採「寬鬆比對 + 防禦式解析」：
 * 比對 /api/forge/ 底下的變更型（POST 等）請求，並盡力從回應中辨識結果／材料／
 * 屬性變化；無法辨識的欄位一律保留原始 JSON，絕不丟失資料。若站方端點命名有變，
 * 面板頂端的「偵測」列會顯示已側錄的路徑，方便使用者回報或自行調整 URL_PATTERN。
 */

(() => {
  "use strict";

  // 防止同頁重複載入（即使不小心裝了兩份）。
  if (window.__gaoForgeLoaded) return;
  window.__gaoForgeLoaded = true;

  // ===== 常數 =====
  const HISTORY_KEY = "gao_forge_history_v1";
  const UI_KEY = "gao_forge_ui_v1";
  const MAX_RECORDS = 500;          // 提案 UX-01：本地保存最近 500 筆
  const SAVE_DEBOUNCE = 400;        // ms
  const EQUIPMENT_GET = /\/api\/forge\/equipment\/?(\?|$)/i; // 分類器讀的唯讀清單，排除
  // 變更型鍛造動作：/api/forge/ 底下、非 equipment 清單的路徑。
  const FORGE_ACTION = /\/api\/forge\/(?!equipment(\/|\?|$))[^?]*/i;

  // ===== 狀態 =====
  /** @type {Array<Object>} 由舊到新 */
  let history = loadHistory();
  let ui = loadUi();
  let saveTimer = null;
  const seenPaths = new Set(); // 偵測到的鍛造端點路徑（供「偵測」列顯示）

  // ===== 儲存 =====
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function loadUi() {
    const def = { open: false, x: null, y: null, showRaw: false };
    try {
      const raw = localStorage.getItem(UI_KEY);
      return raw ? Object.assign(def, JSON.parse(raw)) : def;
    } catch (e) {
      return def;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, SAVE_DEBOUNCE);
  }

  function persist() {
    saveTimer = null;
    try {
      // 只保存最近 MAX_RECORDS 筆。
      if (history.length > MAX_RECORDS) history = history.slice(-MAX_RECORDS);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      // 配額爆掉時砍半重試一次。
      try {
        history = history.slice(-Math.floor(MAX_RECORDS / 2));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch (e2) {}
    }
  }

  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) {}
  }

  // ===== 防禦式解析 =====
  // 遊戲鍛造回應的欄位命名未公開，這裡以常見別名寬鬆比對；辨識不到就留 null，
  // 原始 JSON 一律保留在 record.raw 中，不丟資料。
  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
  }

  function deepFind(obj, keys, depth) {
    if (obj == null || depth < 0) return undefined;
    if (typeof obj === "object") {
      const direct = pick(obj, keys);
      if (direct !== undefined) return direct;
      const vals = Array.isArray(obj) ? obj : Object.values(obj);
      for (const v of vals) {
        const found = deepFind(v, keys, depth - 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  // 由回應／請求盡力判斷成功與否，回傳 true / false / null（未知）。
  function detectOutcome(res, req) {
    const flag = deepFind(res, ["success", "is_success", "succeeded", "ok"], 3);
    if (typeof flag === "boolean") return flag;
    const result = deepFind(res, ["result", "status", "outcome", "message"], 3);
    if (typeof result === "string") {
      if (/成功|success|upgraded|enhanced/i.test(result)) return true;
      if (/失敗|fail|error|broke|destroyed/i.test(result)) return false;
    }
    // 強化等級提升也算成功訊號。
    const before = deepFind(res, ["before"], 2);
    const after = deepFind(res, ["after"], 2);
    const bl = deepFind(before, ["level", "enhance", "enhancement", "plus"], 2);
    const al = deepFind(after, ["level", "enhance", "enhancement", "plus"], 2);
    if (Number.isFinite(+bl) && Number.isFinite(+al)) return +al > +bl;
    return null;
  }

  // 盡力抽出材料消耗清單，回傳 [{name, qty}]。
  function detectMaterials(res, req) {
    const src =
      deepFind(res, ["materials", "consumed", "cost", "ingredients", "used_materials"], 3) ||
      deepFind(req, ["materials", "consumed", "cost", "ingredients"], 3);
    const out = [];
    if (Array.isArray(src)) {
      for (const m of src) {
        if (m == null) continue;
        if (typeof m === "object") {
          const name = pick(m, ["name", "material", "item", "id", "type"]);
          const qty = pick(m, ["qty", "quantity", "count", "amount", "num"]);
          out.push({ name: name != null ? String(name) : "?", qty: Number.isFinite(+qty) ? +qty : 1 });
        } else {
          out.push({ name: String(m), qty: 1 });
        }
      }
    } else if (src && typeof src === "object") {
      for (const [name, qty] of Object.entries(src)) {
        out.push({ name: String(name), qty: Number.isFinite(+qty) ? +qty : 1 });
      }
    }
    return out;
  }

  function detectTarget(res, req) {
    const t =
      deepFind(res, ["target", "equipment_slot", "slot", "item_name", "name"], 3) ||
      deepFind(req, ["target", "equipment_slot", "slot", "equipment_id", "id"], 3);
    return t != null ? String(t) : null;
  }

  function buildRecord(url, reqBody, resBody) {
    let req = null;
    let res = resBody;
    try {
      req = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
    } catch (e) {
      req = reqBody != null ? { _raw: String(reqBody) } : null;
    }
    const outcome = detectOutcome(res, req);
    const materials = detectMaterials(res, req);
    const target = detectTarget(res, req);
    let path = url;
    try {
      path = new URL(url, location.origin).pathname;
    } catch (e) {}
    seenPaths.add(path);
    return {
      t: Date.now(),
      path,
      target,
      outcome,               // true / false / null
      materials,             // [{name, qty}]
      raw: safeClone(res),   // 完整回應，供明細與 CSV
    };
  }

  function safeClone(v) {
    try {
      return JSON.parse(JSON.stringify(v));
    } catch (e) {
      return null;
    }
  }

  function record(url, reqBody, resBody) {
    try {
      const rec = buildRecord(url, reqBody, resBody);
      history.push(rec);
      if (history.length > MAX_RECORDS) history.shift();
      scheduleSave();
      if (panelEl && ui.open) renderPanel();
      updateBadge();
    } catch (e) {}
  }

  // ===== fetch 側錄（鏈式包裝）=====
  function installFetchHook() {
    if (window.__gaoForgeFetchHook) return;
    if (typeof window.fetch !== "function") return;
    window.__gaoForgeFetchHook = 1;
    const orig = window.fetch;
    window.fetch = function (input, init) {
      const p = orig.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input && input.url ? String(input.url) : "";
        const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        if (isForgeAction(url, method)) {
          const reqBody = init && init.body ? init.body : null;
          p.then((res) => {
            if (!res || !res.ok) return;
            res.clone().json().then((data) => record(url, reqBody, data)).catch(() => {});
          }).catch(() => {});
        }
      } catch (e) {}
      return p;
    };
  }

  function isForgeAction(url, method) {
    if (!url) return false;
    if (EQUIPMENT_GET.test(url)) return false;         // 唯讀清單，跳過
    if (!FORGE_ACTION.test(url)) return false;
    // 鍛造動作多為 POST/PUT/PATCH，但有些站把動作做成帶參數的 GET。
    // 既然已排除唯讀清單、且路徑落在 /api/forge/ 底下，其餘一律側錄。
    void method;
    return true;
  }

  // ===== XHR 側錄（鏈式包裝）=====
  function installXhrHook() {
    if (window.__gaoForgeXhrHook) return;
    const XHR = window.XMLHttpRequest;
    if (typeof XHR !== "function") return;
    window.__gaoForgeXhrHook = 1;
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__gaoForge = { method: String(method || "GET").toUpperCase(), url: String(url || "") };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      const meta = this.__gaoForge;
      if (meta && isForgeAction(meta.url, meta.method)) {
        this.addEventListener("load", function () {
          try {
            if (this.status < 200 || this.status >= 300) return;
            const text = this.responseText;
            const data = text ? JSON.parse(text) : null;
            record(meta.url, body, data);
          } catch (e) {}
        });
      }
      return send.apply(this, arguments);
    };
  }

  installFetchHook();
  installXhrHook();

  // ===== 統計 =====
  function computeStats() {
    let attempts = history.length;
    let known = 0;
    let success = 0;
    const matTotals = new Map();
    for (const r of history) {
      if (r.outcome === true) { known++; success++; }
      else if (r.outcome === false) { known++; }
      for (const m of r.materials || []) {
        matTotals.set(m.name, (matTotals.get(m.name) || 0) + (m.qty || 0));
      }
    }
    const rate = known > 0 ? success / known : null;
    return { attempts, known, success, rate, matTotals };
  }

  // ===== UI =====
  let panelEl = null;
  let badgeEl = null;

  const STYLE = `
    #gao-fh-badge{position:fixed;right:16px;bottom:16px;z-index:2147483600;
      display:flex;align-items:center;gap:6px;padding:8px 12px;cursor:pointer;
      font:600 12px/1.2 system-ui,sans-serif;border-radius:10px;user-select:none;
      color:var(--text-primary,#eef1f6);background:var(--bg-elevated,#20252e);
      border:1px solid var(--border-default,#3a4450);
      box-shadow:0 4px 14px rgba(0,0,0,.35);transition:transform .1s ease;}
    #gao-fh-badge:hover{transform:translateY(-1px);}
    #gao-fh-badge .gao-fh-dot{width:8px;height:8px;border-radius:50%;
      background:var(--q-legendary,#cdc39d);box-shadow:0 0 6px var(--gold-glow,#b4a26e66);}
    #gao-fh-panel{position:fixed;z-index:2147483601;width:360px;max-width:calc(100vw - 24px);
      max-height:min(78vh,640px);display:flex;flex-direction:column;overflow:hidden;
      font:13px/1.5 system-ui,sans-serif;color:var(--text-primary,#eef1f6);
      background:var(--bg-panel,#181c22);border:1px solid var(--border-default,#3a4450);
      border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);}
    #gao-fh-panel .gao-fh-head{display:flex;align-items:center;gap:8px;padding:10px 12px;
      cursor:move;background:var(--bg-elevated,#20252e);
      border-bottom:1px solid var(--border-soft,#8aa0b82e);}
    #gao-fh-panel .gao-fh-title{font-weight:700;flex:1;letter-spacing:.02em;}
    #gao-fh-panel .gao-fh-x{cursor:pointer;padding:2px 8px;border-radius:6px;
      color:var(--text-tertiary,#98a1ae);}
    #gao-fh-panel .gao-fh-x:hover{background:var(--bg-input,#14171d);color:var(--text-primary,#eef1f6);}
    #gao-fh-panel .gao-fh-body{overflow:auto;padding:12px;}
    .gao-fh-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;}
    .gao-fh-stat{padding:8px 10px;border-radius:8px;background:var(--bg-input,#14171d);
      border:1px solid var(--border-soft,#8aa0b82e);}
    .gao-fh-stat b{display:block;font-size:17px;font-weight:700;line-height:1.3;}
    .gao-fh-stat span{font-size:11px;color:var(--text-tertiary,#98a1ae);}
    .gao-fh-detect{font-size:11px;color:var(--text-tertiary,#98a1ae);
      margin:2px 0 10px;word-break:break-all;}
    .gao-fh-mats{margin:0 0 10px;}
    .gao-fh-mats h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;
      letter-spacing:.06em;color:var(--text-tertiary,#98a1ae);}
    .gao-fh-mats .row{display:flex;justify-content:space-between;padding:1px 0;}
    .gao-fh-list{border-top:1px solid var(--border-soft,#8aa0b82e);}
    .gao-fh-rec{padding:6px 0;border-bottom:1px solid var(--border-faint,#8aa0b81a);
      display:flex;gap:8px;align-items:baseline;}
    .gao-fh-rec time{font-variant-numeric:tabular-nums;color:var(--text-tertiary,#98a1ae);
      font-size:11px;white-space:nowrap;}
    .gao-fh-rec .oc{font-weight:700;white-space:nowrap;}
    .gao-fh-rec .oc.ok{color:var(--lime-400,#90a866);}
    .gao-fh-rec .oc.no{color:var(--red-400,#ac5e67);}
    .gao-fh-rec .oc.unk{color:var(--text-muted,#868e9b);}
    .gao-fh-rec .tg{flex:1;color:var(--text-secondary,#c3cad6);
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .gao-fh-raw{font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;
      word-break:break-all;color:var(--text-tertiary,#98a1ae);
      background:var(--bg-void,#12151a);border-radius:6px;padding:6px;margin-top:4px;}
    .gao-fh-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}
    .gao-fh-btn{cursor:pointer;padding:5px 10px;border-radius:7px;font-size:12px;
      color:var(--text-primary,#eef1f6);background:var(--bg-input,#14171d);
      border:1px solid var(--border-default,#3a4450);}
    .gao-fh-btn:hover{border-color:var(--border-strong,#566372);}
    .gao-fh-empty{color:var(--text-tertiary,#98a1ae);text-align:center;padding:24px 8px;}
  `;

  function injectStyle() {
    if (!document.head || document.getElementById("gao-fh-style")) return;
    const s = document.createElement("style");
    s.id = "gao-fh-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function fmtTime(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function ensureBadge() {
    if (badgeEl || !document.body) return;
    badgeEl = document.createElement("div");
    badgeEl.id = "gao-fh-badge";
    badgeEl.innerHTML = '<span class="gao-fh-dot"></span><span class="gao-fh-badge-txt"></span>';
    badgeEl.title = "鍛造歷史（Alt+3 開關）";
    badgeEl.addEventListener("click", togglePanel);
    document.body.appendChild(badgeEl);
    updateBadge();
  }

  function updateBadge() {
    if (!badgeEl) return;
    const txt = badgeEl.querySelector(".gao-fh-badge-txt");
    if (txt) txt.textContent = `鍛造 ${history.length}`;
  }

  function togglePanel() {
    ui.open = !ui.open;
    saveUi();
    if (ui.open) openPanel();
    else closePanel();
  }

  function openPanel() {
    ensurePanel();
    panelEl.style.display = "flex";
    renderPanel();
  }

  function closePanel() {
    if (panelEl) panelEl.style.display = "none";
  }

  function ensurePanel() {
    if (panelEl || !document.body) return;
    panelEl = document.createElement("div");
    panelEl.id = "gao-fh-panel";
    panelEl.innerHTML =
      '<div class="gao-fh-head">' +
        '<span class="gao-fh-title">鍛造歷史 · FORGE HISTORY</span>' +
        '<span class="gao-fh-x" title="關閉">✕</span>' +
      '</div>' +
      '<div class="gao-fh-body"></div>';
    document.body.appendChild(panelEl);
    panelEl.querySelector(".gao-fh-x").addEventListener("click", togglePanel);
    positionPanel();
    makeDraggable(panelEl, panelEl.querySelector(".gao-fh-head"));
  }

  function positionPanel() {
    if (!panelEl) return;
    if (ui.x != null && ui.y != null) {
      panelEl.style.left = clamp(ui.x, 0, window.innerWidth - 60) + "px";
      panelEl.style.top = clamp(ui.y, 0, window.innerHeight - 40) + "px";
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    } else {
      panelEl.style.right = "16px";
      panelEl.style.bottom = "64px";
      panelEl.style.left = "auto";
      panelEl.style.top = "auto";
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("gao-fh-x")) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const nx = clamp(ox + e.clientX - sx, 0, window.innerWidth - 60);
      const ny = clamp(oy + e.clientY - sy, 0, window.innerHeight - 40);
      el.style.left = nx + "px"; el.style.top = ny + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
      ui.x = nx; ui.y = ny;
    });
    window.addEventListener("mouseup", () => {
      if (dragging) { dragging = false; saveUi(); }
    });
  }

  function renderPanel() {
    if (!panelEl) return;
    const body = panelEl.querySelector(".gao-fh-body");
    if (!body) return;
    const s = computeStats();

    const parts = [];

    // 動作列
    parts.push(
      '<div class="gao-fh-actions">' +
        '<button class="gao-fh-btn" data-act="csv">匯出 CSV</button>' +
        `<button class="gao-fh-btn" data-act="raw">${ui.showRaw ? "隱藏原始" : "顯示原始"}</button>` +
        '<button class="gao-fh-btn" data-act="clear">清除紀錄</button>' +
      '</div>'
    );

    // 彙總
    const rateTxt = s.rate == null ? "—" : (s.rate * 100).toFixed(1) + "%";
    const knownTxt = s.known === 0 ? "（結果未辨識）" : `${s.success}/${s.known} 可辨識`;
    parts.push(
      '<div class="gao-fh-stats">' +
        `<div class="gao-fh-stat"><b>${s.attempts}</b><span>側錄鍛造次數</span></div>` +
        `<div class="gao-fh-stat"><b>${rateTxt}</b><span>成功率 · ${knownTxt}</span></div>` +
      '</div>'
    );

    // 偵測到的端點
    if (seenPaths.size) {
      parts.push(`<div class="gao-fh-detect">偵測端點：${[...seenPaths].map(esc).join("、")}</div>`);
    }

    // 材料總消耗
    if (s.matTotals.size) {
      const rows = [...s.matTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n, q]) => `<div class="row"><span>${esc(n)}</span><span>${q}</span></div>`)
        .join("");
      parts.push(`<div class="gao-fh-mats"><h4>材料總消耗</h4>${rows}</div>`);
    }

    // 紀錄列表（新到舊）
    if (!history.length) {
      parts.push('<div class="gao-fh-empty">尚無紀錄。<br>進行一次鍛造／強化後會自動出現。</div>');
    } else {
      const list = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const r = history[i];
        const oc = r.outcome === true ? '<span class="oc ok">成功</span>'
          : r.outcome === false ? '<span class="oc no">失敗</span>'
          : '<span class="oc unk">—</span>';
        const mats = (r.materials || []).map((m) => `${esc(m.name)}×${m.qty}`).join("、");
        const tgt = r.target ? esc(r.target) : "";
        const detail = [tgt, mats].filter(Boolean).join(" · ");
        let raw = "";
        if (ui.showRaw && r.raw != null) {
          raw = `<div class="gao-fh-raw">${esc(JSON.stringify(r.raw))}</div>`;
        }
        list.push(
          `<div class="gao-fh-rec"><time>${fmtTime(r.t)}</time>${oc}` +
          `<span class="tg">${detail}</span></div>${raw}`
        );
      }
      parts.push(`<div class="gao-fh-list">${list.join("")}</div>`);
    }

    body.innerHTML = parts.join("");
    body.querySelectorAll(".gao-fh-btn").forEach((b) => {
      b.addEventListener("click", () => onAction(b.dataset.act));
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function onAction(act) {
    if (act === "csv") exportCsv();
    else if (act === "raw") { ui.showRaw = !ui.showRaw; saveUi(); renderPanel(); }
    else if (act === "clear") {
      if (confirm("確定要清除所有本地鍛造紀錄嗎？此動作無法復原。")) {
        history = [];
        persist();
        renderPanel();
        updateBadge();
      }
    }
  }

  function exportCsv() {
    const header = ["time", "path", "target", "outcome", "materials", "raw"];
    const lines = [header.join(",")];
    for (const r of history) {
      const outcome = r.outcome === true ? "success" : r.outcome === false ? "fail" : "unknown";
      const mats = (r.materials || []).map((m) => `${m.name}x${m.qty}`).join(" ");
      const row = [
        new Date(r.t).toISOString(),
        r.path || "",
        r.target || "",
        outcome,
        mats,
        r.raw != null ? JSON.stringify(r.raw) : "",
      ].map(csvCell);
      lines.push(row.join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gao-forge-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ===== 啟動 =====
  function boot() {
    injectStyle();
    ensureBadge();
    if (ui.open) openPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // SPA 換頁後徽章可能被清掉，重新確保。鏈式包裝 window.history API。
  // 注意：本腳本的紀錄陣列也叫 history，故此處一律用 window.history 明確取用。
  for (const key of ["pushState", "replaceState"]) {
    const original = window.history[key];
    if (typeof original === "function") {
      window.history[key] = function () {
        const result = original.apply(this, arguments);
        setTimeout(() => { injectStyle(); ensureBadge(); }, 60);
        return result;
      };
    }
  }
  window.addEventListener("popstate", () => setTimeout(() => { injectStyle(); ensureBadge(); }, 60));

  const mo = new MutationObserver(() => {
    if (document.body && !document.getElementById("gao-fh-badge")) {
      badgeEl = null;
      ensureBadge();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 熱鍵 Alt+3（避開護眼主題的 Alt+1/2）。輸入框中不攔截、不 preventDefault。
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || e.key !== "3") return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
    togglePanel();
  });
})();
