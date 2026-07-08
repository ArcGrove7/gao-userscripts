// ==UserScript==
// @name         Gun Art Online Eye-Care Theme
// @namespace    gunart-eyecare
// @version      1.0.1
// @description  Low-saturation dark eye-care theme (WCAG AA) for Gun Art Online. Standalone — no classifier.
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

  function boot() {
    applyStyle();
    bindSelect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  const mo = new MutationObserver(() => {
    if (document.querySelector(NATIVE_SELECT)) bindSelect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  for (const key of ["pushState", "replaceState"]) {
    const original = history[key];
    history[key] = function () {
      const result = original.apply(this, arguments);
      setTimeout(bindSelect, 60);
      return result;
    };
  }
  window.addEventListener("popstate", () => setTimeout(bindSelect, 60));

  window.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    // Don't hijack Alt+number while the user is typing in a field.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
    if (e.key === "2") setEnabled(true);
    if (e.key === "1") setEnabled(false);
  });
})();
