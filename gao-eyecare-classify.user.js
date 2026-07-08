// ==UserScript==
// @name         Gun Art Online Eye-Care + Item Classifier
// @namespace    gunart-lowsat-classify
// @version      3.1.0
// @description  Low-saturation eye-care theme + API-driven item classifier (equipment by slot/category/quality read from /api/forge/equipment, materials by attribute, market by slot/category) with a market MAX-quantity button. No polling; event-driven only.
// @author       ArcGrove
// @match        https://gunartonline.pages.dev/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* Changelog
 * 3.1.0 - Equipment classification now works in the game's own native list view too. The list
 *         toggle swaps .igrid grid cells for .listing-row rows (materials are .listing-row.inv-item-lr);
 *         both carry the item id as their React fiber key, so the classifier now reads rows from the
 *         .grid-wrap in either mode and filters by hiding those rows. Removed the earlier coexistence
 *         code that targeted the separate "UI Extension" list (the wrong list).
 * 3.0.0 - Classifier reworked to be API-driven and event-driven (mirrors the "Gun Art Online UI
 *         Extension" architecture). Equipment attributes now come from the game's /api/forge/equipment
 *         response (slot, weapon tags, quality via name_rolls.quality, durability, lock) instead of
 *         scraping cell title/style/classes. The setInterval polling loop is gone; refresh runs on
 *         route changes + a scoped, rAF-debounced MutationObserver. Quality labels are now the game's
 *         real names. Market gains a MAX-quantity button.
 * 2.0.0 - Standalone architecture: equipment classification reads the game's own data
 *         (React Fiber on native .igrid cells + /api/forge/equipment fetch).
 * 1.3.1 - Classification UI labels back to Traditional Chinese (code comments & metadata stay English)
 * 1.3.0 - English localization of UI labels, comments and metadata
 * 1.2.0 - Material (.inv-item-lr) classification by description attribute; inventory/market slot + category axes
 * 1.1.0 - Inventory equipment classification + market weapon-type filter
 * 1.0.0 - Low-saturation eye-care theme
 */

(() => {
  "use strict";

  const ATTR = "data-gao-theme";
  const STORAGE_KEY = "gao-lowsat-enabled";
  const THEME_CLASS = "gao-lowsat";
  const MY_VALUE = "gao-lowsat";               // option value injected into the existing theme <select>
  const MY_LABEL = "Low-Saturation Dark (Eye-Care · WCAG AA)";
  const NATIVE_SELECT = '[data-gao-ext="settings-theme-select"]';

  // ---- Low-saturation eye-care ----
  // Low chroma but a wide "text lightness vs background lightness" gap. Every colour used as text
  // (text-*, q-*, stat-*) measures >=4.5:1 on the brightest background #20252e; lowest is 4.65:1.

  const DARK_LOWSAT_VARS = `
    --bg-void:#12151a; --bg-deep:#181c22; --bg-panel:#181c22; --bg-elevated:#20252e;
    --bg-input:#14171d; --bg-overlay:#12151ae0;
    --border-faint:#8aa0b81a; --border-soft:#8aa0b82e; --border-default:#3a4450;
    --border-strong:#566372; --border-glow:#519a9e4d;
    --text-primary:#eef1f6; --text-secondary:#c3cad6; --text-tertiary:#98a1ae; --text-muted:#868e9b;

    --cyan-50:#d9eaec; --cyan-100:#bcd8dd; --cyan-200:#95c1c8; --cyan-300:#6aa6b2;
    --cyan-400:#4c8a94; --cyan-500:#3f707a; --cyan-600:#2e535a; --cyan-glow:#519a9e4d;
    --red-50:#eedee0; --red-100:#e0c3c6; --red-200:#cd9da1; --red-300:#b9777e;
    --red-400:#ac5e67; --red-500:#84444f; --red-600:#5d3037; --red-glow:#ad606b4d;
    --magenta-300:#c793b7; --magenta-400:#c380a3; --magenta-500:#8a476b; --magenta-glow:#b26a934d;
    --gold-300:#cdc39d; --gold-400:#b4a26e; --gold-500:#98814e; --gold-glow:#b4a26e4d;
    --lime-300:#b3c288; --lime-400:#90a866; --lime-500:#5b743c; --lime-glow:#90a8664d;
    --stat-strength:#c39a80; --stat-constitution:#c98a90; --stat-toughness:#c2b07b;
    --stat-agility:#9fb875; --stat-technique:#78b4c0; --stat-luck:#c4a9d6;
    --q-uncommon:#96afc9; --q-fine:#6aa6b2; --q-superior:#90a866; --q-exquisite:#93c79e;
    --q-rare:#b4a26e; --q-epic:#c39a80; --q-mythic:#c380a3; --q-legendary:#cdc39d;
    --q-divine:#5fb0bd; --q-cursed:#ad7cbe;
    --border-glow:#519a9e4d;
    --glow-cyan: 0 0 8px #519a9e33; --glow-red: 0 0 8px #ad606b33;
    --glow-magenta: 0 0 8px #b26a9333; --glow-gold: 0 0 8px #b4a26e2e; --glow-lime: 0 0 8px #90a8662e;
  `;

  const EXTRA_DARK_CSS = `
    html.${THEME_CLASS} { font-size: 125% !important; }
    html.${THEME_CLASS} body { line-height: 1.6 !important; -webkit-font-smoothing: antialiased; }
  `;

  let enabled = localStorage.getItem(STORAGE_KEY) === "1";
  let styleEl = null;

  function css() {
    return enabled ? `:root { ${DARK_LOWSAT_VARS} } ${EXTRA_DARK_CSS}` : "";
  }

  function applyStyle() {
    if (!document.head) return;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.setAttribute(ATTR, "style");
    }
    styleEl.textContent = css();
    // Always move to the end of <head> so that, when coexisting with other themes, equal-specificity
    // rules resolve in favour of this theme (last one wins).
    document.head.appendChild(styleEl);
    document.documentElement.classList.toggle(THEME_CLASS, enabled);
    console.info(`[GAO low-sat] ${enabled ? "applied" : "disabled"}`);
  }

  function setEnabled(on) {
    enabled = !!on;
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    applyStyle();
    syncSelect();
  }

  // ---- Integrate with the existing "theme" <select> ----
  // Add one option; selecting it applies this theme, selecting anything else yields to the native / other themes.
  function ensureOption(sel) {
    if (!sel.querySelector(`option[value="${MY_VALUE}"]`)) {
      const o = document.createElement("option");
      o.value = MY_VALUE;
      o.textContent = MY_LABEL;
      o.setAttribute("data-gao-lowsat-option", "1");
      sel.appendChild(o);
    }
  }

  function syncSelect() {
    const sel = document.querySelector(NATIVE_SELECT);
    if (!sel) return;
    ensureOption(sel);
    if (enabled && sel.value !== MY_VALUE) sel.value = MY_VALUE;
  }

  function bindSelect() {
    const sel = document.querySelector(NATIVE_SELECT);
    if (!sel) return;
    ensureOption(sel);
    if (!sel.dataset.gaoLowsatBound) {
      sel.dataset.gaoLowsatBound = "1";
      // Read the value on change: our option turns it on, any other option turns it off (let other themes take over).
      sel.addEventListener("change", () => setEnabled(sel.value === MY_VALUE));
    }
    if (enabled) sel.value = MY_VALUE;
  }

  function boot() {
    applyStyle();
    bindSelect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // The settings page is an SPA and the <select> may be re-rendered: use an observer to re-add the
  // option and re-sync the selected value whenever it appears / re-renders.
  const mo = new MutationObserver(() => {
    if (document.querySelector(NATIVE_SELECT)) bindSelect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  for (const key of ["pushState", "replaceState"]) {
    const original = history[key];
    history[key] = function (...args) {
      const result = original.apply(this, args);
      setTimeout(bindSelect, 60);
      return result;
    };
  }
  window.addEventListener("popstate", () => setTimeout(bindSelect, 60));

  // Alt+2 enables low-saturation, Alt+1 disables it (back to native / other themes)
  window.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.key === "2") setEnabled(true);
    if (e.key === "1") setEnabled(false);
  });
})();
/* ============================================================
 * Module 2/2: API-driven item classifier
 * Equipment attributes are read from the game's own /api/forge/equipment response (captured via a
 * fetch hook, with a proactive call when the store is empty), keyed to grid cells by their React
 * Fiber key. No cell title/style/class scraping for data, and no polling: refresh is driven by
 * route changes plus a scoped, rAF-debounced MutationObserver. UI labels are Traditional Chinese.
 * ============================================================ */
