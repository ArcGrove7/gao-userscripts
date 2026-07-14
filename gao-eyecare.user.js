// ==UserScript==
// @name         Gun Art Online Eye-Care Theme
// @namespace    gunart-eyecare
// @version      1.1.0
// @description  ALT+2 開啟護眼模式、初始地玩家隱藏、跑馬燈公告開關
// @author       ArcGrove7
// @match        https://gunartonline.pages.dev/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* Split from gao-eyecare-classify-optimized 3.2.0.
 * This file contains ONLY the eye-care theme. The item classifier now lives in
 * gao-classify.user.js and can be installed independently.
 */

(() => {
  "use strict";

  // Guard against the script being installed/loaded twice on the same page.
  if (window.__gaoEyeCareLoaded) return;
  window.__gaoEyeCareLoaded = true;

  const ATTR = "data-gao-theme";
  const STORAGE_KEY = "gao-lowsat-enabled";
  const THEME_CLASS = "gao-lowsat";
  const MY_VALUE = "gao-lowsat";
  const MY_LABEL = "Low-Saturation Dark (Eye-Care · WCAG AA)";
  const NATIVE_SELECT = '[data-gao-ext="settings-theme-select"]';

  // Own namespace, kept distinct from the UI Extension's data-gao-ext so both
  // scripts can inject into the same settings block without colliding.
  const EC_ATTR = "data-gao-eyecare";

  const MARQUEE_KEY = "gao-hide-marquee";
  const TOWN_PLAYERS_KEY = "gao-hide-town-players";
  const HIDE_MARQUEE_CLASS = "gao-hide-marquee";
  const HIDE_TOWN_PLAYERS_CLASS = "gao-hide-town-players";

  // The starting-town player list is rendered with inline styles only, so the
  // container has no class to select. Its header is the one stable handle:
  // the game renders `${zoneName} · 同層玩家`.
  const TOWN_ZONE_NAME = "起始之鎮";
  const PLAYER_LIST_HEADER = "同層玩家";
  const TOWN_LIST_FLAG = "data-gao-ec-town-list";

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
    --glow-cyan: 0 0 8px #519a9e33; --glow-red: 0 0 8px #ad606b33;
    --glow-magenta: 0 0 8px #b26a9333; --glow-gold: 0 0 8px #b4a26e2e; --glow-lime: 0 0 8px #90a8662e;
  `;

  const EXTRA_DARK_CSS = `
    html.${THEME_CLASS} { font-size: 125% !important; }
    html.${THEME_CLASS} body { line-height: 1.6 !important; -webkit-font-smoothing: antialiased; }
  `;

  // Static rules: the toggles only flip classes on <html>, so nothing needs to
  // be restored by hand when a feature is switched back on.
  const FEATURE_CSS = `
    html.${HIDE_MARQUEE_CLASS} .ann-marquee { display: none !important; }
    html.${HIDE_TOWN_PLAYERS_CLASS} [${TOWN_LIST_FLAG}] { display: none !important; }

    .gao-ec-settings-stack { display: flex; flex-direction: column; gap: var(--s-3); margin-top: var(--s-3); }
    .gao-ec-settings-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-4); background: var(--bg-elevated); border: 1px solid var(--border-faint); }
    .gao-ec-settings-copy { min-width: 0; }
    .gao-ec-settings-title { font-family: var(--font-display); font-size: var(--fs-xs); font-weight: 700; letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--text-primary); margin-bottom: 6px; }
    .gao-ec-settings-description { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); line-height: var(--lh-relax); }
    .gao-ec-settings-toggle { flex-shrink: 0; position: relative; width: 56px; height: 28px; background: var(--bg-input); border: 1px solid var(--border-soft); box-shadow: none; clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px); transition: all var(--dur-med); cursor: pointer; }
    .gao-ec-settings-toggle span { position: absolute; top: 4px; bottom: 4px; width: 20px; left: 4px; background: var(--border-default); box-shadow: none; clip-path: polygon(2px 0, 100% 0, 100% calc(100% - 2px), calc(100% - 2px) 100%, 0 100%, 0 2px); transition: all var(--dur-med); }
    .gao-ec-settings-toggle[data-enabled="true"] { background: var(--cyan-500); border-color: var(--cyan-300); }
    .gao-ec-settings-toggle[data-enabled="true"] span { left: 30px; background: var(--bg-void); }
  `;

  let enabled = localStorage.getItem(STORAGE_KEY) === "1";
  let hideMarquee = localStorage.getItem(MARQUEE_KEY) === "1";
  let hideTownPlayers = localStorage.getItem(TOWN_PLAYERS_KEY) === "1";
  let styleEl = null;
  let featureStyleEl = null;

  function css() {
    return enabled ? `:root { ${DARK_LOWSAT_VARS} } ${EXTRA_DARK_CSS}` : "";
  }

  function applyFeatureStyle() {
    if (!document.head) return;
    if (!featureStyleEl) {
      featureStyleEl = document.createElement("style");
      featureStyleEl.setAttribute(ATTR, "feature-style");
      featureStyleEl.textContent = FEATURE_CSS;
    }
    document.head.appendChild(featureStyleEl);
  }

  function applyFeatureFlags() {
    const root = document.documentElement;
    root.classList.toggle(HIDE_MARQUEE_CLASS, hideMarquee);
    root.classList.toggle(HIDE_TOWN_PLAYERS_CLASS, hideTownPlayers);
  }

  function setHideMarquee(on) {
    hideMarquee = !!on;
    localStorage.setItem(MARQUEE_KEY, hideMarquee ? "1" : "0");
    applyFeatureFlags();
    syncSettingsPanel();
  }

  function setHideTownPlayers(on) {
    hideTownPlayers = !!on;
    localStorage.setItem(TOWN_PLAYERS_KEY, hideTownPlayers ? "1" : "0");
    applyFeatureFlags();
    tagTownPlayerList();
    syncSettingsPanel();
  }

  /* Tag the starting-town player list so the static CSS above can hide it.
   * Only the header text identifies it, and only while the player is actually
   * in the starting town — other zones keep their list. */
  function tagTownPlayerList() {
    for (const stale of document.querySelectorAll(`[${TOWN_LIST_FLAG}]`)) {
      stale.removeAttribute(TOWN_LIST_FLAG);
    }
    if (!hideTownPlayers) return;
    for (const node of document.querySelectorAll("div")) {
      // Header + list (or the "no other players" placeholder).
      if (node.children.length !== 2) continue;
      const header = node.firstElementChild.textContent.trim();
      // Exact match: an ancestor's first child would also *contain* this text,
      // and tagging the ancestor would hide far more than the list.
      if (header !== `${TOWN_ZONE_NAME} · ${PLAYER_LIST_HEADER}`) continue;
      node.setAttribute(TOWN_LIST_FLAG, "1");
    }
  }

  function applyStyle() {
    if (!document.head) return;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.setAttribute(ATTR, "style");
    }
    styleEl.textContent = css();
    document.head.appendChild(styleEl);
    document.documentElement.classList.toggle(THEME_CLASS, enabled);
  }

  function setEnabled(on) {
    enabled = !!on;
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    applyStyle();
    syncSelect();
  }

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
      sel.addEventListener("change", () => setEnabled(sel.value === MY_VALUE));
    }
    if (enabled) sel.value = MY_VALUE;
  }

  function createToggle(name, label, onClick) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "gao-ec-settings-toggle";
    toggle.setAttribute(EC_ATTR, name);
    toggle.setAttribute("aria-label", label);
    toggle.appendChild(document.createElement("span"));
    toggle.addEventListener("click", onClick);
    return toggle;
  }

  function createRow({ title, description, control }) {
    const row = document.createElement("div");
    row.className = "gao-ec-settings-row";
    const copy = document.createElement("div");
    copy.className = "gao-ec-settings-copy";
    const titleEl = document.createElement("div");
    titleEl.className = "gao-ec-settings-title";
    titleEl.textContent = title;
    const descEl = document.createElement("div");
    descEl.className = "gao-ec-settings-description";
    descEl.textContent = description;
    copy.append(titleEl, descEl);
    row.append(copy, control);
    return row;
  }

  function createSettingsPanel() {
    const panel = document.createElement("div");
    panel.className = "gao-ec-settings-stack";
    panel.setAttribute(EC_ATTR, "settings-options");
    panel.append(
      createRow({
        title: "ANNOUNCEMENT MARQUEE / 公告跑馬燈",
        description: "隱藏頂端捲動的公告跑馬燈 · 僅影響本裝置",
        control: createToggle("marquee-toggle", "關閉公告跑馬燈", () =>
          setHideMarquee(!hideMarquee),
        ),
      }),
      createRow({
        title: "TOWN PLAYER LIST / 起始之鎮玩家顯示",
        description: "隱藏起始之鎮的同層玩家清單；其他區域不受影響 · 僅影響本裝置",
        control: createToggle("town-players-toggle", "關閉起始之鎮玩家顯示", () =>
          setHideTownPlayers(!hideTownPlayers),
        ),
      }),
    );
    return panel;
  }

  function syncSettingsPanel() {
    let block = null;
    for (const heading of document.querySelectorAll(".blk__title")) {
      if (!heading.textContent?.includes("Display")) continue;
      block = heading.closest(".blk");
      break;
    }
    if (!block) return;
    let panel = block.querySelector(`[${EC_ATTR}="settings-options"]`);
    if (!panel) {
      panel = createSettingsPanel();
      block.appendChild(panel);
    }
    const states = [
      ["marquee-toggle", hideMarquee],
      ["town-players-toggle", hideTownPlayers],
    ];
    for (const [name, on] of states) {
      const toggle = panel.querySelector(`[${EC_ATTR}="${name}"]`);
      if (!toggle) continue;
      toggle.dataset.enabled = String(on);
      toggle.setAttribute("aria-pressed", String(on));
    }
  }

  function boot() {
    applyStyle();
    applyFeatureStyle();
    applyFeatureFlags();
    bindSelect();
    syncSettingsPanel();
    tagTownPlayerList();
  }

  // Flip the classes before first paint so hidden elements never flash in.
  applyFeatureFlags();
  applyFeatureStyle();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Tagging scans every div, and this app mutates heavily during battles, so
  // coalesce bursts into a single pass. Deliberately not requestAnimationFrame:
  // that never fires while the tab is in the background, which would leave the
  // list untagged until the tab is focused again.
  let pending = false;
  function scheduleSync() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      onNavigate();
    }, 0);
  }

  // Observing childList only: the tagging writes attributes, so it can't
  // retrigger this observer and loop.
  const mo = new MutationObserver(scheduleSync);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  function onNavigate() {
    bindSelect();
    syncSettingsPanel();
    tagTownPlayerList();
  }

  for (const key of ["pushState", "replaceState"]) {
    const original = history[key];
    history[key] = function () {
      const result = original.apply(this, arguments);
      setTimeout(onNavigate, 60);
      return result;
    };
  }
  window.addEventListener("popstate", () => setTimeout(onNavigate, 60));

  window.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    // Don't hijack Alt+number while the user is typing in a field.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
    if (e.key === "2") setEnabled(true);
    if (e.key === "1") setEnabled(false);
  });
})();
