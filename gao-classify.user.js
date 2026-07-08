// ==UserScript==
// @name         Gun Art Online Item Classifier
// @namespace    gunart-classify
// @version      1.0.0
// @description  API-driven equipment / material / market classifier for Gun Art Online. Standalone — no theme.
// @author       ArcGrove
// @match        https://gunartonline.pages.dev/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* Split from gao-eyecare-classify-optimized 3.2.0.
 * This file contains ONLY the item classifier. The eye-care theme now lives in
 * gao-eyecare.user.js and can be installed independently.
 *
 * The classifier's UI uses the game's own CSS custom properties (e.g. --q-legendary,
 * --bg-elevated) with hard-coded fallbacks, so it renders correctly whether or not
 * the eye-care theme is installed.
 */
(function () {
  'use strict';

  // Guard against the script being installed/loaded twice on the same page.
  if (window.__gaoClassifyLoaded) return;
  window.__gaoClassifyLoaded = true;

  const FILTER_KEY = 'gao_cls_filters_v2';
  const DEBOUNCE_SAVE = 500; // 毫秒

  // ===== Data structures with fast lookups =====
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

  const QUALITY_ORDER = QUALITY_TABLE.map(q => q.name);
  const QUALITY_COLOR_BY_NAME = {
    傳說: 'var(--q-legendary)', 神話: 'var(--q-mythic)', 史詩: 'var(--q-epic)',
    完美: 'var(--q-rare)', 頂級: 'var(--q-rare)', 精良: 'var(--q-superior)',
    高級: 'var(--q-fine)', 上等: 'var(--q-uncommon)', 普通: 'var(--q-common)',
    次等: 'var(--q-poor)', 劣質: 'var(--q-trash)', 破爛: 'var(--q-trash)',
    垃圾般: 'var(--q-shit)', 屎一般: 'var(--q-shit)'
  };

  // Pre-compute quality lookup for O(1) access
  const qualityByRoll = new Map();
  for (const q of QUALITY_TABLE) {
    qualityByRoll.set(q.name, q);
  }

  function qualityNameOfRoll(roll) {
    const r = Number(roll);
    if (!Number.isFinite(r)) return null;
    const row = QUALITY_TABLE.find(q => r > q.min && r <= q.max);
    return row ? row.name : null;
  }

  const SLOT_LABEL_BY_KEY = {
    head: '頭部', body: '身體', gloves: '手套', shoes: '鞋子', underwear: '內衣',
    main_hand: '主手', off_hand: '副手', necklace: '項鍊', ring: '戒指', earring: '耳環'
  };

  const TAG_LABEL_BY_TAG = {
    Katana: '太刀', Sword: '單手劍', Dagger: '短刀', Rapier: '細劍', Axe: '雙手斧',
    GreatSword: '雙手劍', Bow: '弓', Pistol: '手槍', SMG: '衝鋒槍', LMG: '輕機槍',
    Sniper: '狙擊槍', Shield: '盾牌', BareHand: '空手', Universal: '通用', Gun: '通用槍械', Chain: '鎖鏈'
  };

  const CATEGORIES = [
    { key: 'weapon', label: '武器', types: ['單手劍', '雙手劍', '太刀', '短刀', '細劍', '雙手斧', '弓', '手槍', '衝鋒槍', '輕機槍', '狙擊槍', '空手', '鎖鏈', '通用'] },
    { key: 'shield', label: '盾/副手', types: ['盾牌', '副手'] },
    { key: 'armor', label: '防具', types: ['頭部', '身體', '手部', '腳部', '手套', '鞋子', '帽子', '衣服', '靴子', '內衣'] },
    { key: 'accessory', label: '飾品', types: ['項鍊', '戒指', '耳環', '護符'] },
    { key: 'other', label: '其他', types: ['未分類'] }
  ];

  // Pre-compute fast type lookup
  const KNOWN_TYPES_SET = new Set();
  for (const c of CATEGORIES) {
    for (const t of c.types) {
      KNOWN_TYPES_SET.add(t);
    }
  }

  const MAT_STATS = [
    { key: 'attack',  label: '攻擊', kw: ['攻擊', '攻守', '攻防', '普攻'] },
    { key: 'defense', label: '防禦', kw: ['防禦', '攻守', '攻防'] },
    { key: 'luck',    label: '幸運', kw: ['幸運'] },
    { key: 'weight',  label: '重量', kw: ['重量', '輕盈', '沉重', '份量', '分量', '質量', '密度', '負重'] }
  ];
  const MAT_STAT_ORDER = MAT_STATS.map(s => s.key);
  const MAT_STAT_LABEL = new Map();
  MAT_STATS.forEach(s => MAT_STAT_LABEL.set(s.key, s.label));

  function matStatsOf(text) {
    if (!text) return [];
    const out = [];
    for (const s of MAT_STATS) {
      if (s.kw.some(k => text.includes(k))) {
        out.push(s.key);
      }
    }
    return out;
  }

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
    return MARKET_TAG_LABEL[text] || (KNOWN_TYPES_SET.has(text) ? text : null);
  }

  // ===== Styles (consolidated) =====
  const style = document.createElement('style');
  style.textContent = `
    .gao-cls-bar { margin: 8px 0 12px; padding: 10px 12px; background: var(--bg-elevated,#20252e); border: 1px solid var(--border-soft,#8aa0b82e); border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
    .gao-cls-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .gao-cls-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--cyan-300,#6aa6b2); }
    .gao-cls-count { font-size: 11px; color: var(--text-muted,#868e9b); }
    .gao-cls-group { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .gao-cls-glabel { font-size: 10px; color: var(--text-muted,#868e9b); letter-spacing: 1px; margin-right: 2px; min-width: 30px; }
    .gao-cls-chip { font-family: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid var(--border-strong,#566372); background: none; color: var(--text-secondary,#c3cad6); cursor: pointer; border-radius: 3px; transition: all 0.2s ease; }
    .gao-cls-chip:hover { border-color: var(--cyan-400,#4c8a94); color: var(--text-primary,#eef1f6); }
    .gao-cls-chip[data-active="true"] { background: rgba(0,203,240,.10); border-color: var(--cyan-400,#4c8a94); color: var(--cyan-200,#95c1c8); }
    .gao-cls-chip.gao-cls-cat[data-active="true"] { background: rgba(0,203,240,.18); }
    .gao-cls-chip small { color: var(--text-muted,#868e9b); margin-left: 4px; font-size: 10px; }
    .gao-cls-chip[data-active="true"] small { color: var(--cyan-300,#6aa6b2); }
    .gao-cls-reset { font-family: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid var(--red-500,#84444f); background: none; color: var(--red-300,#b9777e); cursor: pointer; border-radius: 3px; transition: all 0.2s ease; }
    .gao-cls-reset:hover { background: rgba(172,94,103,.12); }
    .gao-cls-hidden-row { display: none !important; }
    .gao-cls-matbar { margin: 0 0 var(--s-3,12px); }
    .gao-cls-market { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 4px 0 2px; font-family: var(--font-mono,monospace); }
    .gao-cls-maxbtn { font-family: var(--font-mono,monospace); font-size: 10px; letter-spacing: 1px; width: 42px; height: 28px; border: 1px solid var(--cyan-400,#4c8a94); background: rgba(0,203,240,.08); color: var(--cyan-200,#95c1c8); cursor: pointer; border-radius: 3px; transition: all 0.2s ease; }
    .gao-cls-maxbtn:hover { background: rgba(0,203,240,.16); }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ===== Filter state with debounced persistence =====
  const defFilters = { types: [], quals: [], mat: [], equipped: false, broken: false, worn: false, market: [] };
  function loadFilters() {
    try {
      return Object.assign({}, defFilters, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, defFilters);
    }
  }

  let savePending = false;
  let saveTimeout = null;
  function saveFilters() {
    if (savePending) return; // Already scheduled
    savePending = true;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
      } catch (e) {}
      savePending = false;
    }, DEBOUNCE_SAVE);
  }

  const filters = loadFilters();

  // ===== API data layer with caching =====
  const equipmentById = new Map();
  let equipFetchInFlight = false;

  function normId(value) {
    const n = Number(value);
    return (Number.isInteger(n) && n > 0) ? n : null;
  }

  function ingestEquipment(payload) {
    const list = payload && Array.isArray(payload.equipment) ? payload.equipment
      : Array.isArray(payload) ? payload : null;
    if (!list) return false;
    let changed = false;
    for (const item of list) {
      const id = normId(item?.id);
      if (id) {
        equipmentById.set(id, item);
        changed = true;
      }
    }
    return changed;
  }

  function installFetchHook() {
    if (window.__gaoClsFetchHook) return;
    if (typeof window.fetch !== 'function') return;
    window.__gaoClsFetchHook = 1;
    const orig = window.fetch;
    window.fetch = function () {
      const p = orig.apply(this, arguments);
      try {
        const info = arguments[0];
        const url = typeof info === 'string' ? info : (info?.url) ? String(info.url) : '';
        if (/\/api\/forge\/equipment\/?(\?|$)/i.test(url)) {
          p.then(res => {
            if (!res?.ok) return;
            res.clone().json().then(data => {
              if (ingestEquipment(data)) scheduleMount();
            }).catch(() => {});
          }).catch(() => {});
        }
      } catch (e) {}
      return p;
    };
  }
  installFetchHook();

  function ensureEquipmentData() {
    if (equipmentById.size || equipFetchInFlight || typeof window.fetch !== 'function') return;
    equipFetchInFlight = true;
    window.fetch('/api/forge/equipment', { credentials: 'same-origin' })
      .then(res => res?.ok ? res.json() : null)
      .then(data => {
        if (ingestEquipment(data)) scheduleMount();
      })
      .catch(() => {})
      .then(() => { equipFetchInFlight = false; });
  }

  // ===== React Fiber extraction (cached) =====
  const fiberCache = new WeakMap();
  function cellItemId(cell) {
    try {
      let cached = fiberCache.get(cell);
      if (cached !== undefined) return cached;
      const key = Object.keys(cell).find(k => k.startsWith('__reactFiber$'));
      const fiber = key ? cell[key] : null;
      const id = fiber ? normId(fiber.key) : null;
      fiberCache.set(cell, id);
      return id;
    } catch (e) {
      return null;
    }
  }

  function typeOfEquipment(eq) {
    if (!eq) return null;
    const tags = Array.isArray(eq.tags) ? eq.tags : [];
    for (const t of tags) {
      const l = TAG_LABEL_BY_TAG[String(t)];
      if (l) return l;
    }
    const slot = String(eq.equipment_slot || '').trim();
    return SLOT_LABEL_BY_KEY[slot] || null;
  }

  // ===== Fast filter matching with Set lookups =====
  const filterSets = {
    types: new Set(),
    quals: new Set(),
    mat: new Set(),
    market: new Set()
  };

  function updateFilterSets() {
    filterSets.types = new Set(filters.types);
    filterSets.quals = new Set(filters.quals);
    filterSets.mat = new Set(filters.mat);
    filterSets.market = new Set(filters.market);
  }

  function rowMatches(r) {
    if (filterSets.types.size && !filterSets.types.has(r.type)) return false;
    if (filterSets.quals.size && (!r.quality || !filterSets.quals.has(r.quality))) return false;
    if (filters.equipped && !r.equipped) return false;
    if (filters.broken && !r.broken) return false;
    if (filters.worn && !r.worn) return false;
    return true;
  }

  function parseRow(el) {
    const id = cellItemId(el);
    const eq = id != null ? equipmentById.get(id) : null;
    const type = typeOfEquipment(eq) || '未分類';
    const quality = eq ? qualityNameOfRoll(eq.name_rolls?.quality) : null;
    const equipped = el.classList.contains('cell--equipped') || !!(eq?.equipped);
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
    return { el, type, quality, equipped, broken, worn, hasDur };
  }

  // ===== Equipment bar (optimized with batch updates) =====
  function collectEquipmentRowEls(wrap) {
    const grid = wrap.querySelector('.igrid');
    if (grid) {
      const cells = [];
      for (const c of grid.children) {
        if (c.classList?.contains('cell') && c.classList.contains('cell--filled')) {
          cells.push(c);
        }
      }
      return cells;
    }
    const rows = [];
    for (const el of wrap.querySelectorAll('.listing-row')) {
      if (!el.classList.contains('inv-item-lr')) {
        rows.push(el);
      }
    }
    return rows;
  }

  function ensureEquipmentBar() {
    const wraps = document.querySelectorAll('.inv-center .grid-wrap');
    if (!wraps.length) return;
    for (const wrap of wraps) {
      ensureEquipmentBarForWrap(wrap);
    }
  }

  function ensureEquipmentBarForWrap(wrap) {
    const head = wrap.querySelector('.grid-wrap__head');
    const rowEls = collectEquipmentRowEls(wrap);

    if (!rowEls.length) {
      const bar = wrap.querySelector('.gao-cls-bar:not(.gao-cls-matbar)');
      if (bar) bar.remove();
      delete wrap.dataset.gaoClsSig;
      return;
    }

    const rows = rowEls.map(parseRow);
    const typesPresent = new Set();
    const qualsPresent = new Set();
    const typeCount = new Map();
    const qualCount = new Map();
    let anyDur = false;

    for (const r of rows) {
      typesPresent.add(r.type);
      typeCount.set(r.type, (typeCount.get(r.type) || 0) + 1);
      if (r.quality) {
        qualsPresent.add(r.quality);
        qualCount.set(r.quality, (qualCount.get(r.quality) || 0) + 1);
      }
      if (r.hasDur) anyDur = true;
    }

    const signature = Array.from(typesPresent).sort().join(',') + '|' + Array.from(qualsPresent).sort().join(',') + '|' + (anyDur ? 'd' : '');
    const bar = wrap.querySelector('.gao-cls-bar:not(.gao-cls-matbar)');
    const misplaced = bar && head && bar.previousElementSibling !== head;

    if (!bar || misplaced || wrap.dataset.gaoClsSig !== signature) {
      if (bar) bar.remove();
      const newBar = buildEquipmentBar(Array.from(typesPresent), Array.from(qualsPresent), anyDur);
      if (head?.parentElement) {
        head.parentElement.insertBefore(newBar, head.nextSibling);
      } else {
        wrap.insertBefore(newBar, wrap.firstChild);
      }
      wrap.dataset.gaoClsSig = signature;
      applyEquipmentFilters(newBar, rows, typeCount, qualCount);
    } else {
      applyEquipmentFilters(bar, rows, typeCount, qualCount);
    }
  }

  function buildEquipmentBar(typesPresent, qualsPresent, anyDur) {
    const bar = document.createElement('div');
    bar.className = 'gao-cls-bar';
    bar.innerHTML =
      '<div class="gao-cls-head">' +
        '<span class="gao-cls-title">裝備分類 · CLASSIFY</span>' +
        '<span class="gao-cls-count" data-gao-cls-count></span>' +
      '</div>';

    // Category row
    const catRow = document.createElement('div');
    catRow.className = 'gao-cls-group';
    catRow.innerHTML = '<span class="gao-cls-glabel">類別</span>';
    for (const cat of CATEGORIES) {
      const present = cat.types.filter(t => typesPresent.includes(t));
      if (!present.length) continue;
      const chip = mkChip(cat.label);
      chip.classList.add('gao-cls-cat');
      chip.dataset.gaoClsCat = cat.key;
      chip.addEventListener('click', () => {
        const allOn = present.every(t => filterSets.types.has(t));
        for (const t of present) {
          const i = filters.types.indexOf(t);
          if (allOn) {
            if (i !== -1) filters.types.splice(i, 1);
          } else if (i === -1) {
            filters.types.push(t);
          }
        }
        updateFilterSets();
        saveFilters();
        ensureEquipmentBar();
      });
      catRow.appendChild(chip);
    }
    bar.appendChild(catRow);

    // Slot row
    const partRow = document.createElement('div');
    partRow.className = 'gao-cls-group';
    partRow.innerHTML = '<span class="gao-cls-glabel">部位</span>';
    const ordered = [];
    for (const c of CATEGORIES) {
      for (const t of c.types) {
        if (typesPresent.includes(t) && !ordered.includes(t)) {
          ordered.push(t);
        }
      }
    }
    for (const t of typesPresent) {
      if (!ordered.includes(t)) ordered.push(t);
    }
    for (const t of ordered) {
      const chip = mkChip(t);
      chip.dataset.gaoClsType = t;
      chip.addEventListener('click', () => {
        toggleIn(filters.types, t);
        updateFilterSets();
        saveFilters();
        ensureEquipmentBar();
      });
      partRow.appendChild(chip);
    }
    bar.appendChild(partRow);

    // Quality row
    if (qualsPresent.length) {
      const qualRow = document.createElement('div');
      qualRow.className = 'gao-cls-group';
      qualRow.innerHTML = '<span class="gao-cls-glabel">品質</span>';
      const orderedQ = QUALITY_ORDER.filter(q => qualsPresent.includes(q));
      for (const q of qualsPresent) {
        if (!orderedQ.includes(q)) orderedQ.push(q);
      }
      for (const q of orderedQ) {
        const chip = mkChip(q);
        chip.dataset.gaoClsQual = q;
        chip.style.color = QUALITY_COLOR_BY_NAME[q] || 'var(--text-secondary)';
        chip.addEventListener('click', () => {
          toggleIn(filters.quals, q);
          updateFilterSets();
          saveFilters();
          ensureEquipmentBar();
        });
        qualRow.appendChild(chip);
      }
      bar.appendChild(qualRow);
    }

    // Status row
    const stRow = document.createElement('div');
    stRow.className = 'gao-cls-group';
    stRow.innerHTML = '<span class="gao-cls-glabel">狀態</span>';
    const flags = [['equipped', '已裝備']];
    if (anyDur) {
      flags.push(['worn', '未滿耐久']);
      flags.push(['broken', '破損']);
    }
    for (const [key, label] of flags) {
      const chip = mkChip(label);
      chip.dataset.gaoClsFlag = key;
      chip.addEventListener('click', () => {
        filters[key] = !filters[key];
        saveFilters();
        ensureEquipmentBar();
      });
      stRow.appendChild(chip);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'gao-cls-reset';
    reset.textContent = '清除篩選';
    reset.addEventListener('click', () => {
      filters.types = [];
      filters.quals = [];
      filters.equipped = false;
      filters.broken = false;
      filters.worn = false;
      updateFilterSets();
      saveFilters();
      ensureEquipmentBar();
    });
    stRow.appendChild(reset);
    bar.appendChild(stRow);
    return bar;
  }

  function applyEquipmentFilters(bar, rows, typeCount, qualCount) {
    let shown = 0;
    for (const r of rows) {
      const ok = rowMatches(r);
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
      if (ok) shown++;
    }
    if (!bar) return;

    const countEl = bar.querySelector('[data-gao-cls-count]');
    if (countEl) countEl.textContent = `顯示 ${shown} / ${rows.length} 件`;

    // Update type chips
    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-type]')) {
      const t = chip.dataset.gaoClsType;
      chip.dataset.active = filterSets.types.has(t) ? 'true' : 'false';
      setChipCount(chip, typeCount.get(t) || 0);
    }

    // Update category chips
    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-cat]')) {
      const cat = CATEGORIES.find(c => c.key === chip.dataset.gaoClsCat);
      const present = cat ? cat.types.filter(t => (typeCount.get(t) || 0) > 0) : [];
      const allOn = present.length && present.every(t => filterSets.types.has(t));
      chip.dataset.active = allOn ? 'true' : 'false';
    }

    // Update quality chips
    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-qual]')) {
      const q = chip.dataset.gaoClsQual;
      chip.dataset.active = filterSets.quals.has(q) ? 'true' : 'false';
      setChipCount(chip, qualCount.get(q) || 0);
    }

    // Update flag chips
    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-flag]')) {
      chip.dataset.active = filters[chip.dataset.gaoClsFlag] ? 'true' : 'false';
    }
  }

  // ===== Material classification (optimized) =====
  function activeInventoryCategory() {
    for (const active of document.querySelectorAll('.inv-main .cat--active')) {
      const b = active.querySelector('.cat__name b');
      if (b?.textContent.trim()) return b.textContent.trim();
    }
    return null;
  }

  function ensureMaterialBar() {
    const center = document.querySelector('.inv-center');
    const bar = document.querySelector('.gao-cls-matbar');
    const rowEls = center ? center.querySelectorAll('.inv-item-lr') : [];
    const cat = activeInventoryCategory();

    if (!center || !rowEls.length || (cat && cat !== '素材')) {
      if (bar) bar.remove();
      return;
    }

    const rows = [];
    for (const el of rowEls) {
      const nameWrap = el.querySelector('.lr__name');
      const text = nameWrap?.textContent || '';
      rows.push({ el, stats: matStatsOf(text) });
    }

    const statCount = new Map();
    let noneCount = 0;
    for (const r of rows) {
      if (r.stats.length) {
        for (const s of r.stats) {
          statCount.set(s, (statCount.get(s) || 0) + 1);
        }
      } else {
        noneCount++;
      }
    }

    const statsPresent = MAT_STAT_ORDER.filter(s => statCount.has(s));
    if (!statsPresent.length) {
      if (bar) bar.remove();
      return;
    }

    const sig = statsPresent.join(',') + (noneCount ? '|none' : '');
    if (!bar || bar.dataset.sig !== sig) {
      if (bar) bar.remove();
      const newBar = document.createElement('div');
      newBar.className = 'gao-cls-bar gao-cls-matbar';
      newBar.dataset.sig = sig;
      newBar.innerHTML =
        '<div class="gao-cls-head">' +
          '<span class="gao-cls-title">素材屬性 · MATERIALS</span>' +
          '<span class="gao-cls-count" data-gao-cls-matcount></span>' +
        '</div>';
      const grp = document.createElement('div');
      grp.className = 'gao-cls-group';
      grp.innerHTML = '<span class="gao-cls-glabel">屬性</span>';
      for (const s of statsPresent) {
        const chip = mkChip(MAT_STAT_LABEL.get(s));
        chip.dataset.gaoClsMat = s;
        chip.addEventListener('click', () => {
          toggleIn(filters.mat, s);
          updateFilterSets();
          saveFilters();
          ensureMaterialBar();
        });
        grp.appendChild(chip);
      }
      if (noneCount) {
        const chip = mkChip('其他');
        chip.dataset.gaoClsMat = 'none';
        chip.addEventListener('click', () => {
          toggleIn(filters.mat, 'none');
          updateFilterSets();
          saveFilters();
          ensureMaterialBar();
        });
        grp.appendChild(chip);
      }
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gao-cls-reset';
      reset.textContent = '清除';
      reset.addEventListener('click', () => {
        filters.mat = [];
        updateFilterSets();
        saveFilters();
        ensureMaterialBar();
      });
      grp.appendChild(reset);
      newBar.appendChild(grp);

      const anchor = center.querySelector('.toolbar');
      if (anchor?.parentElement) {
        anchor.parentElement.insertBefore(newBar, anchor.nextSibling);
      } else {
        center.insertBefore(newBar, center.firstChild);
      }
    }

    const active = filterSets.mat;
    const wantNone = active.has('none');
    let shown = 0;
    for (const r of rows) {
      let ok = true;
      if (active.size) {
        ok = r.stats.some(s => active.has(s)) || (wantNone && r.stats.length === 0);
      }
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
      if (ok) shown++;
    }

    const countEl = document.querySelector('[data-gao-cls-matcount]');
    if (countEl) countEl.textContent = `顯示 ${shown} / ${rows.length} 種`;

    for (const chip of document.querySelectorAll('.gao-cls-chip[data-gao-cls-mat]')) {
      const s = chip.dataset.gaoClsMat;
      chip.dataset.active = active.has(s) ? 'true' : 'false';
      setChipCount(chip, s === 'none' ? noneCount : (statCount.get(s) || 0));
    }
  }

  // ===== Market bar (optimized) =====
  function ensureMarketBar() {
    const chips = document.querySelector('.market-main .chips');
    const listings = document.querySelector('.market-main .listings');
    if (!chips || !listings) return;

    const rows = [];
    for (const el of listings.querySelectorAll('.listing')) {
      const meta = el.querySelector('.listing__meta') || el;
      let part = null;
      for (const sp of meta.querySelectorAll('span')) {
        if (!part) part = resolveMarketPart(sp.textContent);
      }
      if (!part) part = resolveMarketPart((el.getAttribute('title') || '').trim());
      rows.push({ el, part });
    }

    const present = [];
    for (const r of rows) {
      if (r.part && !present.includes(r.part)) present.push(r.part);
    }

    let bar = document.querySelector('.gao-cls-market');
    if (!present.length) {
      if (bar) bar.remove();
      return;
    }

    const orderedParts = [];
    for (const c of CATEGORIES) {
      for (const t of c.types) {
        if (present.includes(t) && !orderedParts.includes(t)) {
          orderedParts.push(t);
        }
      }
    }
    for (const t of present) {
      if (!orderedParts.includes(t)) orderedParts.push(t);
    }

    const catsPresent = CATEGORIES.filter(c =>
      c.types.some(t => present.includes(t))
    );

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

      for (const cat of catsPresent) {
        const partsIn = cat.types.filter(t => present.includes(t));
        const chip = mkChip(cat.label);
        chip.classList.add('gao-cls-cat');
        chip.dataset.gaoClsMktCat = cat.key;
        chip.addEventListener('click', () => {
          const allOn = partsIn.every(t => filterSets.market.has(t));
          for (const t of partsIn) {
            const i = filters.market.indexOf(t);
            if (allOn) {
              if (i !== -1) filters.market.splice(i, 1);
            } else if (i === -1) {
              filters.market.push(t);
            }
          }
          updateFilterSets();
          saveFilters();
          ensureMarketBar();
        });
        bar.appendChild(chip);
      }

      const partLabel = document.createElement('span');
      partLabel.className = 'gao-cls-glabel';
      partLabel.textContent = '部位';
      bar.appendChild(partLabel);

      for (const part of orderedParts) {
        const chip = mkChip(part);
        chip.dataset.gaoClsMkt = part;
        chip.addEventListener('click', () => {
          toggleIn(filters.market, part);
          updateFilterSets();
          saveFilters();
          ensureMarketBar();
        });
        bar.appendChild(chip);
      }

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gao-cls-reset';
      reset.textContent = '全部';
      reset.addEventListener('click', () => {
        filters.market = [];
        updateFilterSets();
        saveFilters();
        ensureMarketBar();
      });
      bar.appendChild(reset);
      chips.parentElement.insertBefore(bar, chips.nextSibling);
    }

    const active = filterSets.market;
    for (const r of rows) {
      const ok = !active.size || (r.part && active.has(r.part));
      r.el.classList.toggle('gao-cls-hidden-row', !ok);
    }

    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-mkt]')) {
      chip.dataset.active = active.has(chip.dataset.gaoClsMkt) ? 'true' : 'false';
    }

    for (const chip of bar.querySelectorAll('.gao-cls-chip[data-gao-cls-mkt-cat]')) {
      const cat = CATEGORIES.find(c => c.key === chip.dataset.gaoClsMktCat);
      const partsIn = cat ? cat.types.filter(t => present.includes(t)) : [];
      const allOn = partsIn.length && partsIn.every(t => active.has(t));
      chip.dataset.active = allOn ? 'true' : 'false';
    }
  }

  function setInputValue(input, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc?.set) {
      desc.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureMarketMaxButton() {
    const detail = document.querySelector('.detail');
    if (!detail || detail.querySelector('[data-gao-cls-max]')) return;
    const m = detail.textContent.match(/剩餘庫存：\s*(\d+)\s*件/);
    const max = m ? Number(m[1]) : 0;
    const input = detail.querySelector('input[inputmode="numeric"], input[type="text"]');
    const plus = Array.prototype.find.call(detail.querySelectorAll('button'), b =>
      b.textContent.trim() === '+'
    );
    if (!max || !input || !plus) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gao-cls-maxbtn';
    button.setAttribute('data-gao-cls-max', '1');
    button.textContent = 'MAX';
    button.title = `填入剩餘庫存數量 (${max})`;
    button.addEventListener('click', () => {
      setInputValue(input, String(max));
    });
    plus.insertAdjacentElement('afterend', button);
  }

  // ===== Helpers =====
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

  // ===== Routing + single unified MutationObserver =====
  let pageObserver = null;
  let currentPath = '';
  let queuedMount = false;
  let queuedRefresh = false;

  function findMainRoot() {
    return document.querySelector('main.page-main, main');
  }

  function refreshInventory() {
    try {
      updateFilterSets();
      ensureEquipmentBar();
    } catch (e) {
      console.error('[GAO classify] equipment', e);
    }
    try {
      ensureMaterialBar();
    } catch (e) {
      console.error('[GAO classify] material', e);
    }
  }

  function refreshMarket() {
    try {
      updateFilterSets();
      ensureMarketBar();
    } catch (e) {
      console.error('[GAO classify] market', e);
    }
    try {
      ensureMarketMaxButton();
    } catch (e) {
      console.error('[GAO classify] market-max', e);
    }
  }

  function disconnectObserver() {
    if (pageObserver) pageObserver.disconnect();
    pageObserver = null;
  }

  function mountObserved(root, refresh, opts) {
    if (!root) {
      disconnectObserver();
      setTimeout(scheduleMount, 80);
      return;
    }
    refresh();
    disconnectObserver();
    pageObserver = new MutationObserver(() => {
      scheduleRefresh(refresh);
    });
    pageObserver.observe(root, opts);
  }

  function scheduleRefresh(refresh) {
    const path = currentPath;
    if (queuedRefresh) return;
    queuedRefresh = true;
    requestAnimationFrame(() => {
      queuedRefresh = false;
      if (location.pathname !== path) return;
      refresh();
    });
  }

  function scheduleMount() {
    if (queuedMount) return;
    queuedMount = true;
    requestAnimationFrame(() => {
      queuedMount = false;
      mountForRoute();
    });
  }

  function mountForRoute() {
    const path = location.pathname;
    if (currentPath !== path) {
      currentPath = path;
      disconnectObserver();
    }
    if (path.includes('/inventory')) {
      ensureEquipmentData();
      return mountObserved(findMainRoot(), refreshInventory, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }
    if (path.includes('/market')) {
      return mountObserved(document.body, refreshMarket, {
        childList: true,
        subtree: true
      });
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
    window.addEventListener('popstate', () => {
      setTimeout(scheduleMount, 80);
    });
  }

  function boot() {
    updateFilterSets();
    hookRouteChanges();
    mountForRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