(function () {
  'use strict';

  const FILTER_KEY = 'gao_cls_filters_v2';

  // ---------------------------------------------------------------------------
  // Static maps (game data -> Traditional Chinese)
  // ---------------------------------------------------------------------------

  // Quality is derived from the crafted `name_rolls.quality` roll using the game's own quality
  // table (same thresholds the game/forge uses), so labels match what the game shows.
  const QUALITY_TABLE = [
    { name: '傳說', min: 0.984, max: Infinity },
    { name: '神話', min: 0.9648, max: 0.984 },
    { name: '史詩', min: 0.932, max: 0.9648 },
    { name: '完美', min: 0.8784, max: 0.932 },
    { name: '頂級', min: 0.8024, max: 0.8784 },
    { name: '精良', min: 0.7072, max: 0.8024 },
    { name: '高級', min: 0.6, max: 0.7072 },
    { name: '上等', min: 0.4928, max: 0.6 },
    { name: '普通', min: 0.3976, max: 0.4928 },
    { name: '次等', min: 0.3216, max: 0.3976 },
    { name: '劣質', min: 0.268, max: 0.3216 },
    { name: '破爛', min: 0.2344, max: 0.268 },
    { name: '垃圾般', min: 0.216, max: 0.2344 },
    { name: '屎一般', min: -Infinity, max: 0.216 }
  ];
  const QUALITY_ORDER = QUALITY_TABLE.map(function (q) { return q.name; });
  const QUALITY_COLOR_BY_NAME = {
    傳說: 'var(--q-legendary)', 神話: 'var(--q-mythic)', 史詩: 'var(--q-epic)',
    完美: 'var(--q-rare)', 頂級: 'var(--q-rare)', 精良: 'var(--q-superior)',
    高級: 'var(--q-fine)', 上等: 'var(--q-uncommon)', 普通: 'var(--q-common)',
    次等: 'var(--q-poor)', 劣質: 'var(--q-trash)', 破爛: 'var(--q-trash)',
    垃圾般: 'var(--q-shit)', 屎一般: 'var(--q-shit)'
  };
  function qualityNameOfRoll(roll) {
    const r = Number(roll);
    if (!Number.isFinite(r)) return null;
    const row = QUALITY_TABLE.find(function (q) { return r > q.min && r <= q.max; });
    return row ? row.name : null;
  }

  // equipment_slot (English key from the API) -> Traditional Chinese slot label.
  const SLOT_LABEL_BY_KEY = {
    head: '頭部', body: '身體', gloves: '手套', shoes: '鞋子', underwear: '內衣',
    main_hand: '主手', off_hand: '副手', necklace: '項鍊', ring: '戒指', earring: '耳環'
  };
  // Weapon tag (English from the API `tags`) -> Traditional Chinese weapon type.
  const TAG_LABEL_BY_TAG = {
    Katana: '太刀', Sword: '單手劍', Dagger: '短刀', Rapier: '細劍', Axe: '雙手斧',
    GreatSword: '雙手劍', Bow: '弓', Pistol: '手槍', SMG: '衝鋒槍', LMG: '輕機槍',
    Sniper: '狙擊槍', Shield: '盾牌', BareHand: '空手', Universal: '通用', Gun: '通用槍械', Chain: '鎖鏈'
  };

  // Category (top-level) -> slots. `types` are the Chinese labels above and act as classification keys.
  const CATEGORIES = [
    { key: 'weapon', label: '武器', types: ['單手劍', '雙手劍', '太刀', '短刀', '細劍', '雙手斧', '弓', '手槍', '衝鋒槍', '輕機槍', '狙擊槍', '空手', '鎖鏈', '通用', '通用槍械', '主手'] },
    { key: 'shield', label: '盾/副手', types: ['盾牌', '副手'] },
    { key: 'armor', label: '防具', types: ['頭部', '身體', '手部', '腳部', '手套', '鞋子', '帽子', '衣服', '靴子', '內衣'] },
    { key: 'accessory', label: '飾品', types: ['項鍊', '戒指', '耳環', '護符'] },
    { key: 'other', label: '其他', types: ['未分類'] }
  ];
  const KNOWN_TYPES = CATEGORIES.reduce(function (a, c) { return a.concat(c.types); }, []);

  // Material attributes: classify by keywords in a material's name + description.
  const MAT_STATS = [
    { key: 'attack',  label: '攻擊', kw: ['攻擊', '攻守', '攻防', '普攻'] },
    { key: 'defense', label: '防禦', kw: ['防禦', '攻守', '攻防'] },
    { key: 'luck',    label: '幸運', kw: ['幸運'] },
    { key: 'weight',  label: '重量', kw: ['重量', '輕盈', '沉重', '份量', '分量', '質量', '密度', '負重'] }
  ];
  const MAT_STAT_ORDER = MAT_STATS.map(function (s) { return s.key; });
  const MAT_STAT_LABEL = MAT_STATS.reduce(function (a, s) { a[s.key] = s.label; return a; }, {});
  function matStatsOf(text) {
    if (!text) return [];
    const out = [];
    MAT_STATS.forEach(function (s) {
      if (s.kw.some(function (k) { return text.indexOf(k) !== -1; })) out.push(s.key);
    });
    return out;
  }

  // Market listing tag -> Chinese slot (English tag or Chinese type both accepted).
  const MARKET_TAG_LABEL = {
    Katana: '太刀', Sword: '單手劍', Dagger: '短刀', Rapier: '細劍', Axe: '雙手斧',
    GreatSword: '雙手劍', Bow: '弓', Pistol: '手槍', SMG: '衝鋒槍', LMG: '輕機槍', Sniper: '狙擊槍',
    Shield: '盾牌',
    Helmet: '頭部', Head: '頭部', Body: '身體', Armor: '身體', Chest: '身體',
    Gloves: '手套', Hands: '手套', Boots: '鞋子', Feet: '鞋子', Shoes: '鞋子',
    Necklace: '項鍊', Amulet: '項鍊', Ring: '戒指', Earring: '耳環', Earrings: '耳環'
  };
  function resolveMarketPart(text) {
    if (!text) return null;
    text = text.trim();
    if (MARKET_TAG_LABEL[text]) return MARKET_TAG_LABEL[text];
    if (KNOWN_TYPES.indexOf(text) !== -1) return text;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = [
    '.gao-cls-bar { margin: 8px 0 12px; padding: 10px 12px; background: var(--bg-elevated,#20252e); border: 1px solid var(--border-soft,#8aa0b82e); border-radius: 6px; display: flex; flex-direction: column; gap: 8px; font-family: var(--font-mono,monospace); }',
    '.gao-cls-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }',
    '.gao-cls-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--cyan-300,#6aa6b2); }',
    '.gao-cls-count { font-size: 11px; color: var(--text-muted,#868e9b); }',
    '.gao-cls-group { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }',
    '.gao-cls-glabel { font-size: 10px; color: var(--text-muted,#868e9b); letter-spacing: 1px; margin-right: 2px; min-width: 30px; }',
    '.gao-cls-chip { font-family: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid var(--border-strong,#566372); background: none; color: var(--text-secondary,#c3cad6); cursor: pointer; border-radius: 3px; line-height: 1.4; white-space: nowrap; transition: all .12s; }',
    '.gao-cls-chip:hover { border-color: var(--cyan-400,#4c8a94); color: var(--text-primary,#eef1f6); }',
    '.gao-cls-chip[data-active="true"] { background: rgba(0,203,240,.10); border-color: var(--cyan-400,#4c8a94); color: var(--cyan-200,#95c1c8); }',
    '.gao-cls-chip.gao-cls-cat[data-active="true"] { background: rgba(0,203,240,.18); }',
    '.gao-cls-chip small { color: var(--text-muted,#868e9b); margin-left: 4px; font-size: 10px; }',
    '.gao-cls-chip[data-active="true"] small { color: var(--cyan-300,#6aa6b2); }',
    '.gao-cls-reset { font-family: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid var(--red-500,#84444f); background: none; color: var(--red-300,#b9777e); cursor: pointer; border-radius: 3px; }',
    '.gao-cls-reset:hover { background: rgba(172,94,103,.12); }',
    '.gao-cls-hidden-row { display: none !important; }',
    '.gao-cls-matbar { margin: 0 0 var(--s-3,12px); }',
    '.gao-cls-market { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 4px 0 2px; font-family: var(--font-mono,monospace); }',
    '.gao-cls-maxbtn { font-family: var(--font-mono,monospace); font-size: 10px; letter-spacing: 1px; width: 42px; height: 28px; border: 1px solid var(--cyan-400,#4c8a94); background: rgba(0,203,240,.08); color: var(--cyan-200,#95c1c8); cursor: pointer; }',
    '.gao-cls-maxbtn:hover { background: rgba(0,203,240,.16); }'
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);

  // ---------------------------------------------------------------------------
  // Filter state (persisted)
  // ---------------------------------------------------------------------------
  const defFilters = { types: [], quals: [], mat: [], equipped: false, broken: false, worn: false, market: [] };
  function loadFilters() {
    try { return Object.assign({}, defFilters, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')); }
    catch (e) { return Object.assign({}, defFilters); }
  }
  function saveFilters() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch (e) {} }
  const filters = loadFilters();

  // ---------------------------------------------------------------------------
  // API data layer: equipment store fed by the game's own /api/forge/equipment
  // ---------------------------------------------------------------------------
  const equipmentById = new Map();

  function normId(value) {
    const n = Number(value);
    return (Number.isInteger(n) && n > 0) ? n : null;
  }
  // Merge an /api/forge/equipment payload ({ equipment: [...] }) into the store.
  function ingestEquipment(payload) {
    const list = payload && Array.isArray(payload.equipment) ? payload.equipment
      : Array.isArray(payload) ? payload
      : null;
    if (!list) return false;
    let changed = false;
    for (const item of list) {
      const id = normId(item && item.id);
      if (id) { equipmentById.set(id, item); changed = true; }
    }
    return changed;
  }

  // Hook fetch once to capture the equipment response the game itself requests.
  function installFetchHook() {
    if (window.__gaoClsFetchHook) return;
    if (typeof window.fetch !== 'function') return;
    window.__gaoClsFetchHook = 1;
    const orig = window.fetch;
    window.fetch = function () {
      const p = orig.apply(this, arguments);
      try {
        const info = arguments[0];
        const url = typeof info === 'string' ? info : (info && info.url) ? String(info.url) : '';
        if (/\/api\/forge\/equipment\/?(\?|$)/i.test(url)) {
          p.then(function (res) {
            if (!res || !res.ok) return;
            res.clone().json().then(function (data) {
              if (ingestEquipment(data)) scheduleMount();
            }).catch(function () {});
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  }
  installFetchHook();

  // Proactively call the API when the store is empty (e.g. store not yet warmed by the game).
  let equipFetchInFlight = false;
  function ensureEquipmentData() {
    if (equipmentById.size || equipFetchInFlight || typeof window.fetch !== 'function') return;
    equipFetchInFlight = true;
    window.fetch('/api/forge/equipment', { credentials: 'same-origin' })
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .then(function (data) { if (ingestEquipment(data)) scheduleMount(); })
      .catch(function () {})
      .then(function () { equipFetchInFlight = false; });
  }

  // Read the React Fiber attached to a DOM node, and its key (the grid cell's key is the item id).
  function cellItemId(cell) {
    try {
      const key = Object.keys(cell).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
      const fiber = key ? cell[key] : null;
      return fiber ? normId(fiber.key) : null;
    } catch (e) { return null; }
  }

  // Equipment object -> Chinese slot/type. Weapon tags win (太刀/盾牌…); otherwise the slot.
  function typeOfEquipment(eq) {
    if (!eq) return null;
    const tags = Array.isArray(eq.tags) ? eq.tags : [];
    for (const t of tags) { const l = TAG_LABEL_BY_TAG[String(t)]; if (l) return l; }
    const slot = String(eq.equipment_slot || '').trim();
    if (SLOT_LABEL_BY_KEY[slot]) return SLOT_LABEL_BY_KEY[slot];
    return null;
  }

  // ---------------------------------------------------------------------------
  // Equipment classification over the native grid (.igrid) — data from the API store
  // ---------------------------------------------------------------------------
  // An item element is either a grid cell (.cell--filled) or a native list row (.listing-row). Both
  // carry the item id as their React fiber key, so classification comes from the API store either way.
  function parseRow(el) {
    const id = cellItemId(el);
    const eq = id != null ? equipmentById.get(id) : null;
    const type = typeOfEquipment(eq) || '未分類';
    const quality = eq ? qualityNameOfRoll(eq.name_rolls && eq.name_rolls.quality) : null;
    const equipped = el.classList.contains('cell--equipped') || !!(eq && eq.equipped);
    let broken = false, worn = false, hasDur = false;
    if (eq) {
      const dur = Number(eq.durability);
      const max = Number(eq.max_durability != null ? eq.max_durability : eq.durability);
      if (Number.isFinite(dur)) {
        hasDur = true;
        if (dur <= 0) broken = true;
        if (Number.isFinite(max) && dur < max) worn = true;
      }
    }
    return { el: el, type: type, quality: quality, equipped: equipped, broken: broken, worn: worn, hasDur: hasDur };
  }

  function rowMatches(r) {
    if (filters.types.length && filters.types.indexOf(r.type) === -1) return false;
    if (filters.quals.length && (!r.quality || filters.quals.indexOf(r.quality) === -1)) return false;
    if (filters.equipped && !r.equipped) return false;
    if (filters.broken && !r.broken) return false;
    if (filters.worn && !r.worn) return false;
    return true;
  }

  function ensureEquipmentBar() {
    const wraps = document.querySelectorAll('.inv-center .grid-wrap');
    if (!wraps.length) return;
    Array.prototype.forEach.call(wraps, ensureEquipmentBarForWrap);
  }

  // Equipment item elements in whichever display mode is active: grid cells (.igrid > .cell--filled)
  // or the game's native list rows (.listing-row). Material rows are .listing-row.inv-item-lr and are
  // excluded here (the material bar handles those).
  function collectEquipmentRowEls(wrap) {
    const grid = wrap.querySelector('.igrid');
    if (grid) {
      return Array.prototype.filter.call(grid.children, function (c) {
        return c.classList && c.classList.contains('cell') && c.classList.contains('cell--filled');
      });
    }
    return Array.prototype.filter.call(wrap.querySelectorAll('.listing-row'), function (el) {
      return !el.classList.contains('inv-item-lr');
    });
  }

  function ensureEquipmentBarForWrap(wrap) {
    const head = wrap.querySelector('.grid-wrap__head');
    let bar = wrap.querySelector('.gao-cls-bar:not(.gao-cls-matbar)');
    const rowEls = collectEquipmentRowEls(wrap);
    if (!rowEls.length) {
      // Not showing equipment here (e.g. a non-equipment category): drop any stale bar.
      if (bar) bar.remove();
      delete wrap.dataset.gaoClsSig;
      return;
    }
    const rows = rowEls.map(parseRow);

    const typesPresent = [], qualsPresent = [];
    const typeCount = {}, qualCount = {};
    let anyDur = false;
    rows.forEach(function (r) {
      if (typesPresent.indexOf(r.type) === -1) typesPresent.push(r.type);
      typeCount[r.type] = (typeCount[r.type] || 0) + 1;
      if (r.quality) {
        if (qualsPresent.indexOf(r.quality) === -1) qualsPresent.push(r.quality);
        qualCount[r.quality] = (qualCount[r.quality] || 0) + 1;
      }
      if (r.hasDur) anyDur = true;
    });
    const signature = typesPresent.slice().sort().join(',') + '|' + qualsPresent.slice().sort().join(',') + '|' + (anyDur ? 'd' : '');

    const misplaced = bar && head && bar.previousElementSibling !== head;
    if (!bar || misplaced || wrap.dataset.gaoClsSig !== signature) {
      if (bar) bar.remove();
      bar = buildEquipmentBar(typesPresent, qualsPresent, anyDur);
      if (head && head.parentElement) head.parentElement.insertBefore(bar, head.nextSibling);
      else wrap.insertBefore(bar, wrap.firstChild);
      wrap.dataset.gaoClsSig = signature;
    }
    applyEquipmentFilters(bar, rows, typeCount, qualCount);
  }

  function buildEquipmentBar(typesPresent, qualsPresent, anyDur) {
    const bar = document.createElement('div');
    bar.className = 'gao-cls-bar';
    bar.innerHTML =
      '<div class="gao-cls-head">' +
        '<span class="gao-cls-title">裝備分類 · CLASSIFY</span>' +
        '<span class="gao-cls-count" data-gao-cls-count></span>' +
      '</div>';

    // Category
    const catRow = document.createElement('div');
    catRow.className = 'gao-cls-group';
    catRow.innerHTML = '<span class="gao-cls-glabel">類別</span>';
    CATEGORIES.forEach(function (cat) {
      const present = cat.types.filter(function (t) { return typesPresent.indexOf(t) !== -1; });
      if (!present.length) return;
      const chip = mkChip(cat.label);
      chip.classList.add('gao-cls-cat');
      chip.dataset.gaoClsCat = cat.key;
      chip.addEventListener('click', function () {
        const allOn = present.every(function (t) { return filters.types.indexOf(t) !== -1; });
        present.forEach(function (t) {
          const i = filters.types.indexOf(t);
          if (allOn) { if (i !== -1) filters.types.splice(i, 1); }
          else if (i === -1) filters.types.push(t);
        });
        saveFilters(); ensureEquipmentBar();
      });
      catRow.appendChild(chip);
    });
    bar.appendChild(catRow);

    // Slot
    const partRow = document.createElement('div');
    partRow.className = 'gao-cls-group';
    partRow.innerHTML = '<span class="gao-cls-glabel">部位</span>';
    const ordered = [];
    CATEGORIES.forEach(function (c) { c.types.forEach(function (t) { if (typesPresent.indexOf(t) !== -1) ordered.push(t); }); });
    typesPresent.forEach(function (t) { if (ordered.indexOf(t) === -1) ordered.push(t); });
    ordered.forEach(function (t) {
      const chip = mkChip(t);
      chip.dataset.gaoClsType = t;
      chip.addEventListener('click', function () { toggleIn(filters.types, t); saveFilters(); ensureEquipmentBar(); });
      partRow.appendChild(chip);
    });
    bar.appendChild(partRow);

    // Quality (order known names first, then any unknowns)
    if (qualsPresent.length) {
      const qualRow = document.createElement('div');
      qualRow.className = 'gao-cls-group';
      qualRow.innerHTML = '<span class="gao-cls-glabel">品質</span>';
      const orderedQ = QUALITY_ORDER.filter(function (q) { return qualsPresent.indexOf(q) !== -1; });
      qualsPresent.forEach(function (q) { if (orderedQ.indexOf(q) === -1) orderedQ.push(q); });
      orderedQ.forEach(function (q) {
        const chip = mkChip(q);
        chip.dataset.gaoClsQual = q;
        chip.style.color = QUALITY_COLOR_BY_NAME[q] || 'var(--text-secondary)';
        chip.addEventListener('click', function () { toggleIn(filters.quals, q); saveFilters(); ensureEquipmentBar(); });
        qualRow.appendChild(chip);
      });
      bar.appendChild(qualRow);
    }

    // Status: 已裝備 always; 未滿耐久/破損 only when durability data is available.
    const stRow = document.createElement('div');
    stRow.className = 'gao-cls-group';
    stRow.innerHTML = '<span class="gao-cls-glabel">狀態</span>';
    const flags = [['equipped', '已裝備']];
    if (anyDur) { flags.push(['worn', '未滿耐久']); flags.push(['broken', '破損']); }
    flags.forEach(function (pair) {
      const chip = mkChip(pair[1]);
      chip.dataset.gaoClsFlag = pair[0];
      chip.addEventListener('click', function () { filters[pair[0]] = !filters[pair[0]]; saveFilters(); ensureEquipmentBar(); });
      stRow.appendChild(chip);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'gao-cls-reset';
    reset.textContent = '清除篩選';
    reset.addEventListener('click', function () {
      filters.types = []; filters.quals = [];
      filters.equipped = false; filters.broken = false; filters.worn = false;
      saveFilters(); ensureEquipmentBar();
    });
    stRow.appendChild(reset);
    bar.appendChild(stRow);
    return bar;
  }

  function applyEquipmentFilters(bar, rows, typeCount, qualCount) {
    let shown = 0;
    rows.forEach(function (r) {
      const ok = rowMatches(r);
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
      if (ok) shown++;
    });
    if (!bar) return;
    const countEl = bar.querySelector('[data-gao-cls-count]');
    if (countEl) countEl.textContent = '顯示 ' + shown + ' / ' + rows.length + ' 件';
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-type]').forEach(function (chip) {
      const t = chip.dataset.gaoClsType;
      chip.dataset.active = filters.types.indexOf(t) !== -1 ? 'true' : 'false';
      setChipCount(chip, typeCount[t] || 0);
    });
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-cat]').forEach(function (chip) {
      const cat = CATEGORIES.find(function (c) { return c.key === chip.dataset.gaoClsCat; });
      const present = cat ? cat.types.filter(function (t) { return (typeCount[t] || 0) > 0; }) : [];
      const allOn = present.length && present.every(function (t) { return filters.types.indexOf(t) !== -1; });
      chip.dataset.active = allOn ? 'true' : 'false';
    });
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-qual]').forEach(function (chip) {
      const q = chip.dataset.gaoClsQual;
      chip.dataset.active = filters.quals.indexOf(q) !== -1 ? 'true' : 'false';
      setChipCount(chip, qualCount[q] || 0);
    });
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-flag]').forEach(function (chip) {
      chip.dataset.active = filters[chip.dataset.gaoClsFlag] ? 'true' : 'false';
    });
  }

  // ---------------------------------------------------------------------------
  // Material attribute classification (native materials list, .inv-item-lr)
  // ---------------------------------------------------------------------------
  function activeInventoryCategory() {
    const actives = document.querySelectorAll('.inv-main .cat--active');
    for (let i = 0; i < actives.length; i++) {
      const b = actives[i].querySelector('.cat__name b');
      if (b && b.textContent.trim()) return b.textContent.trim();
    }
    return null;
  }

  function ensureMaterialBar() {
    const center = document.querySelector('.inv-center');
    let bar = document.querySelector('.gao-cls-matbar');
    const rowEls = center ? center.querySelectorAll('.inv-item-lr') : [];
    // Only meaningful under the 素材 (materials) category; hide elsewhere (全部/裝備/消耗品…).
    const cat = activeInventoryCategory();
    if (!center || !rowEls.length || (cat && cat !== '素材')) { if (bar) bar.remove(); return; }

    const rows = Array.prototype.map.call(rowEls, function (el) {
      const nameWrap = el.querySelector('.lr__name');
      const text = nameWrap ? nameWrap.textContent : '';
      return { el: el, stats: matStatsOf(text) };
    });

    const statCount = {};
    let noneCount = 0;
    rows.forEach(function (r) {
      if (r.stats.length) r.stats.forEach(function (s) { statCount[s] = (statCount[s] || 0) + 1; });
      else noneCount++;
    });
    const statsPresent = MAT_STAT_ORDER.filter(function (s) { return statCount[s]; });
    if (!statsPresent.length) { if (bar) bar.remove(); return; }

    const sig = statsPresent.join(',') + (noneCount ? '|none' : '');
    if (!bar || bar.dataset.sig !== sig) {
      if (bar) bar.remove();
      bar = document.createElement('div');
      bar.className = 'gao-cls-bar gao-cls-matbar';
      bar.dataset.sig = sig;
      bar.innerHTML =
        '<div class="gao-cls-head">' +
          '<span class="gao-cls-title">素材屬性 · MATERIALS</span>' +
          '<span class="gao-cls-count" data-gao-cls-matcount></span>' +
        '</div>';
      const grp = document.createElement('div');
      grp.className = 'gao-cls-group';
      grp.innerHTML = '<span class="gao-cls-glabel">屬性</span>';
      statsPresent.forEach(function (s) {
        const chip = mkChip(MAT_STAT_LABEL[s]);
        chip.dataset.gaoClsMat = s;
        chip.addEventListener('click', function () { toggleIn(filters.mat, s); saveFilters(); ensureMaterialBar(); });
        grp.appendChild(chip);
      });
      if (noneCount) {
        const chip = mkChip('其他');
        chip.dataset.gaoClsMat = 'none';
        chip.addEventListener('click', function () { toggleIn(filters.mat, 'none'); saveFilters(); ensureMaterialBar(); });
        grp.appendChild(chip);
      }
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gao-cls-reset';
      reset.textContent = '清除';
      reset.addEventListener('click', function () { filters.mat = []; saveFilters(); ensureMaterialBar(); });
      grp.appendChild(reset);
      bar.appendChild(grp);

      const anchor = center.querySelector('.toolbar');
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(bar, anchor.nextSibling);
      else center.insertBefore(bar, center.firstChild);
    }

    const active = filters.mat;
    const wantNone = active.indexOf('none') !== -1;
    let shown = 0;
    rows.forEach(function (r) {
      let ok = true;
      if (active.length) {
        ok = r.stats.some(function (s) { return active.indexOf(s) !== -1; }) || (wantNone && r.stats.length === 0);
      }
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
      if (ok) shown++;
    });
    const countEl = bar.querySelector('[data-gao-cls-matcount]');
    if (countEl) countEl.textContent = '顯示 ' + shown + ' / ' + rows.length + ' 種';
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-mat]').forEach(function (chip) {
      const s = chip.dataset.gaoClsMat;
      chip.dataset.active = active.indexOf(s) !== -1 ? 'true' : 'false';
      setChipCount(chip, s === 'none' ? noneCount : (statCount[s] || 0));
    });
  }

  // ---------------------------------------------------------------------------
  // Market slot / category filter + MAX-quantity button
  // ---------------------------------------------------------------------------
  function ensureMarketBar() {
    const chips = document.querySelector('.market-main .chips');
    const listings = document.querySelector('.market-main .listings');
    if (!chips || !listings) return;

    const rows = Array.prototype.map.call(listings.querySelectorAll('.listing'), function (el) {
      const meta = el.querySelector('.listing__meta') || el;
      let part = null;
      meta.querySelectorAll('span').forEach(function (sp) {
        if (!part) part = resolveMarketPart(sp.textContent);
      });
      if (!part) part = resolveMarketPart((el.getAttribute('title') || '').trim());
      return { el: el, part: part };
    });
    const present = [];
    rows.forEach(function (r) { if (r.part && present.indexOf(r.part) === -1) present.push(r.part); });

    let bar = document.querySelector('.gao-cls-market');
    if (!present.length) { if (bar) bar.remove(); return; }

    const orderedParts = [];
    CATEGORIES.forEach(function (c) { c.types.forEach(function (t) { if (present.indexOf(t) !== -1) orderedParts.push(t); }); });
    present.forEach(function (t) { if (orderedParts.indexOf(t) === -1) orderedParts.push(t); });
    const catsPresent = CATEGORIES.filter(function (c) {
      return c.types.some(function (t) { return present.indexOf(t) !== -1; });
    });

    const sig = orderedParts.join(',');
    if (!bar || bar.dataset.sig !== sig) {
      if (bar) bar.remove();
      bar = document.createElement('div');
      bar.className = 'gao-cls-market';
      bar.dataset.sig = sig;

      const catLabel = document.createElement('span');
      catLabel.className = 'gao-cls-glabel';
      catLabel.textContent = '類別';
      bar.appendChild(catLabel);
      catsPresent.forEach(function (cat) {
        const partsIn = cat.types.filter(function (t) { return present.indexOf(t) !== -1; });
        const chip = mkChip(cat.label);
        chip.classList.add('gao-cls-cat');
        chip.dataset.gaoClsMktCat = cat.key;
        chip.addEventListener('click', function () {
          const allOn = partsIn.every(function (t) { return filters.market.indexOf(t) !== -1; });
          partsIn.forEach(function (t) {
            const i = filters.market.indexOf(t);
            if (allOn) { if (i !== -1) filters.market.splice(i, 1); }
            else if (i === -1) filters.market.push(t);
          });
          saveFilters(); ensureMarketBar();
        });
        bar.appendChild(chip);
      });

      const partLabel = document.createElement('span');
      partLabel.className = 'gao-cls-glabel';
      partLabel.textContent = '部位';
      bar.appendChild(partLabel);
      orderedParts.forEach(function (part) {
        const chip = mkChip(part);
        chip.dataset.gaoClsMkt = part;
        chip.addEventListener('click', function () { toggleIn(filters.market, part); saveFilters(); ensureMarketBar(); });
        bar.appendChild(chip);
      });

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gao-cls-reset';
      reset.textContent = '全部';
      reset.addEventListener('click', function () { filters.market = []; saveFilters(); ensureMarketBar(); });
      bar.appendChild(reset);
      chips.parentElement.insertBefore(bar, chips.nextSibling);
    }

    const active = filters.market;
    rows.forEach(function (r) {
      const ok = !active.length || (r.part && active.indexOf(r.part) !== -1);
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
    });
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-mkt]').forEach(function (chip) {
      chip.dataset.active = active.indexOf(chip.dataset.gaoClsMkt) !== -1 ? 'true' : 'false';
    });
    bar.querySelectorAll('.gao-cls-chip[data-gao-cls-mkt-cat]').forEach(function (chip) {
      const cat = CATEGORIES.find(function (c) { return c.key === chip.dataset.gaoClsMktCat; });
      const partsIn = cat ? cat.types.filter(function (t) { return present.indexOf(t) !== -1; }) : [];
      const allOn = partsIn.length && partsIn.every(function (t) { return active.indexOf(t) !== -1; });
      chip.dataset.active = allOn ? 'true' : 'false';
    });
  }

  // Set a React-controlled input's value so the framework picks up the change.
  function setInputValue(input, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Add a MAX button to the market purchase panel that fills the quantity input with the
  // remaining stock (剩餘庫存：N 件).
  function ensureMarketMaxButton() {
    const detail = document.querySelector('.detail');
    if (!detail || detail.querySelector('[data-gao-cls-max]')) return;
    const m = detail.textContent.match(/剩餘庫存：\s*(\d+)\s*件/);
    const max = m ? Number(m[1]) : 0;
    const input = detail.querySelector('input[inputmode="numeric"], input[type="text"]');
    const plus = Array.prototype.find.call(detail.querySelectorAll('button'), function (b) {
      return b.textContent.trim() === '+';
    });
    if (!max || !input || !plus) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gao-cls-maxbtn';
    button.setAttribute('data-gao-cls-max', '1');
    button.textContent = 'MAX';
    button.title = '填入剩餘庫存數量 (' + max + ')';
    button.addEventListener('click', function () { setInputValue(input, String(max)); });
    plus.insertAdjacentElement('afterend', button);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function mkChip(label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gao-cls-chip';
    b.dataset.active = 'false';
    b.innerHTML = '<span class="gao-cls-chip-label"></span><small></small>';
    b.querySelector('.gao-cls-chip-label').textContent = label;
    return b;
  }
  function setChipCount(chip, n) {
    const s = chip.querySelector('small');
    if (s) s.textContent = n;
  }
  function toggleIn(arr, v) {
    const i = arr.indexOf(v);
    if (i === -1) arr.push(v); else arr.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Routing + scoped observer (event-driven; no polling)
  // ---------------------------------------------------------------------------
  const DEFAULT_OBS = { childList: true, subtree: true };
  const INV_OBS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] };

  let pageObserver = null;
  let currentPath = '';
  let queuedMount = false;
  let queuedRefresh = false;

  function findMainRoot() { return document.querySelector('main.page-main, main'); }

  function refreshInventory() {
    try { ensureEquipmentBar(); } catch (e) { console.error('[GAO classify] equipment', e); }
    try { ensureMaterialBar(); } catch (e) { console.error('[GAO classify] material', e); }
  }
  function refreshMarket() {
    try { ensureMarketBar(); } catch (e) { console.error('[GAO classify] market', e); }
    try { ensureMarketMaxButton(); } catch (e) { console.error('[GAO classify] market-max', e); }
  }

  function disconnectObserver() {
    if (pageObserver) pageObserver.disconnect();
    pageObserver = null;
  }

  function mountObserved(root, refresh, opts) {
    if (!root) { disconnectObserver(); setTimeout(scheduleMount, 80); return; }
    refresh();
    disconnectObserver();
    pageObserver = new MutationObserver(function () { scheduleRefresh(refresh); });
    pageObserver.observe(root, opts || DEFAULT_OBS);
  }

  function scheduleRefresh(refresh) {
    const path = currentPath;
    if (queuedRefresh) return;
    queuedRefresh = true;
    requestAnimationFrame(function () {
      queuedRefresh = false;
      if (location.pathname !== path) return;
      refresh();
    });
  }

  function scheduleMount() {
    if (queuedMount) return;
    queuedMount = true;
    requestAnimationFrame(function () {
      queuedMount = false;
      mountForRoute();
    });
  }

  function mountForRoute() {
    const path = location.pathname;
    if (currentPath !== path) { currentPath = path; disconnectObserver(); }
    if (path.indexOf('/inventory') !== -1) {
      ensureEquipmentData();
      return mountObserved(findMainRoot(), refreshInventory, INV_OBS);
    }
    if (path.indexOf('/market') !== -1) {
      return mountObserved(document.body, refreshMarket, DEFAULT_OBS);
    }
    disconnectObserver();
  }

  function hookRouteChanges() {
    for (const key of ['pushState', 'replaceState']) {
      const original = history[key];
      history[key] = function () {
        const result = original.apply(this, arguments);
        setTimeout(scheduleMount, 80);
        return result;
      };
    }
    window.addEventListener('popstate', function () { setTimeout(scheduleMount, 80); });
  }

  function boot() {
    hookRouteChanges();
    mountForRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
