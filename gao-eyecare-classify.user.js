// ==UserScript==
// @name         Gun Art Online Eye-Care + Item Classifier
// @namespace    gunart-lowsat-classify
// @version      1.3.1
// @description  Low-saturation eye-care theme + inventory/market classification by slot & category, and material classification by attribute (ATK/DEF/LUK/WGT)
// @author       ArcGrove
// @match        https://gunartonline.pages.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Changelog
 * 1.3.1 - Classification UI labels back to Traditional Chinese (code comments & metadata stay English)
 * 1.3.0 - English localization of UI labels, comments and metadata (game item-type strings stay as their in-game text for DOM matching)
 * 1.2.0 - Material (.inv-item-lr) classification by description attribute (attack/defense/luck/weight); inventory/market switched to slot + category axes; removed the mis-guessed "mineral" classification
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
 * Module 2/2: inventory classification + market slot/category filter + material attribute filter
 * ============================================================ */
(function () {
  'use strict';

  const FILTER_KEY = 'gao_cls_filters_v1';

  // Quality colour token -> display label (rarity). UI text is Traditional Chinese.
  const QUALITY_LABEL = {
    poor: '劣質', common: '普通', uncommon: '非凡', fine: '精良', superior: '上等',
    exquisite: '精緻', rare: '稀有', epic: '史詩', mythic: '神話', legendary: '傳說',
    divine: '神聖', cursed: '詛咒'
  };
  const QUALITY_ORDER = ['poor', 'common', 'uncommon', 'fine', 'superior', 'exquisite', 'rare', 'epic', 'mythic', 'legendary', 'divine', 'cursed'];

  // Category (top-level) -> slots (concrete item types).
  // NOTE: the `types` strings are the game's own item-type text; they are compared against the DOM verbatim.
  // The human-facing `label` (and every UI string below) is Traditional Chinese to match the game.
  const CATEGORIES = [
    { key: 'weapon', label: '武器', types: ['單手劍', '雙手劍', '太刀', '短刀', '細劍', '雙手斧', '弓', '手槍', '衝鋒槍', '輕機槍', '狙擊槍', '空手', '鎖鏈', '通用', '通用槍械'] },
    { key: 'shield', label: '盾/副手', types: ['盾牌'] },
    { key: 'armor', label: '防具', types: ['頭部', '身體', '手部', '腳部', '帽子', '衣服', '手套', '鞋子', '靴子'] },
    { key: 'accessory', label: '飾品', types: ['項鍊', '戒指', '耳環', '護符'] },
    { key: 'other', label: '其他', types: ['未分類'] }
  ];
  function bigCategoryOf(type) {
    for (const c of CATEGORIES) if (c.types.indexOf(type) !== -1) return c.key;
    return 'other';
  }
  // All known slots (Chinese) -- lets the market match a Chinese type string directly.
  const KNOWN_TYPES = CATEGORIES.reduce(function (a, c) { return a.concat(c.types); }, []);

  // Material attributes: classify by keywords found in a material's "name + description" (ATK/DEF/LUK/WGT).
  // In-game wording varies, so each attribute collects common synonyms
  // (e.g. 攻守/攻防 = attack + defense; 輕盈/沉重 = weight). Keywords and labels are Chinese.
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

  // Market listing tag -> Chinese slot (accepts both English tags and Chinese type strings).
  const MARKET_TAG_LABEL = {
    // weapons
    Katana: '太刀', Sword: '單手劍', Dagger: '短刀', Rapier: '細劍', Axe: '雙手斧',
    GreatSword: '雙手劍', Bow: '弓', Pistol: '手槍', SMG: '衝鋒槍', LMG: '輕機槍', Sniper: '狙擊槍',
    // shield / off-hand
    Shield: '盾牌',
    // armor
    Helmet: '頭部', Head: '頭部', Body: '身體', Armor: '身體', Chest: '身體',
    Gloves: '手部', Hands: '手部', Boots: '腳部', Feet: '腳部', Shoes: '腳部',
    // accessories
    Necklace: '項鍊', Amulet: '項鍊', Ring: '戒指', Earring: '耳環', Earrings: '耳環'
  };
  // Resolve a tag string to a Chinese slot; returns null if it maps to nothing.
  function resolveMarketPart(text) {
    if (!text) return null;
    text = text.trim();
    if (MARKET_TAG_LABEL[text]) return MARKET_TAG_LABEL[text];
    if (KNOWN_TYPES.indexOf(text) !== -1) return text;
    return null;
  }

  // ---------- Styles ----------
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
    // material toolbar (native inventory page)
    '.gao-cls-matbar { margin: 0 0 var(--s-3,12px); }',
    // market
    '.gao-cls-market { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 4px 0 2px; font-family: var(--font-mono,monospace); }'
  ].join('\n');
  document.head.appendChild(style);

  // ---------- Filter state (persisted) ----------
  // types = inventory slots (concrete item types); quals = quality; market = market slots (Chinese)
  // mat = material attributes (attack/defense/luck/weight/none)
  const defFilters = { types: [], quals: [], mat: [], equipped: false, broken: false, worn: false, market: [] };
  function loadFilters() {
    try { return Object.assign({}, defFilters, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')); }
    catch (e) { return Object.assign({}, defFilters); }
  }
  function saveFilters() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch (e) {} }
  const filters = loadFilters();

  // ---------- Inventory equipment classification ----------
  function parseRow(row) {
    const typeEl = row.querySelector('.gao-ext-inventory-row-type');
    const nameEl = row.querySelector('.gao-ext-inventory-row-name');
    const type = typeEl ? (typeEl.getAttribute('title') || typeEl.textContent).trim() : '未分類';
    const name = nameEl ? nameEl.textContent.trim() : '';
    const equipped = !!row.querySelector('.gao-ext-inventory-row-marker');
    const qm = (row.getAttribute('style') || '').match(/--q-([a-z]+)/);
    const quality = qm ? qm[1] : 'common';
    const stats = row.querySelectorAll('.gao-ext-inventory-stat-value');
    let broken = false, worn = false;
    stats.forEach(function (s) { if (s.getAttribute('data-broken') === 'true') broken = true; });
    const durEl = stats[stats.length - 1];
    if (durEl) {
      const m = durEl.textContent.replace(/,/g, '').match(/(\d+)\s*\/\s*(\d+)/);
      if (m && parseInt(m[1], 10) < parseInt(m[2], 10)) worn = true;
    }
    return { type: type, name: name, equipped: equipped, quality: quality, broken: broken, worn: worn, el: row };
  }

  function rowMatches(r) {
    if (filters.types.length && filters.types.indexOf(r.type) === -1) return false;
    if (filters.quals.length && filters.quals.indexOf(r.quality) === -1) return false;
    if (filters.equipped && !r.equipped) return false;
    if (filters.broken && !r.broken) return false;
    if (filters.worn && !r.worn) return false;
    return true;
  }

  function ensureInventoryBar() {
    // A page may hold several lists (equipment / materials / ...): maintain each one's toolbar.
    const lists = document.querySelectorAll('.gao-ext-inventory-list');
    if (!lists.length) return;
    Array.prototype.forEach.call(lists, ensureInventoryBarFor);
  }

  function ensureInventoryBarFor(list) {
    // Read from the UI-extension list rows (most complete type/quality/status); the list stays in the DOM even in grid view.
    const rows = Array.prototype.map.call(list.querySelectorAll('.gao-ext-inventory-row'), parseRow);
    if (!rows.length) return;

    // Grid-view cells: same order as the list rows, paired by index so both views can be filtered.
    const wrap = list.closest('.grid-wrap') || list.parentElement;
    const gridCells = wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.igrid .cell--filled')) : [];

    // Present slots and qualities (decide whether the toolbar needs rebuilding).
    const typesPresent = [];
    const qualsPresent = [];
    const typeCount = {}, qualCount = {};
    rows.forEach(function (r) {
      if (typesPresent.indexOf(r.type) === -1) typesPresent.push(r.type);
      if (qualsPresent.indexOf(r.quality) === -1) qualsPresent.push(r.quality);
      typeCount[r.type] = (typeCount[r.type] || 0) + 1;
      qualCount[r.quality] = (qualCount[r.quality] || 0) + 1;
    });
    const signature = typesPresent.slice().sort().join(',') + '|' + qualsPresent.slice().sort().join(',');

    // Keep the toolbar right under this section's header (.grid-wrap__head), visible in both grid and list views.
    const head = wrap ? wrap.querySelector('.grid-wrap__head') : null;
    let bar = wrap ? wrap.querySelector('.gao-cls-bar') : null;
    const misplaced = bar && head && bar.previousElementSibling !== head;
    if (!bar || misplaced || (wrap && wrap.dataset.gaoClsSig !== signature)) {
      if (bar) bar.remove();
      bar = buildInventoryBar(typesPresent, qualsPresent);
      if (head && head.parentElement) head.parentElement.insertBefore(bar, head.nextSibling);
      else list.parentElement.insertBefore(bar, list);
      if (wrap) wrap.dataset.gaoClsSig = signature;
    }
    applyInventoryFilters(bar, rows, gridCells, typeCount, qualCount);
  }

  function buildInventoryBar(typesPresent, qualsPresent) {
    const bar = document.createElement('div');
    bar.className = 'gao-cls-bar';
    bar.innerHTML =
      '<div class="gao-cls-head">' +
        '<span class="gao-cls-title">裝備分類 · CLASSIFY</span>' +
        '<span class="gao-cls-count" data-gao-cls-count></span>' +
      '</div>';

    // Category row (top-level: 武器/盾/防具/飾品/...)
    const catRow = document.createElement('div');
    catRow.className = 'gao-cls-group';
    catRow.innerHTML = '<span class="gao-cls-glabel">類別</span>';
    CATEGORIES.forEach(function (cat) {
      const present = cat.types.filter(function (t) { return typesPresent.indexOf(t) !== -1; });
      if (!present.length) return;
      const chip = mkChip(cat.label, 'cat');
      chip.classList.add('gao-cls-cat');
      chip.dataset.gaoClsCat = cat.key;
      chip.addEventListener('click', function () {
        // If every slot in this category is already selected -> clear them, otherwise select all.
        const allOn = present.every(function (t) { return filters.types.indexOf(t) !== -1; });
        present.forEach(function (t) {
          const i = filters.types.indexOf(t);
          if (allOn) { if (i !== -1) filters.types.splice(i, 1); }
          else if (i === -1) filters.types.push(t);
        });
        saveFilters(); ensureInventoryBar();
      });
      catRow.appendChild(chip);
    });
    bar.appendChild(catRow);

    // Slot row (concrete types, ordered by category)
    const partRow = document.createElement('div');
    partRow.className = 'gao-cls-group';
    partRow.innerHTML = '<span class="gao-cls-glabel">部位</span>';
    const orderedTypes = [];
    CATEGORIES.forEach(function (c) { c.types.forEach(function (t) { if (typesPresent.indexOf(t) !== -1) orderedTypes.push(t); }); });
    typesPresent.forEach(function (t) { if (orderedTypes.indexOf(t) === -1) orderedTypes.push(t); });
    orderedTypes.forEach(function (t) {
      const chip = mkChip(t, 'type');
      chip.dataset.gaoClsType = t;
      chip.addEventListener('click', function () { toggleIn(filters.types, t); saveFilters(); ensureInventoryBar(); });
      partRow.appendChild(chip);
    });
    bar.appendChild(partRow);

    // Quality row
    const qualRow = document.createElement('div');
    qualRow.className = 'gao-cls-group';
    qualRow.innerHTML = '<span class="gao-cls-glabel">品質</span>';
    QUALITY_ORDER.forEach(function (q) {
      if (qualsPresent.indexOf(q) === -1) return;
      const chip = mkChip(QUALITY_LABEL[q] || q, 'qual');
      chip.dataset.gaoClsQual = q;
      chip.style.color = 'var(--q-' + q + ', var(--text-secondary))';
      chip.addEventListener('click', function () { toggleIn(filters.quals, q); saveFilters(); ensureInventoryBar(); });
      qualRow.appendChild(chip);
    });
    bar.appendChild(qualRow);

    // Status row
    const stRow = document.createElement('div');
    stRow.className = 'gao-cls-group';
    stRow.innerHTML = '<span class="gao-cls-glabel">狀態</span>';
    [['equipped', '已裝備'], ['worn', '未滿耐久'], ['broken', '破損']].forEach(function (pair) {
      const chip = mkChip(pair[1], 'flag');
      chip.dataset.gaoClsFlag = pair[0];
      chip.addEventListener('click', function () { filters[pair[0]] = !filters[pair[0]]; saveFilters(); ensureInventoryBar(); });
      stRow.appendChild(chip);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'gao-cls-reset';
    reset.textContent = '清除篩選';
    reset.addEventListener('click', function () {
      filters.types = []; filters.quals = [];
      filters.equipped = false; filters.broken = false; filters.worn = false;
      saveFilters(); ensureInventoryBar();
    });
    stRow.appendChild(reset);
    bar.appendChild(stRow);

    return bar;
  }

  function applyInventoryFilters(bar, rows, gridCells, typeCount, qualCount) {
    let shown = 0;
    rows.forEach(function (r, i) {
      const ok = rowMatches(r);
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
      // Mirror onto the matching grid-view cell (paired by index in the same order).
      if (gridCells && gridCells[i]) gridCells[i].classList.toggle('gao-cls-hidden-row', !ok);
      if (ok) shown++;
    });
    if (!bar) return;
    // Update the count and chip states (scoped to this toolbar).
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

  // ---------- Market slot / category filter ----------
  function ensureMarketBar() {
    if (location.pathname.indexOf('market') === -1) return;
    const chips = document.querySelector('.market-main .chips');
    const listings = document.querySelector('.market-main .listings');
    if (!chips || !listings) return;

    // Resolve each listing to a single Chinese slot (English tag or Chinese type both accepted).
    const rows = Array.prototype.map.call(listings.querySelectorAll('.listing'), function (el) {
      const meta = el.querySelector('.listing__meta') || el;
      let part = null;
      meta.querySelectorAll('span').forEach(function (sp) {
        if (!part) part = resolveMarketPart(sp.textContent);
      });
      // Fallback: search the whole listing's title text for a known slot.
      if (!part) part = resolveMarketPart((el.getAttribute('title') || '').trim());
      return { el: el, part: part };
    });
    const present = [];
    rows.forEach(function (r) { if (r.part && present.indexOf(r.part) === -1) present.push(r.part); });

    let bar = document.querySelector('.gao-cls-market');
    if (!present.length) { if (bar) bar.remove(); return; }

    // Order slots by category
    const orderedParts = [];
    CATEGORIES.forEach(function (c) { c.types.forEach(function (t) { if (present.indexOf(t) !== -1) orderedParts.push(t); }); });
    present.forEach(function (t) { if (orderedParts.indexOf(t) === -1) orderedParts.push(t); });
    // Present categories
    const catsPresent = CATEGORIES.filter(function (c) {
      return c.types.some(function (t) { return present.indexOf(t) !== -1; });
    });

    const sig = orderedParts.join(',');
    if (!bar || bar.dataset.sig !== sig) {
      if (bar) bar.remove();
      bar = document.createElement('div');
      bar.className = 'gao-cls-market';
      bar.dataset.sig = sig;

      // Category row
      const catLabel = document.createElement('span');
      catLabel.className = 'gao-cls-glabel';
      catLabel.textContent = '類別';
      bar.appendChild(catLabel);
      catsPresent.forEach(function (cat) {
        const partsIn = cat.types.filter(function (t) { return present.indexOf(t) !== -1; });
        const chip = mkChip(cat.label, 'cat');
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

      // Slot row
      const partLabel = document.createElement('span');
      partLabel.className = 'gao-cls-glabel';
      partLabel.textContent = '部位';
      bar.appendChild(partLabel);
      orderedParts.forEach(function (part) {
        const chip = mkChip(part, 'mkt');
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

    // Apply: when slots are selected, show only matching listings (hide the rest).
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

  // ---------- Material attribute classification (native inventory materials page, .inv-item-lr) ----------
  function ensureMaterialBar() {
    const center = document.querySelector('.inv-center');
    let bar = document.querySelector('.gao-cls-matbar');
    const rowEls = center ? center.querySelectorAll('.inv-item-lr') : [];
    if (!center || !rowEls.length) { if (bar) bar.remove(); return; }

    // Each material row: .lr__name holds the name (<b>) and description (<span>).
    // Read the whole block's text to match keywords, avoiding the coloured dot <span> inside the name <b>.
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
    // No recognizable attribute at all -> this page is probably not materials, hide the toolbar.
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
        const chip = mkChip(MAT_STAT_LABEL[s], 'mat');
        chip.dataset.gaoClsMat = s;
        chip.addEventListener('click', function () { toggleIn(filters.mat, s); saveFilters(); ensureMaterialBar(); });
        grp.appendChild(chip);
      });
      if (noneCount) {
        const chip = mkChip('其他', 'mat');
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

      // Insert after the category/search toolbar (.toolbar)
      const anchor = center.querySelector('.toolbar');
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(bar, anchor.nextSibling);
      else center.insertBefore(bar, center.firstChild);
    }

    // Apply filter (multi-select is OR; "Other" = no attribute at all)
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

  // ---------- Helpers ----------
  function mkChip(label, kind) {
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

  // ---------- Main loop (keep maintaining as the SPA navigates / lists re-render) ----------
  function tick() {
    try { ensureInventoryBar(); } catch (e) { console.error('[GAO classify] inventory', e); }
    try { ensureMaterialBar(); } catch (e) { console.error('[GAO classify] material', e); }
    try { ensureMarketBar(); } catch (e) { console.error('[GAO classify] market', e); }
  }
  setInterval(tick, 700);
  tick();
})();
