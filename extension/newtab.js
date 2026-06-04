/**
 * My Speed Dial — newtab.js (clean rewrite)
 * Tab-aware data model. Groups live inside tabs.
 */

/* ══ I18N ══ */
const SUPPORTED_LANGS = ['en', 'es', 'pt_BR', 'de', 'fr', 'ja', 'zh_CN'];
let _msgs = {};

function t(key) {
  return _msgs[key]?.message || key;
}
function getLocale() {
  const lang = localStorage.getItem('sdLang') || 'auto';
  if (lang === 'auto') return navigator.language || 'en';
  const map = { pt_BR: 'pt-BR', zh_CN: 'zh-CN' };
  return map[lang] || lang;
}
// t with substitution: tr('key', 'value') → replaces $1
function tr(key, ...args) {
  let msg = t(key);
  args.forEach((val, i) => { msg = msg.replace(`$${i + 1}`, val); });
  return msg;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (!msg || msg === el.dataset.i18n) return;
    // If element has child elements, update only the first text node
    if (el.children.length > 0) {
      const textNode = [...el.childNodes].find(n => n.nodeType === 3);
      if (textNode) textNode.textContent = msg;
    } else {
      el.textContent = msg;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
  document.querySelectorAll('[data-i18n-tip]').forEach(el => {
    const msg = t(el.dataset.i18nTip);
    if (msg && msg !== el.dataset.i18nTip) el.dataset.tip = msg;
  });
}

function resolveLocale(lang) {
  if (lang === 'auto') {
    const nav = navigator.language || 'en';
    // Try exact match first (e.g. pt-BR → pt_BR)
    const normalized = nav.replace('-', '_');
    if (SUPPORTED_LANGS.includes(normalized)) return normalized;
    // Try language-only match (e.g. pt → pt_BR)
    const base = nav.split('-')[0];
    const match = SUPPORTED_LANGS.find(l => l.startsWith(base));
    return match || 'en';
  }
  return SUPPORTED_LANGS.includes(lang) ? lang : 'en';
}

async function loadLang(lang) {
  const locale = resolveLocale(lang);
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const res  = await fetch(url);
    _msgs = await res.json();
  } catch(e) { _msgs = {}; }
  applyI18n();
  if (typeof updateCanvasCtxLabels === 'function') updateCanvasCtxLabels();
}

// Init language on load — store promise so UI can wait if needed
const _savedLang = localStorage.getItem('sdLang') || 'auto';
const _langReady = loadLang(_savedLang);

let _settingsPanelH = 0;
function getSettingsPanelH() {
  if (!_settingsPanelH) {
    const inner = document.querySelector('.global-settings__inner');
    _settingsPanelH = inner ? inner.offsetHeight + 48 : 420;
  }
  return _settingsPanelH;
}

/* ══ UTILS ══ */
// ── Lucide icon helper ─────────────────────────────────────────────────────
function LI(name, size, extra) {
  return (window.LucideIcons || {ic:()=>''}).ic(name, size, extra);
}

const uid       = () => Math.random().toString(36).slice(2, 10);
const getDomain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const getInit   = (t, u) => ((t?.trim()?.[0] || getDomain(u)?.[0] || '?')).toUpperCase();
const favSrc    = u => { try { return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(new URL(u).origin)}`; } catch { return null; } };
const stripProto = v => v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
const buildUrl   = v => v.trim() ? 'https://' + stripProto(v.trim()) : '';
const esc        = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');


/* ══ ICON URL CACHE (in-memory, session-scoped) ══
   Stores resolved URLs so same domain never fetches twice per session.
   Works with DOM cache above: img elements kept alive = no re-fetch at all.
════════════════════════════════════════════════════════════════════ */
const resolvedIcons = new Map(); // cacheKey → resolved src | 'error'

function setIconSrc(imgEl, cacheKey, primarySrc, fallbackSrc, letterFallbackFn) {
  const resolved = resolvedIcons.get(cacheKey);

  if (resolved && resolved !== 'error') {
    imgEl.src = resolved;
    imgEl.classList.add('loaded');
    return;
  }
  if (resolved === 'error') {
    imgEl.remove(); letterFallbackFn && letterFallbackFn(); return;
  }

  // Not yet resolved — fetch primary
  imgEl.src = primarySrc;
  imgEl.onload  = () => { resolvedIcons.set(cacheKey, primarySrc); imgEl.classList.add('loaded'); };
  imgEl.onerror = () => {
    if (fallbackSrc) {
      imgEl.src = fallbackSrc;
      imgEl.onload  = () => { resolvedIcons.set(cacheKey, fallbackSrc); imgEl.classList.add('loaded'); };
      imgEl.onerror = () => {
        resolvedIcons.set(cacheKey, 'error');
        imgEl.remove(); letterFallbackFn && letterFallbackFn();
      };
    } else {
      resolvedIcons.set(cacheKey, 'error');
      imgEl.remove(); letterFallbackFn && letterFallbackFn();
    }
  };
}

/* ══ STORAGE ══ */
const KEY = 'sdFinal1';

const DEFAULT_TABS = [];

let tabs = [];
let activeTabId = null;
function getActiveTab() { return tabs.find(t => t.id === activeTabId) || tabs[0]; }
function getGroups()    { return getActiveTab()?.groups || []; }

function load(cb) {
  chrome.storage.local.get(KEY, r => {
    if (chrome.runtime.lastError) {
      console.error('[load] storage error:', chrome.runtime.lastError.message);
      tabs = []; activeTabId = null;
      cb(); return;
    }
    const d = r[KEY];
    if (d?.tabs?.length) {
      tabs = d.tabs;
      activeTabId = d.activeTabId || tabs[0].id;
    } else {
      tabs = [];
      activeTabId = null;
    }
    cb();
  });
}
function save(cb) {
  chrome.storage.local.set({ [KEY]: { tabs, activeTabId } }, () => {
    if (chrome.runtime.lastError) {
      console.error('[save] storage error:', chrome.runtime.lastError.message);
      showToast(t('toastStorageError'), 'error');
    }
    if (cb) cb();
  });
}

// DOM cache — global so invalidateCache can reach it
const domCache = new Map(); // tabId → Map(gid → Element)

function invalidateCache(tabId) {
  if (tabId) domCache.delete(tabId);
  else domCache.clear();
}

/* ══ BODY REVEAL ══ */
// Failsafe: always show body after 2s no matter what
setTimeout(() => document.body.classList.add('is-ready'), 2000);

function revealBody() {
  document.body.classList.add('is-ready');
}

/* ══ THEME ══ */
const themeToggle = document.getElementById('themeToggle');

function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  themeToggle.innerHTML = dark ? iconSun() : iconMoon();
  themeToggle.dataset.tip = dark ? t('lightMode') : t('darkMode');
}
function iconMoon() { return LI("Moon", 20); }
function iconSun()  { return LI("Sun",  20); }

themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  localStorage.setItem('sdTheme', next);
  applyTheme(next);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('sdTheme')) applyTheme('auto');
});


/* ══ OPEN IN NEW TAB SETTING ════════════════════════════════════════════════ */
const NEW_TAB_KEY = 'sdNewTab';

function isNewTabEnabled() {
  return localStorage.getItem(NEW_TAB_KEY) === '1';
}

function applyNewTabToLinks() {
  const enabled = isNewTabEnabled();
  document.querySelectorAll('.list-item, .icon-item, .card-item').forEach(a => {
    if (enabled) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    else         { a.removeAttribute('target'); a.removeAttribute('rel'); }
  });
}

// Init toggle state on settings open
document.addEventListener('click', e => {
  const t = e.target.closest('#settingsBtn');
  if (!t) return;
  const cb = document.getElementById('settingsNewTab');
  if (cb) cb.checked = isNewTabEnabled();
});

// Handle toggle change
document.getElementById('settingsNewTab')?.addEventListener('change', function() {
  localStorage.setItem(NEW_TAB_KEY, this.checked ? '1' : '0');
  applyNewTabToLinks();
});


/* ══ BACKGROUND IMAGE ════════════════════════════════════════════════════════
   Uses IndexedDB to store the image blob (no 5MB localStorage limit).
   Brightness detection via Canvas → sets body[data-bg-dark] or body[data-bg-light].
════════════════════════════════════════════════════════════════════════════ */
(function() {
  const DB_NAME = 'sdBgDB', STORE = 'bg', KEY = 'wallpaper';
  let objectUrl = null;

  // ── IndexedDB helpers ──────────────────────────────────────────────────────
  function openDB(cb) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => cb(null, e.target.result);
    req.onerror   = e => cb(e.target.error);
  }
  function saveBlobToDB(blob, cb) {
    openDB((err, db) => {
      if (err) { cb(err); return; }
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, KEY);
      tx.oncomplete = () => cb(null);
      tx.onerror    = e => cb(e.target.error);
    });
  }
  function loadBlobFromDB(cb) {
    openDB((err, db) => {
      if (err) { cb(err); return; }
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = e => cb(null, e.target.result || null);
      req.onerror   = e => cb(e.target.error);
    });
  }
  function deleteBlobFromDB(cb) {
    openDB((err, db) => {
      if (err) { cb && cb(err); return; }
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => cb && cb(null);
    });
  }

  // ── Compress + brightness in one pass ────────────────────────────────────
  // Resizes to max 1920×1200, encodes as JPEG 85%, returns { blob, bright }.
  function processImage(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1920, MAX_H = 1200;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_W || h > MAX_H) {
        const r = Math.min(MAX_W / w, MAX_H / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // Brightness from 40×40 sample
      const s = document.createElement('canvas');
      s.width = 40; s.height = 40;
      const sCtx = s.getContext('2d', { willReadFrequently: true });
      sCtx.drawImage(c, 0, 0, 40, 40);
      const d = sCtx.getImageData(0, 0, 40, 40).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum += (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) / 255;
      const bright = sum / (d.length / 4);
      c.toBlob(compressed => cb(compressed || file, bright), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); cb(file, 0.5); };
    img.src = url;
  }

  // ── Apply bg to DOM ────────────────────────────────────────────────────────
  function applyBg(blob, bright, animate = false) {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    const page = document.querySelector('.page') || document.body;
    if (!blob) {
      page.style.backgroundImage    = '';
      page.style.backgroundSize     = '';
      page.style.backgroundPosition = '';
      document.documentElement.removeAttribute('data-bg');
      document.documentElement.removeAttribute('data-bg-bright');
      window._bgSampler?.load(null);
      return;
    }
    objectUrl = URL.createObjectURL(blob);

    const apply = () => {
      page.style.backgroundImage    = `url("${objectUrl}")`;
      page.style.backgroundSize     = 'cover';
      page.style.backgroundPosition = 'center';
      document.documentElement.setAttribute('data-bg', '1');
      document.documentElement.setAttribute('data-bg-bright', bright > 0.55 ? 'light' : 'dark');
      localStorage.setItem('sdBgBright', bright);
      window._bgSampler?.load(objectUrl);
      revealBody();
    };

    if (animate) {
      // Preload image first so bg + groups appear together
      const img = new Image();
      img.onload = apply;
      img.onerror = apply;
      img.src = objectUrl;
    } else {
      apply();
    }
  }

  function updateUI(hasImage) {
    const desc   = document.getElementById('bgDesc');
    const remove = document.getElementById('bgRemoveBtn');
    const choose = document.getElementById('bgChooseBtn');
    if (desc)   desc.textContent = hasImage ? t('bgImageSet') : t('noImage');
    if (remove) remove.hidden    = !hasImage;
    if (choose) choose.hidden    = hasImage;
  }

  // ── Boot: load saved image ─────────────────────────────────────────────────
  loadBlobFromDB((err, blob) => {
    if (blob) {
      const savedBright = parseFloat(localStorage.getItem('sdBgBright') || '0.5');
      applyBg(blob, savedBright, true);
      updateUI(true);
    } else {
      revealBody();
    }
  });

  // ── File input ────────────────────────────────────────────────────────────
  document.getElementById('bgFileInput')?.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    processImage(file, (compressed, bright) => {
      saveBlobToDB(compressed, err => {
        if (err) { console.error('BG save error:', err); return; }
        applyBg(compressed, bright, true);
        updateUI(true);
      });
    });
    this.value = '';
  });

  // ── Remove button ─────────────────────────────────────────────────────────
  document.getElementById('bgRemoveBtn')?.addEventListener('click', () => {
    deleteBlobFromDB(() => {
      applyBg(null, 0);
      updateUI(false);
      localStorage.removeItem('sdBgBright');
    });
  });
})();

/* ══ PER-WIDGET BG SAMPLER ══════════════════════════════════════════════════
   Offscreen canvas of the wallpaper used to detect per-widget brightness.
   Exposed as window._bgSampler so the bg IIFE above can call load().
════════════════════════════════════════════════════════════════════════════ */
window._bgSampler = (function() {
  let _canvas = null;
  let _ctx    = null;

  function load(blobUrl) {
    if (!blobUrl) { _canvas = null; _ctx = null; _refreshAll(); return; }
    const img = new Image();
    img.onload = () => {
      _canvas = document.createElement('canvas');
      _canvas.width = img.naturalWidth;
      _canvas.height = img.naturalHeight;
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
      _ctx.drawImage(img, 0, 0);
      _refreshAll();
    };
    img.src = blobUrl;
  }

  function _sampleEl(el) {
    if (!_canvas || !_ctx || !el.isConnected) return null;
    const page = document.querySelector('.page');
    if (!page) return null;
    const pr = page.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const iw = _canvas.width, ih = _canvas.height;
    // background-size: cover math
    const scale = Math.max(pr.width / iw, pr.height / ih);
    const ox = (pr.width  - iw * scale) / 2;
    const oy = (pr.height - ih * scale) / 2;
    const x  = Math.max(0, Math.round((er.left - pr.left - ox) / scale));
    const y  = Math.max(0, Math.round((er.top  - pr.top  - oy) / scale));
    const w  = Math.min(Math.round(er.width  / scale), iw - x);
    const h  = Math.min(Math.round(er.height / scale), ih - y);
    if (w <= 0 || h <= 0) return null;
    const d = _ctx.getImageData(x, y, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4)
      sum += (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) / 255;
    return sum / (d.length / 4);
  }

  function applyEl(el) {
    const isTitle      = el.classList.contains('group-title-item');
    const isGroupHdr   = el.classList.contains('group__header');
    const isIsland     = el.classList.contains('tabs') || el.classList.contains('header__actions') || el.classList.contains('tab--add');
    if (!el.isConnected || (!isTitle && !isGroupHdr && !isIsland && !el.hasAttribute('data-transparent'))) return;
    const bright = _sampleEl(el);
    if (bright === null) { el.removeAttribute('data-local-bg'); return; }
    const val = bright > 0.5 ? 'light' : 'dark';
    el.dataset.localBg = val;
    if (el._recolorLife) el._recolorLife(val === 'dark');
  }

  function _refreshAll() {
    document.querySelectorAll('.widget[data-transparent], .group-title-item, .group__header, .tabs, .header__actions, .tab--add, .new-group-ghost__btn').forEach(applyEl);
  }

  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(_refreshAll, 150);
  });

  return { load, applyEl, refreshAll: _refreshAll };
})();


/* ══ TABS ══ */
const tabsNav           = document.getElementById('tabsNav');
const renameTabOverlay  = document.getElementById('renameTabOverlay');
// "+" add-tab button lives outside .tabs, right after it
const tabAddBtn = (() => {
  const btn = document.createElement('button');
  btn.className = 'tab--add'; btn.dataset.tip = t('tooltipNewFolder'); btn.dataset.i18nTip = 'tooltipNewFolder';
  btn.innerHTML = `${LI("Plus",16)}`;
  btn.addEventListener('click', e => { e.stopPropagation(); showFolderPicker(); });
  tabsNav.insertAdjacentElement('afterend', btn);
  return btn;
})();

/* Tab (folder) context menu — built in JS using site-ctx style */
const ctxMenu = document.createElement('div');
ctxMenu.className = 'site-ctx'; ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);
const renameTabInput    = document.getElementById('renameTabInput');
const saveRenameTabBtn  = document.getElementById('saveRenameTabBtn');
const cancelRenameTabBtn= document.getElementById('cancelRenameTabBtn');
const closeRenameTabBtn = document.getElementById('closeRenameTabBtn');

let ctxTabId = null, renamingTabId = null;

// Sliding pill for tabs
let tabPill = null;

let _tabDragging = false;

function movePillToActive(instant = false) {
  if (_tabDragging) return;
  const activeBtn = tabsNav.querySelector('.tab.is-active');
  if (!activeBtn || !tabPill) return;
  if (instant) {
    tabPill.style.transition = 'none';
    tabPill.style.left  = activeBtn.offsetLeft + 'px';
    tabPill.style.width = activeBtn.offsetWidth + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      tabPill.style.transition = '';
    }));
  } else {
    tabPill.style.left  = activeBtn.offsetLeft + 'px';
    tabPill.style.width = activeBtn.offsetWidth + 'px';
  }
}

function checkTabsOverflow() {
  tabsNav.classList.toggle('tabs--overflow', tabsNav.scrollWidth > tabsNav.clientWidth + 2);
}

// ResizeObserver fires on every layout change — more reliable than window.resize
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { checkTabsOverflow(); movePillToActive(true); }).observe(tabsNav);
}
tabsNav.addEventListener('scroll', checkTabsOverflow);

function renderTabs() {
  // Create pill once
  if (!tabPill) {
    tabPill = document.createElement('div');
    tabPill.className = 'tabs__pill';
    tabsNav.appendChild(tabPill);
  }

  // Diff: remove buttons for tabs that no longer exist
  tabsNav.querySelectorAll('.tab').forEach(btn => {
    if (!tabs.find(t => t.id === btn.dataset.tabId)) btn.remove();
  });

  // Add/update buttons for each tab, preserving existing nodes
  tabs.forEach(tab => {
    let btn = tabsNav.querySelector(`.tab[data-tab-id="${tab.id}"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.tabId = tab.id;
      btn.addEventListener('click', () => {
        if (tab.id === activeTabId) return;
        activeTabId = tab.id;
        tabsNav.querySelectorAll('.tab').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        movePillToActive();
        save(); render();
        canvas.querySelectorAll('.group-wrap').forEach((wrap, i) => {
          wrap.style.animation = 'none';
          void wrap.offsetWidth;
          wrap.style.animation = '';
          wrap.style.animationDelay = `${i * 28}ms`;
          wrap.classList.remove('tab-switch-in');
          void wrap.offsetWidth;
          wrap.classList.add('tab-switch-in');
          wrap.addEventListener('animationend', () => {
            wrap.classList.remove('tab-switch-in');
            wrap.style.animationDelay = '';
          }, { once: true });
        });
      });
      btn.addEventListener('contextmenu', e => { e.preventDefault(); showTabCtx(e.clientX, e.clientY, tab.id); });
      tabsNav.appendChild(btn);
    }
    btn.textContent = tab.name;
    btn.classList.toggle('is-active', tab.id === activeTabId);
  });

  // Pill stays in DOM — just reposition it
  requestAnimationFrame(() => movePillToActive());

  // Overflow fade gradient
  checkTabsOverflow();
}

function showTabCtx(x, y, tabId) {
  closeAllDropdowns();
  ctxTabId = tabId;

  // Build menu fresh each time (so Delete is shown/hidden correctly)
  ctxMenu.innerHTML = '';

  const addGrpBtn = document.createElement('button');
  addGrpBtn.className = 'site-ctx__item';
  addGrpBtn.innerHTML = `${LI("SquarePlus",20)} ${t('addNewGroup')}`;
  addGrpBtn.addEventListener('click', () => { if (ctxTabId) activeTabId = ctxTabId; hideTabCtx(); showGroupPicker(); });
  ctxMenu.appendChild(addGrpBtn);

  const hr = document.createElement('hr'); hr.className = 'ctx-menu__divider';
  ctxMenu.appendChild(hr);

  const renameBtn = document.createElement('button');
  renameBtn.className = 'site-ctx__item';
  renameBtn.innerHTML = `${LI("Pencil",20)} ${t('renameFolder')}`;
  renameBtn.addEventListener('click', () => {
    renamingTabId = ctxTabId;
    const tab = tabs.find(t => t.id === renamingTabId);
    if (!tab) { hideTabCtx(); return; }
    renameTabInput.value = tab.name;
    renameTabOverlay.hidden = false;
    hideTabCtx();
    setTimeout(() => { renameTabInput.focus(); renameTabInput.select(); }, 50);
  });
  ctxMenu.appendChild(renameBtn);

  if (tabs.length > 1) {
    const delBtn = document.createElement('button');
    delBtn.className = 'site-ctx__item site-ctx__item--danger';
    delBtn.innerHTML = `${LI("Trash2",20)} ${t('deleteFolderMenu')}`;
    delBtn.addEventListener('click', () => {
      if (tabs.length <= 1) { hideTabCtx(); return; }
      const tabIdToDelete = ctxTabId;
      const folderName = tabs.find(t => t.id === tabIdToDelete)?.name || 'folder';
      hideTabCtx();
      showConfirm(
        tr('confirmDeleteFolderTitle', folderName),
        t('confirmDeleteFolderDesc'),
        t('delete'),
        () => {
          tabs = tabs.filter(t => t.id !== tabIdToDelete);
          if (activeTabId === tabIdToDelete) activeTabId = tabs[0].id;
          save(); renderTabs(); render();
          showToast(tr('toastDeletedFolder', folderName), 'delete');
        }
      );
    });
    ctxMenu.appendChild(delBtn);
  }

  ctxMenu.hidden = false;
  ctxMenu.style.left = Math.min(x, window.innerWidth  - 200) + 'px';
  ctxMenu.style.top  = Math.min(y, window.innerHeight - 150) + 'px';
}
function hideTabCtx() { ctxMenu.hidden = true; ctxTabId = null; }

function closeRenameTab() { closeOverlay(renameTabOverlay); }
function saveRenameTab() {
  const tab = tabs.find(t => t.id === renamingTabId);
  if (tab) tab.name = renameTabInput.value.trim() || tab.name;
  closeRenameTab(); save(); renderTabs();
}
saveRenameTabBtn.addEventListener('click', saveRenameTab);
cancelRenameTabBtn.addEventListener('click', closeRenameTab);
closeRenameTabBtn.addEventListener('click', closeRenameTab);
renameTabInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') saveRenameTab();
  if (e.key === 'Escape') closeRenameTab();
});
{ let _rd = false;
  renameTabOverlay.addEventListener('mousedown', e => { _rd = e.target === renameTabOverlay; });
  renameTabOverlay.addEventListener('mouseup',   e => { if (_rd && e.target === renameTabOverlay) closeRenameTab(); });
}

/* ══ AUTO-SCROLL DURING DRAG ══════════════════════════════════════════════
   Scrolls .group__body (vertical) and .canvas (horizontal) while dragging.
   Uses pointermove/dragover so it works with both native and fallback modes.
════════════════════════════════════════════════════════════════════════ */
(function() {
  const EDGE   = 64;   // px from edge to start scrolling
  const MAX_SP = 18;   // max scroll speed px/frame
  let rafId    = null;
  let clientX  = 0;
  let clientY  = 0;
  let active   = false;

  function speed(dist) {
    // dist = how far inside the edge zone (0 = at edge, EDGE = far inside)
    return Math.round(MAX_SP * Math.pow(1 - dist / EDGE, 2));
  }

  function tick() {
    if (!active) return;

    // ── vertical: scroll the group__body under cursor ─────────────────────
    const bodyEl = document.elementFromPoint(clientX, clientY)?.closest('.group__body');
    if (bodyEl) {
      const r = bodyEl.getBoundingClientRect();
      if (clientY < r.top + EDGE)    bodyEl.scrollTop -= speed(clientY - r.top);
      if (clientY > r.bottom - EDGE) bodyEl.scrollTop += speed(r.bottom - clientY);
    }

    // ── horizontal: scroll the canvas ─────────────────────────────────────
    const canvasEl = document.getElementById('canvas');
    if (canvasEl) {
      const r = canvasEl.getBoundingClientRect();
      if (clientX < r.left + EDGE)   canvasEl.scrollLeft -= speed(clientX - r.left);
      if (clientX > r.right - EDGE)  canvasEl.scrollLeft += speed(r.right - clientX);
    }

    rafId = requestAnimationFrame(tick);
  }

  function onMove(e) {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  // dragover fires continuously while dragging (native HTML5 drag)
  document.addEventListener('dragover',    onMove, { passive: true });
  // pointermove covers fallback/touch drag
  document.addEventListener('pointermove', onMove, { passive: true });

  document.addEventListener('dragstart', () => {
    active = true;
    rafId  = requestAnimationFrame(tick);
  });
  document.addEventListener('dragend', () => {
    active = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  });
  // Fallback drag events
  document.addEventListener('pointerdown', () => {
    // started by sortable-chosen → we start scroll loop on first move
  });
  document.addEventListener('pointerup', () => {
    active = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  });
})();

/* ══ SORTABLE DRAG & DROP (SortableJS) ══════════════════════════════
   KEY INSIGHT: All group bodies use the SAME sortable group 'sites'.
   We always render items as .site-item wrappers so SortableJS can
   drag ANY item into ANY container regardless of view type.
   After drop we sync data and re-render the target group only.
════════════════════════════════════════════════════════════════════ */

let groupSortable = null;
const bodySortables = new Map();

function addGroupWithAnim(wrap, snapshots) {
  // Phase 1: measure natural width, then collapse to 0 instantly
  const naturalWidth = wrap.offsetWidth;
  wrap.style.transition  = 'none';
  wrap.style.width       = '0';
  wrap.style.flexShrink  = '0';
  wrap.style.overflow    = 'hidden';
  wrap.style.opacity     = '0';
  wrap.style.transform   = 'scale(0.92)';
  wrap.style.transformOrigin = 'top center';

  // FLIP: animate other groups that shifted because of new wrap
  requestAnimationFrame(() => {
    canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
      if (w === wrap) return;
      const old = snapshots.get(w.dataset.wrapGid);
      if (!old) return;
      const now = w.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      w.style.transition = 'none';
      w.style.transform  = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        w.style.transition = 'transform 260ms cubic-bezier(0.25,0.46,0.45,0.94)';
        w.style.transform  = '';
      });
    });

    // Phase 1: expand width
    requestAnimationFrame(() => {
      wrap.style.transition = 'width 260ms cubic-bezier(0.25,0.46,0.45,0.94)';
      wrap.style.width      = naturalWidth + 'px';
    });
  });

  // Phase 2: after width expands, fade + scale in
  setTimeout(() => {
    wrap.style.transition = 'opacity 180ms ease, transform 200ms cubic-bezier(0.34,1.4,0.64,1)';
    wrap.style.opacity    = '1';
    wrap.style.transform  = 'scale(1)';

    const cleanup = () => {
      wrap.style.transition     = '';
      wrap.style.width          = '';
      wrap.style.flexShrink     = '';
      wrap.style.overflow       = '';
      wrap.style.opacity        = '';
      wrap.style.transform      = '';
      wrap.style.transformOrigin = '';
    };
    wrap.addEventListener('transitionend', e => {
      if (e.propertyName !== 'opacity') return;
      cleanup();
    }, { once: true });
    setTimeout(cleanup, 250);
  }, 260);
}

function deleteGroupWithAnim(gid, onCommit) {
  const wrap = canvas.querySelector(`.group-wrap[data-wrap-gid="${gid}"]`);
  if (!wrap) { onCommit(); return; }

  // Silent-close gwrap state without any slide animation
  if (wrap === _gwOpenWrap) {
    wrap.classList.remove('gw-open');
    const g = wrap.querySelector('.group');
    if (g) { g.style.transition = 'none'; g.style.transform = 'translateY(0)'; }
    _gwOpenWrap = null;
    document.body.classList.remove('gw-is-open');
  }

  wrap.style.pointerEvents = 'none';
  wrap.style.overflow = 'hidden';

  // Phase 1: fade + slight scale the whole wrap (settings panel included)
  wrap.style.transition = 'opacity 180ms ease, transform 200ms cubic-bezier(0.4,0,1,1)';
  wrap.style.transformOrigin = 'top center';
  wrap.style.opacity = '0';
  wrap.style.transform = 'scale(0.92)';

  // Phase 2: collapse width after fade
  setTimeout(() => {
    const w0 = wrap.offsetWidth;
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    wrap.style.width = w0 + 'px';
    wrap.style.flexShrink = '0';
    requestAnimationFrame(() => {
      wrap.style.transition = 'width 260ms cubic-bezier(0.4,0,0.2,1)';
      wrap.style.width = '0';
    });
  }, 180);

  // Phase 3: snapshot AFTER collapse, commit, then FLIP
  setTimeout(() => {
    const snapshots = new Map();
    canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
      if (w !== wrap) snapshots.set(w.dataset.wrapGid, w.getBoundingClientRect());
    });
    onCommit();
    requestAnimationFrame(() => {
      canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
        const old = snapshots.get(w.dataset.wrapGid);
        if (!old) return;
        const now = w.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        w.style.transition = 'none';
        w.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          w.style.transition = 'transform 320ms cubic-bezier(0.25,0.46,0.45,0.94)';
          w.style.transform = '';
        });
      });
    });
  }, 180 + 260);
}

function initGroupSortable() {
  if (groupSortable) { try { groupSortable.destroy(); } catch {} }
  groupSortable = Sortable.create(canvas, {
    animation: 220,
    handle: '.group__header',
    draggable: '.group-wrap',
    ghostClass: 'group-ghost',
    dragClass: 'group-drag',
    filter: '.new-group-ghost',
    direction: 'horizontal',
    group: { name: 'groups', pull: false, put: false },
    forceFallback: false,
    onEnd(evt) {
      // Check if dropped onto a tab button
      const x = evt.originalEvent?.clientX, y = evt.originalEvent?.clientY;
      if (x != null) {
        const el = document.elementFromPoint(x, y);
        const tabBtn = el?.closest('.tab:not(.tab--add):not(.is-active)');
        if (tabBtn) {
          const targetTabId = tabBtn.dataset.tabId;
          const targetTab = tabs.find(t => t.id === targetTabId);
          const srcTab = getActiveTab();
          const grp = srcTab?.groups[evt.oldIndex];
          if (grp && targetTab && srcTab) {
            const wrap = evt.item;
            const wRect = wrap.getBoundingClientRect();
            const tRect = tabBtn.getBoundingClientRect();
            const dx = (tRect.left + tRect.width / 2) - (wRect.left + wRect.width / 2);
            const dy = (tRect.top  + tRect.height / 2) - (wRect.top  + wRect.height / 2);

            // Snapshot sibling positions for FLIP after render
            const snapshots = new Map();
            canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
              if (w !== wrap) snapshots.set(w.dataset.wrapGid, w.getBoundingClientRect());
            });

            wrap.style.pointerEvents = 'none';
            wrap.style.transition = 'transform 480ms cubic-bezier(0.55,0,0.85,0.3), opacity 380ms ease-in';
            wrap.style.transformOrigin = 'center center';
            wrap.style.transform = `translate(${dx}px, ${dy}px) scale(0.06)`;
            wrap.style.opacity = '0';

            const onDone = (e) => {
              if (e.propertyName !== 'transform') return;
              wrap.removeEventListener('transitionend', onDone);
              srcTab.groups.splice(evt.oldIndex, 1);
              targetTab.groups.push(grp);
              getCacheForTab(activeTabId).delete(grp.id);
              save(); render();

              // FLIP remaining groups into their new positions
              requestAnimationFrame(() => {
                canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
                  const old = snapshots.get(w.dataset.wrapGid);
                  if (!old) return;
                  const now = w.getBoundingClientRect();
                  const fdx = old.left - now.left, fdy = old.top - now.top;
                  if (Math.abs(fdx) < 1 && Math.abs(fdy) < 1) return;
                  w.style.transition = 'none';
                  w.style.transform = `translate(${fdx}px, ${fdy}px)`;
                  requestAnimationFrame(() => {
                    w.style.transition = 'transform 380ms cubic-bezier(0.25,0.46,0.45,0.94)';
                    w.style.transform = '';
                  });
                });
                showToast(tr('toastMovedTo', targetTab.name), 'success');
              });
            };
            wrap.addEventListener('transitionend', onDone);
            return;
          }
        }
      }

      if (evt.oldIndex === evt.newIndex) return;
      const groups = getGroups();
      const [moved] = groups.splice(evt.oldIndex, 1);
      groups.splice(evt.newIndex, 0, moved);
      save();
    }
  });
}

function initTabsSortable() {
  Sortable.create(tabsNav, {
    animation: 200,
    draggable: '.tab:not(.tab--add)',
    filter: '.tabs__pill, .tab--add',
    ghostClass: 'tab-ghost',
    dragClass: 'tab-drag',
    direction: 'horizontal',
    group: { name: 'tabs', pull: false, put: false },
    onStart() {
      _tabDragging = true;
      if (tabPill) { tabPill.style.transition = 'none'; tabPill.style.opacity = '0'; }
    },
    onEnd(evt) {
      _tabDragging = false;
      if (evt.oldIndex === evt.newIndex) {
        if (tabPill) tabPill.style.opacity = '';
        requestAnimationFrame(() => movePillToActive(true));
        return;
      }
      // oldIndex/newIndex count ALL children including pill; adjust for pill at index 0
      const pillOffset = tabPill ? 1 : 0;
      const from = evt.oldIndex - pillOffset;
      const to   = evt.newIndex - pillOffset;
      if (from < 0 || to < 0) return;
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      save();
      requestAnimationFrame(() => {
        movePillToActive(true);
        if (tabPill) tabPill.style.opacity = '';
      });
    }
  });
}

function initAllBodySortables() {
  const currentGids = new Set();

  canvas.querySelectorAll('.group').forEach(groupEl => {
    const gid = groupEl.dataset.gid;
    if (!gid) return;
    currentGids.add(gid);

    const container = groupEl.querySelector('.icons-grid, .cards-list')
                   || groupEl.querySelector('.group__body');
    if (!container) return;
    container.dataset.gid = gid;

    // Reuse existing sortable if the container element hasn't changed
    const existing = bodySortables.get(gid);
    if (existing && existing.container === container) return;

    // Container changed (type switch) or new group — destroy old, create new
    if (existing) { try { existing.sortable.destroy(); } catch {} }

    const s = Sortable.create(container, {
      group: { name: 'sites', pull: true, put: true },
      animation: 200,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      chosenClass: 'sortable-chosen',
      swapThreshold: 0.55,
      emptyInsertThreshold: 24,
      forceFallback: false,
      filter: '.add-title-btn',

      onMove(evt) {
        const toGroup = getGroups().find(g => g.id === evt.to?.dataset.gid);
        if (!toGroup) return true;

        const drag = evt.dragged;
        const isWidget = drag.classList.contains('widget');
        const isSite = !isWidget && !drag.classList.contains('group-title-item');
        const targetType = toGroup.type;

        if (isWidget || drag.classList.contains('group-title-item')) {
          // Widgets and titles are always full-width in grid containers
          const clone = document.querySelector('.sortable-drag');
          [drag, clone].forEach(el => {
            if (!el) return;
            el.classList.remove('icons-grid__full', 'cards-list__full');
            if (targetType === 'icons') el.classList.add('icons-grid__full');
            if (targetType === 'cards') el.classList.add('cards-list__full');
          });
          return true;
        }

        if (!isSite) return true;

        // Update both the dragged element AND the floating clone (.sortable-drag)
        const clone = document.querySelector('.sortable-drag');

        // Update floating clone
        [drag, clone].forEach(el => {
          if (!el) return;
          el.classList.remove('list-item', 'icon-item', 'card-item');
          if (targetType === 'list')  el.classList.add('list-item');
          if (targetType === 'icons') el.classList.add('icon-item');
          if (targetType === 'cards') el.classList.add('card-item');
        });



        // Tag target container for CSS ghost only when crossing group types
        canvas.querySelectorAll('.group__body, .icons-grid, .cards-list').forEach(el => {
          delete el.dataset.dropType;
        });
        const fromGidMove = evt.from.dataset.gid;
        const toGidMove   = evt.to?.dataset.gid;
        if (evt.to && fromGidMove !== toGidMove) {
          evt.to.dataset.dropType = targetType;
        }

        return true;
      },

      onAdd(evt) {
        evt.item.classList.add('drop-in');
        evt.item.addEventListener('animationend', () => evt.item.classList.remove('drop-in'), { once: true });
      },

      onEnd(evt) {
        const fromGid = evt.from.dataset.gid;
        const toGid   = evt.to.dataset.gid;
        if (!fromGid || !toGid) return;

        const groups    = getGroups();
        const fromGroup = groups.find(g => g.id === fromGid);
        const toGroup   = groups.find(g => g.id === toGid);
        if (!fromGroup || !toGroup) return;

        // Sync data model to match what SortableJS already did in the DOM
        const site = fromGroup.sites[evt.oldIndex];
        if (!site) return;

        fromGroup.sites.splice(evt.oldIndex, 1);
        toGroup.sites.splice(evt.newIndex, 0, site);
        save();

        if (fromGid !== toGid) {
          const droppedEl = evt.item;
          const isWidget = droppedEl.classList.contains('widget');
          const isTitle  = droppedEl.classList.contains('group-title-item');

          // Helper — plays drop-in on any element
          const animateDropIn = el => {
            el.classList.remove('drop-in');
            void el.offsetWidth; // reflow
            el.classList.add('drop-in');
            el.addEventListener('animationend', () => el.classList.remove('drop-in'), { once: true });
          };

          if (isWidget || isTitle) {
            // Widgets and titles are always full-width — fix grid-spanning class
            droppedEl.classList.remove('icons-grid__full', 'cards-list__full');
            if (toGroup.type === 'icons') droppedEl.classList.add('icons-grid__full');
            if (toGroup.type === 'cards') droppedEl.classList.add('cards-list__full');
            animateDropIn(droppedEl);
            if (isWidget || isTitle) requestAnimationFrame(() => window._bgSampler?.applyEl(droppedEl));
          } else if (fromGroup.type !== toGroup.type) {
            // Rebuild item HTML for target view type, then animate
            const siteIndex = evt.newIndex;
            let replacement;
            if (toGroup.type === 'list')  replacement = buildListItem(site, toGid, siteIndex);
            if (toGroup.type === 'icons') replacement = buildIconItem(site, toGid, siteIndex);
            if (toGroup.type === 'cards') replacement = buildCardItem(site, toGid, siteIndex);
            if (replacement) {
              droppedEl.replaceWith(replacement);
              animateDropIn(replacement);
            }
          } else {
            // Same type, different group — animate the moved element
            animateDropIn(droppedEl);
          }

          // Update dataset fingerprints on both cached group elements
          const cache = getCacheForTab(activeTabId);
          [fromGid, toGid].forEach(gid => {
            const grp = getGroups().find(g => g.id === gid);
            const cachedEl = cache.get(gid);
            if (grp && cachedEl) {
              cachedEl.dataset.siteIds = grp.sites.map(s => s.id).join(',');
            }
          });
        }
      }
    });

    bodySortables.set(gid, { sortable: s, container });
  });

  // Destroy sortables for groups removed from the DOM
  for (const [gid, entry] of bodySortables) {
    if (!currentGids.has(gid)) {
      try { entry.sortable.destroy(); } catch {}
      bodySortables.delete(gid);
    }
  }
}

/* ══ RENDER ══ */
const canvas = document.getElementById('canvas');

function getCacheForTab(tabId) {
  if (!domCache.has(tabId)) domCache.set(tabId, new Map());
  return domCache.get(tabId);
}

function render({ importAnim = false, newGroupId = null } = {}) {
  const groups  = getGroups();
  const tabId   = activeTabId;
  const cache   = getCacheForTab(tabId);
  const groupIds = new Set(groups.map(g => g.id));
  let importIdx = 0;

  // Remove stale cached elements
  for (const [gid] of cache) {
    if (!groupIds.has(gid)) cache.delete(gid);
  }

  // Remove stale group-wraps (deleted groups) without clearing everything
  canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(wrap => {
    if (!groupIds.has(wrap.dataset.wrapGid)) wrap.remove();
  });

  // Ghost button is moved to end after wraps (not removed/re-created each render)

  groups.forEach(g => {
    let el = cache.get(g.id);
    if (el) {
      // Update name/emoji if changed
      const nameEl = el.querySelector('.group__name');
      if (nameEl && nameEl.textContent !== g.name) nameEl.textContent = g.name;

      // Rebuild body if type, sites, or display settings changed
      const curType     = el.dataset.type || '';
      const curSiteIds  = el.dataset.siteIds || '';
      const curSettings = el.dataset.settings || '';
      const newSiteIds  = g.sites.map(s => s.id).join(',');
      const newSettings = `${g.showUrl}|${g.showNames}|${g.showCardsUrl}`;
      if (curType !== g.type || curSettings !== newSettings) {
        // Full rebuild: type changed or display settings changed
        el.dataset.type     = g.type;
        el.dataset.siteIds  = newSiteIds;
        el.dataset.settings = newSettings;
        const body    = el.querySelector('.group__body');
        const newBody = buildGroupBody(g);
        if (body) body.replaceWith(newBody); else el.appendChild(newBody);

      } else if (curSiteIds !== newSiteIds) {
        // Only sites changed — try surgical insert/remove instead of full rebuild
        el.dataset.siteIds = newSiteIds;
        const oldIds = curSiteIds.split(',').filter(Boolean);
        const newIds = g.sites.map(s => s.id);

        const addedIds   = newIds.filter(id => !oldIds.includes(id));
        const removedIds = oldIds.filter(id => !newIds.includes(id));

        // Remove deleted items (already dissolved, so they might be gone)
        removedIds.forEach(id => {
          const gone = el.querySelector(`[data-sid="${id}"]`);
          if (gone) gone.remove();
        });

        if (addedIds.length > 0) {
          const body = el.querySelector('.group__body');
          if (!body) {
            // No body yet — full rebuild
            const newBody = buildGroupBody(g);
            el.appendChild(newBody);
          } else {
            // Find the container (grid for icons/cards, body itself for list)
            const container = body.querySelector('.icons-grid, .cards-list') || body;

            addedIds.forEach(addedId => {
              const site = g.sites.find(s => s.id === addedId);
              if (!site) return;

              // Build the correct element type
              let newEl;
              if (site.type === 'widget') {
                newEl = buildWidget(site, g.id);
                if (g.type === 'icons') newEl.classList.add('icons-grid__full');
                if (g.type === 'cards') newEl.classList.add('cards-list__full');
              } else if (site.type === 'title') {
                newEl = buildTitleItem(site, g.id);
                if (g.type === 'icons') newEl.classList.add('icons-grid__full');
                if (g.type === 'cards') newEl.classList.add('cards-list__full');
              } else {
                const idx = g.sites.indexOf(site);
                if (g.type === 'list')  newEl = buildListItem(site, g.id, idx);
                if (g.type === 'icons') newEl = buildIconItem(site, g.id, idx);
                if (g.type === 'cards') newEl = buildCardItem(site, g.id, idx);
              }
              if (!newEl) return;

              // Find correct position in container
              const siteIdx = g.sites.indexOf(site);
              // Find the next sibling already in the container
              let refNode = null;
              for (let i = siteIdx + 1; i < g.sites.length; i++) {
                const nextEl = container.querySelector(`[data-sid="${g.sites[i].id}"]`);
                if (nextEl) { refNode = nextEl; break; }
              }
              // If no next sibling, insert before the add-title button
              if (!refNode) refNode = container.querySelector('.group__add') || null;

              container.insertBefore(newEl, refNode);

              animateZoomIn(newEl);
            });
          }
        }
      }
    } else {
      el = buildGroup(g);
      el.dataset.type     = g.type;
      el.dataset.siteIds  = g.sites.map(s => s.id).join(',');
      el.dataset.settings = `${g.showUrl}|${g.showNames}|${g.showCardsUrl}`;
      cache.set(g.id, el);
    }
    // Wrap: settings panel (behind) + group (on top, slides down)
    let wrap = el._wrap;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'group-wrap';
      wrap.dataset.wrapGid = g.id;

      // Settings panel — dark, sits behind group
      const panel = document.createElement('div');
      panel.className = 'gwrap-settings';
      // Build panel DOM properly
      panel.innerHTML = '';

      // Header row
      const gwsHdr = document.createElement('div'); gwsHdr.className = 'gws__head';
      const gwsTitle = document.createElement('span'); gwsTitle.className = 'gws__title'; gwsTitle.textContent = t('groupSettingsTitle'); gwsTitle.dataset.i18n = 'groupSettingsTitle';
      const gwsActions = document.createElement('div'); gwsActions.style.cssText = 'display:flex;gap:.375rem;align-items:center';

      // Bin button (trash)
      const gwsDel = document.createElement('button'); gwsDel.className = 'gws__btn gws__del'; gwsDel.dataset.tip = t('tooltipDeleteGroup');
      gwsDel.innerHTML = `${LI("Trash2",16)}`;

      // Close button
      const gwsClose = document.createElement('button'); gwsClose.className = 'gws__btn gws__close'; gwsClose.dataset.tip = t('close');
      gwsClose.innerHTML = `${LI("X",16)}`;

      gwsActions.appendChild(gwsDel); gwsActions.appendChild(gwsClose);
      gwsHdr.appendChild(gwsTitle); gwsHdr.appendChild(gwsActions);
      panel.appendChild(gwsHdr);

      // Name row
      const gwsNameRow = document.createElement('div'); gwsNameRow.className = 'gws__name-row';
      const gwsNameIn = document.createElement('input'); gwsNameIn.className = 'gws__name-in';
      gwsNameIn.type = 'text'; gwsNameIn.value = g.name; gwsNameIn.placeholder = t('groupNamePlaceholder'); gwsNameIn.dataset.i18nPlaceholder = 'groupNamePlaceholder';
      gwsNameRow.appendChild(gwsNameIn);
      panel.appendChild(gwsNameRow);

      // View switcher
      const gwsSw = document.createElement('div'); gwsSw.className = 'gws__switcher';
      [
        ['list', `<svg viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="4" width="32" height="5" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="2" y="11.5" width="32" height="5" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="2" y="19" width="32" height="5" rx="2" fill="currentColor" opacity=".25"/>
        </svg>`, t('viewList')],
        ['icons', `<svg viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="13.5" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="25" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="2" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="13.5" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
          <rect x="25" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".25"/>
        </svg>`, t('viewIcons')],
        ['cards', `<svg viewBox="0 0 36 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:hidden">
          <rect x="2" y="2" width="14" height="13" rx="2" fill="currentColor" opacity=".3"/>
          <rect x="20" y="2" width="14" height="13" rx="2" fill="currentColor" opacity=".3"/>
          <rect x="2" y="17" width="14" height="13" rx="2" fill="currentColor" opacity=".15"/>
          <rect x="20" y="17" width="14" height="13" rx="2" fill="currentColor" opacity=".15"/>
        </svg>`, t('viewCards')],
      ].forEach(([type, icon, label]) => {
        const btn = document.createElement('button');
        btn.className = 'gws__sw' + (g.type === type ? ' on' : '');
        btn.dataset.v = type;
        const labelKey = type === 'list' ? 'viewList' : type === 'icons' ? 'viewIcons' : 'viewCards';
        btn.innerHTML = icon + `<span data-i18n="${labelKey}">${label}</span>`;
        gwsSw.appendChild(btn);
      });
      // Sliding pill inside switcher
      const gwsPill = document.createElement('div');
      gwsPill.className = 'gws__pill';
      gwsSw.appendChild(gwsPill);

      function moveGwsPill(targetBtn, instant) {
        const r = targetBtn.getBoundingClientRect();
        const p = gwsSw.getBoundingClientRect();
        if (instant) gwsPill.style.transition = 'none';
        gwsPill.style.width  = r.width  + 'px';
        gwsPill.style.height = r.height + 'px';
        gwsPill.style.transform = `translate(${r.left - p.left}px, ${r.top - p.top}px)`;
        if (instant) requestAnimationFrame(() => requestAnimationFrame(() => { gwsPill.style.transition = ''; }));
      }

      requestAnimationFrame(() => {
        const activeBtn = gwsSw.querySelector('.gws__sw.on');
        if (activeBtn) moveGwsPill(activeBtn, true);
      });

      panel.appendChild(gwsSw);

      // Show URL toggle
      const gwsRow = document.createElement('div'); gwsRow.className = 'gws__row';
      const gwsLbl = document.createElement('span'); gwsLbl.className = 'gws__lbl'; gwsLbl.textContent = t('groupShowUrl'); gwsLbl.dataset.i18n = 'groupShowUrl';
      const gwsToggle = document.createElement('button'); gwsToggle.className = 'gws__toggle' + (g.showUrl ? ' on' : '');
      gwsToggle.dataset.on = g.showUrl ? '1' : '0';
      gwsRow.appendChild(gwsLbl); gwsRow.appendChild(gwsToggle);
      gwsRow.style.display = g.type === 'list' ? 'flex' : 'none';
      panel.appendChild(gwsRow);
      // Panel events
      gwsClose.addEventListener('click', () => closeGwrap(wrap));
      gwsDel.addEventListener('click', () => {
        const tab = getActiveTab(), grp = tab?.groups.find(x=>x.id===g.id);
        showConfirm(tr('confirmDeleteGroupTitle', grp?.name), t('confirmDeleteGroupDesc'), t('delete'), () => {
          deleteGroupWithAnim(g.id, () => {
            if (tab) tab.groups = tab.groups.filter(x=>x.id!==g.id);
            getCacheForTab(activeTabId).delete(g.id);
            save(); render(); showToast(tr('toastDeletedGroup', grp?.name), 'delete');
          });
        });
      });
      gwsNameIn.addEventListener('input', () => {
        const grp = getActiveTab()?.groups.find(x=>x.id===g.id);
        if (grp && gwsNameIn.value.trim()) {
          grp.name = gwsNameIn.value.trim();
          const nameEl = wrap.querySelector('.group__name');
          if (nameEl) nameEl.textContent = grp.name;
        }
      });
      gwsNameIn.addEventListener('blur', () => {
        const grp = getActiveTab()?.groups.find(x=>x.id===g.id);
        if (grp && gwsNameIn.value.trim()) { grp.name = gwsNameIn.value.trim(); save(); }
      });
      gwsSw.querySelectorAll('.gws__sw').forEach(btn => {
        btn.addEventListener('click', () => {
          gwsSw.querySelectorAll('.gws__sw').forEach(b=>b.classList.remove('on'));
          btn.classList.add('on');
          moveGwsPill(btn, false);
          const grp = getActiveTab()?.groups.find(x=>x.id===g.id);
          if (!grp) return;
          grp.type = btn.dataset.v;
          // Show URL only for list, Show Names only for icons/cards
          gwsRow.style.display = grp.type === 'list' ? 'flex' : 'none';
          gwsNamesRow.style.display = (grp.type === 'icons' || grp.type === 'cards') ? 'flex' : 'none';
          const groupEl2 = wrap.querySelector('.group');
          if (groupEl2) {
            groupEl2.className = 'group group--' + grp.type;
            const body = groupEl2.querySelector('.group__body');
            if (body) {
              // Smooth: fade out → swap → fade in
              body.style.transition = 'opacity 150ms ease';
              body.style.opacity = '0';
              setTimeout(() => {
                // Preserve live widget elements to avoid re-init flicker
                const liveWidgets = new Map();
                body.querySelectorAll('.widget[data-sid]').forEach(w => liveWidgets.set(w.dataset.sid, w));
                const newBody = buildGroupBody(grp);
                newBody.querySelectorAll('.widget[data-sid]').forEach(w => {
                  const live = liveWidgets.get(w.dataset.sid);
                  if (live) w.replaceWith(live);
                });
                body.replaceWith(newBody);
                newBody.style.opacity = '0';
                newBody.style.transition = 'opacity 150ms ease';
                requestAnimationFrame(() => { newBody.style.opacity = '1'; });
                initAllBodySortables(); updateBodyGradients();
              }, 150);
            }
            groupEl2.dataset.type = grp.type;
          }
          // Update cached wrap's dataset.type so render() doesn't recreate the wrap
          const _gwCached = getCacheForTab(activeTabId).get(g.id);
          if (_gwCached) _gwCached.dataset.type = grp.type;
          save();
        });
      });
      // Show Names toggle (visible for icons + cards)
      const gwsNamesRow = document.createElement('div'); gwsNamesRow.className = 'gws__row';
      const gwsNamesLbl = document.createElement('span'); gwsNamesLbl.className = 'gws__lbl'; gwsNamesLbl.textContent = t('groupShowNames'); gwsNamesLbl.dataset.i18n = 'groupShowNames';
      const gwsNamesToggle = document.createElement('button');
      gwsNamesToggle.className = 'gws__toggle' + (g.showNames ? ' on' : '');
      gwsNamesToggle.dataset.on = g.showNames ? '1' : '0';
      gwsNamesRow.appendChild(gwsNamesLbl); gwsNamesRow.appendChild(gwsNamesToggle);
      // Only show for icons/cards
      gwsNamesRow.style.display = (g.type === 'icons' || g.type === 'cards') ? 'flex' : 'none';
      panel.insertBefore(gwsNamesRow, gwsRow);

      // Show/hide names row when view type changes
      const origSwClick = gwsSw.querySelectorAll('.gws__sw');
      // handled below in switcher click

      gwsNamesToggle.addEventListener('click', () => {
        const isOn2 = gwsNamesToggle.dataset.on === '1';
        gwsNamesToggle.dataset.on = isOn2 ? '0' : '1';
        gwsNamesToggle.classList.toggle('on', !isOn2);
        const grp = getActiveTab()?.groups.find(x=>x.id===g.id);
        if (!grp) return;
        grp.showNames = !isOn2;
        if (grp.type === 'cards') grp.showCardsUrl = grp.showNames;
        if (grp.type === 'icons') grp.showCardsUrl = grp.showNames;
        const groupEl2 = wrap.querySelector('.group');
        if (groupEl2) {
          groupEl2.classList.toggle('show-names', grp.showNames);
          const body = groupEl2.querySelector('.group__body');
          const newBody = buildGroupBody(grp);
          if (body) { body.replaceWith(newBody); initAllBodySortables(); updateBodyGradients(); }
          groupEl2.dataset.settings = (grp.showUrl||false)+'|'+(grp.showNames||false)+'|'+(grp.showCardsUrl||false);
        }
        getCacheForTab(activeTabId).delete(g.id); save();
      });

      // Toggle (button, not checkbox)
      gwsToggle.addEventListener('click', () => {
        const isOn = gwsToggle.dataset.on === '1';
        gwsToggle.dataset.on = isOn ? '0' : '1';
        gwsToggle.classList.toggle('on', !isOn);
        const grp = getActiveTab()?.groups.find(x=>x.id===g.id);
        if (!grp) return;
        grp.showUrl = !isOn;
        const groupEl2 = wrap.querySelector('.group');
        if (groupEl2) {
          const body = groupEl2.querySelector('.group__body');
          const newBody = buildGroupBody(grp);
          if (body) { body.replaceWith(newBody); initAllBodySortables(); updateBodyGradients(); }
          groupEl2.dataset.settings = grp.showUrl + '|' + (grp.showNames||false) + '|' + (grp.showCardsUrl||false);
        }
        getCacheForTab(activeTabId).delete(g.id);
        save();
      });

      wrap.appendChild(panel);  // panel behind
      wrap.appendChild(el);     // group on top
      el._wrap = wrap;
    }
    // Only insert new wraps (not yet in canvas) — in correct order relative to siblings
    if (!wrap.parentElement) {
      // Snapshot existing wraps BEFORE inserting so we can FLIP them
      const snapshots = new Map();
      canvas.querySelectorAll('.group-wrap[data-wrap-gid]').forEach(w => {
        snapshots.set(w.dataset.wrapGid, w.getBoundingClientRect());
      });

      // Find the next group's wrap that's already in canvas, insert before it
      const gIndex = groups.indexOf(g);
      let inserted = false;
      for (let i = gIndex + 1; i < groups.length; i++) {
        const nextEl   = cache.get(groups[i].id);
        const nextWrap = nextEl?._wrap;
        if (nextWrap && nextWrap.parentElement === canvas) {
          canvas.insertBefore(wrap, nextWrap);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        const ghostEl = canvas.querySelector('.new-group-ghost');
        canvas.insertBefore(wrap, ghostEl || null);
      }
      if (importAnim) {
        wrap.classList.add('group-wrap--import-in');
        wrap.style.animationDelay = `${importIdx * 60}ms`;
        importIdx++;
        wrap.addEventListener('animationend', () => {
          wrap.classList.remove('group-wrap--import-in');
          wrap.style.animationDelay = '';
        }, { once: true });
      } else if (newGroupId && g.id === newGroupId) {
        addGroupWithAnim(wrap, snapshots);
      }
    }
  });

  // Ghost + button — reuse existing or create once
  let ghost = canvas.querySelector('.new-group-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'new-group-ghost';
    const ghostBtn = document.createElement('button');
    ghostBtn.className = 'new-group-ghost__btn';
    ghostBtn.innerHTML = `${LI("Plus",16)}`;
    ghostBtn.dataset.tip = t('tooltipAddGroup');
    ghostBtn.dataset.i18nTip = 'tooltipAddGroup';
    ghostBtn.setAttribute('data-transparent', '');
    ghostBtn.addEventListener('click', showGroupPicker);
    ghost.appendChild(ghostBtn);
  }
  canvas.appendChild(ghost); // always move to end

  // Detect text overflow → add gradient mask only when needed
  requestAnimationFrame(() => {
    initAllBodySortables();
    canvas.classList.toggle('is-overflowing', canvas.scrollWidth > canvas.clientWidth + 4);
    updateBodyGradients();
  });
}


/* Build only the body part of a group (for incremental updates) */
function buildGroupBody(group) {
  const body = document.createElement('div');
  body.className = 'group__body';
  if (group.type === 'list'  && group.showUrl)      body.classList.add('show-url');
  if (group.type === 'icons' && group.showNames)    body.classList.add('show-names');
  if (group.type === 'cards' && group.showNames) body.classList.add('show-names');

  if (group.type === 'list') {
    let siteIndex = 0;
    group.sites.forEach((s) => {
      if (s.type === 'title') {
        body.appendChild(buildTitleItem(s, group.id));
      } else if (s.type === 'widget') {
        body.appendChild(buildWidget(s, group.id));
      } else {
        body.appendChild(buildListItem(s, group.id, siteIndex++));
      }
    });
    // Add title btn at end
    body.appendChild(buildAddTitleBtn(group.id));
  } else if (group.type === 'icons') {
    const grid = document.createElement('div');
    grid.className = 'icons-grid';
    grid.dataset.gid = group.id;
    let siteIndex = 0;
    group.sites.forEach((s) => {
      if (s.type === 'title') {
        const t = buildTitleItem(s, group.id);
        t.classList.add('icons-grid__full');
        grid.appendChild(t);
      } else if (s.type === 'widget') {
        const w = buildWidget(s, group.id);
        w.classList.add('icons-grid__full');
        grid.appendChild(w);
      } else {
        grid.appendChild(buildIconItem(s, group.id, siteIndex++));
      }
    });
    body.appendChild(grid);
    body.appendChild(buildAddTitleBtn(group.id));
  } else if (group.type === 'cards') {
    const list = document.createElement('div');
    list.className = 'cards-list';
    list.dataset.gid = group.id;
    let siteIndex = 0;
    group.sites.forEach((s) => {
      if (s.type === 'title') {
        const t = buildTitleItem(s, group.id);
        t.classList.add('cards-list__full');
        list.appendChild(t);
      } else if (s.type === 'widget') {
        const w = buildWidget(s, group.id);
        w.classList.add('cards-list__full');
        list.appendChild(w);
      } else {
        list.appendChild(buildCardItem(s, group.id, siteIndex++));
      }
    });
    body.appendChild(list);
    body.appendChild(buildAddTitleBtn(group.id));
  }
  return body;
}

/* ── Group ── */
function buildGroup(group) {
  const el = document.createElement('div');
  el.className = `group group--${group.type}`;
  el.dataset.gid = group.id;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'group__header';

  const left = document.createElement('div');
  left.className = 'group__header-left';

  const nameEl = document.createElement('span');
  nameEl.className = 'group__name'; nameEl.textContent = group.name;
  left.appendChild(nameEl);

  const actions = document.createElement('div');
  actions.className = 'group__header-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'group__header-add'; addBtn.dataset.tip = t('tooltipAddSite'); addBtn.dataset.i18nTip = 'tooltipAddSite';
  addBtn.innerHTML = `${LI("Plus",16)}`;
  addBtn.addEventListener('click', e => { e.stopPropagation(); showAddDropdown(e, group.id); });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'group__menu'; menuBtn.dataset.tip = t('settings'); menuBtn.dataset.i18nTip = 'settings';
  menuBtn.innerHTML = `${LI("Settings",16)}`;
  menuBtn.addEventListener('click', e => { e.stopPropagation(); const w=el._wrap; if(w) openGwrap(w); });

  actions.appendChild(addBtn); actions.appendChild(menuBtn);
  hdr.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    showGroupCtx(e, group.id);
  });
  hdr.appendChild(left); hdr.appendChild(actions);

  // Body
  const body = buildGroupBody(group);

  el.appendChild(hdr); el.appendChild(body);

  el.addEventListener('contextmenu', e => {
    if (e.target.closest('.list-item, .icon-item, .card-item, .widget, .group-title-item, .group__hdr')) return;
    e.preventDefault(); e.stopPropagation();
    showGroupCtx(e, group.id);
  });

  // Overflow detection + header bg sampling
  requestAnimationFrame(() => {
    if (nameEl.scrollWidth > nameEl.clientWidth) nameEl.classList.add('group__name--overflow');
    requestAnimationFrame(() => window._bgSampler?.applyEl(hdr));
  });

  return el;
}

/* ── Helpers ── */
function elDiv(cls)  { const e = document.createElement('div');  e.className = cls; return e; }
function elImg(cls)  { const e = document.createElement('img');  e.className = cls; return e; }
function elSpan(cls) { const e = document.createElement('span'); e.className = cls; return e; }
function elFb(cls, ch) { const e = elDiv(cls); e.textContent = ch; return e; }

function attachSiteCtx(el, gid, sid) {
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    // Resolve gid dynamically — element may have been dragged to another group
    const liveGid = el.closest('[data-gid]')?.dataset.gid || gid;
    showSiteCtx(e, liveGid, sid);
  });
}


/* ── TITLE item (section heading inside group) ── */
function buildTitleItem(item, gid) {
  const el = document.createElement('div');
  el.className = 'group-title-item';
  el.dataset.sid = item.id;
  el.textContent = item.text;
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    showTitleCtx(e, gid, item.id);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => window._bgSampler?.applyEl(el)));
  return el;
}

function buildAddTitleBtn(gid) {
  const el = document.createElement('div');
  el.className = 'add-title-btn';
  el.innerHTML = `<span data-i18n="addTitleShort">${t('addTitleShort')}</span>`;
  el.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openAddTitleModal(gid);
  });
  return el;
}

/* ── LIST item ── */
function buildListItem(site, gid, i) {
  const a = document.createElement('a');
  a.className = 'list-item'; a.href = site.url; a.style.animationDelay = `${i*18}ms`;
  a.dataset.sid = site.id;
  if (isNewTabEnabled()) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

  const fav = favSrc(site.url), ini = getInit(site.title, site.url);
  if (fav) {
    const img = elImg('list-item__fav'); img.src = fav; img.alt = '';
    img.onload  = () => img.classList.add('loaded');
    img.onerror = () => img.replaceWith(elFb('list-item__fav-fb', ini));
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
    a.appendChild(img);
  } else { a.appendChild(elFb('list-item__fav-fb', ini)); }

  const txt = elDiv('list-item__text');
  txt.innerHTML = `<p class="list-item__name">${esc(site.title||getDomain(site.url))}</p><p class="list-item__domain">${esc(getDomain(site.url))}</p>`;
  requestAnimationFrame(() => {
    const n = txt.querySelector('.list-item__name');
    if (n && n.scrollWidth > txt.clientWidth) txt.classList.add('list-item__text--overflow');
  });
  a.appendChild(txt);
  attachSiteCtx(a, gid, site.id);
  return a;
}

/* ── ICON item ── */
function buildIconItem(site, gid, i) {
  const a = document.createElement('a');
  a.className = 'icon-item'; a.href = site.url; a.style.animationDelay = `${i*18}ms`;
  a.dataset.sid = site.id;
  if (isNewTabEnabled()) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

  const ini = getInit(site.title, site.url), fav = favSrc(site.url);
  if (fav) {
    const img = elImg('icon-item__fav'); img.src = fav; img.alt = '';
    img.onload  = () => img.classList.add('loaded');
    img.onerror = () => img.replaceWith(elFb('icon-item__fav-fb', ini));
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
    a.appendChild(img);
  } else { a.appendChild(elFb('icon-item__fav-fb', ini)); }

  const nameEl = document.createElement('span'); nameEl.className = 'icon-item__name';
  nameEl.textContent = site.title || getDomain(site.url); a.appendChild(nameEl);

  attachSiteCtx(a, gid, site.id);
  return a;
}

/* ── CARD item ── */
function buildCardItem(site, gid, i) {
  const a = document.createElement('a');
  a.className = 'card-item'; a.href = site.url; a.style.animationDelay = `${i*18}ms`;
  a.dataset.sid = site.id;
  if (isNewTabEnabled()) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

  const ini = getInit(site.title, site.url), domain = getDomain(site.url);

  const thumb = elDiv('card-item__thumb');
  const img = document.createElement('img'); img.alt = site.title;
  const clearbitSrc = `https://logo.clearbit.com/${domain}`;
  const gFavSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  setIconSrc(img, 'logo_'+domain, clearbitSrc, gFavSrc, () => {
    img.remove(); thumb.classList.add('card-item__thumb--ph');
    const l = elSpan('card-item__letter'); l.textContent = ini; thumb.appendChild(l);
  });
  thumb.appendChild(img);

  const info = elDiv('card-item__info');
  const fav = favSrc(site.url);
  if (fav) {
    const fi = elImg('card-item__fav'); fi.src = fav; fi.alt = '';
    fi.onerror = () => fi.replaceWith(elFb('card-item__fav-fb', ini));
    info.appendChild(fi);
  } else { info.appendChild(elFb('card-item__fav-fb', ini)); }
  const txt = elDiv('card-item__text');
  txt.innerHTML = `<p class="card-item__name">${esc(site.title||domain)}</p><p class="card-item__domain">${esc(domain)}</p>`;
  info.appendChild(txt);

  a.appendChild(thumb); a.appendChild(info);
  attachSiteCtx(a, gid, site.id);
  return a;
}

/* ══ GROUP CONTEXT MENU ══ */
const groupCtxEl = document.createElement('div');
groupCtxEl.className = 'site-ctx'; groupCtxEl.hidden = true;
document.body.appendChild(groupCtxEl);
let groupCtxId = null;

function buildGroupCtxMenu(gid) {
  groupCtxEl.innerHTML = '';

  // Add website
  const addSiteBtn = document.createElement('button');
  addSiteBtn.className = 'site-ctx__item';
  addSiteBtn.innerHTML = `${LI("CirclePlus",20)} <span data-i18n="addWebsite">${t('addWebsite')}</span>`;
  addSiteBtn.addEventListener('click', () => { hideGroupCtx(); openSiteModal(gid); });
  groupCtxEl.appendChild(addSiteBtn);

  // Add widget
  const addWidgetBtn = document.createElement('button');
  addWidgetBtn.className = 'site-ctx__item';
  addWidgetBtn.innerHTML = `${LI("LayoutGrid",13)} <span data-i18n="addWidget">${t('addWidget')}</span>`;
  addWidgetBtn.addEventListener('click', () => { hideGroupCtx(); openWidgetPicker(gid); });
  groupCtxEl.appendChild(addWidgetBtn);

  // Divider
  const hr0 = document.createElement('hr'); hr0.className = 'ctx-menu__divider';
  groupCtxEl.appendChild(hr0);

  // Settings
  const sBtn = document.createElement('button');
  sBtn.className = 'site-ctx__item';
  sBtn.innerHTML = `${LI("Settings",13)} ${t('settings')}`;
  sBtn.addEventListener('click', () => { hideGroupCtx(); const w=canvas.querySelector(`.group[data-gid="${gid}"]`)?._wrap; if(w)openGwrap(w); });
  groupCtxEl.appendChild(sBtn);

  // Move to folder — only if more than 1 folder
  if (tabs.length > 1) {
    const moveWrap = document.createElement('div');
    moveWrap.className = 'site-ctx__item site-ctx__item--has-sub';
    moveWrap.innerHTML = `${LI("ChevronRight",13)} ${t('ctxMoveToFolder')}`;
    const sub = document.createElement('div');
    sub.className = 'site-ctx__submenu';
    tabs.filter(tab => tab.id !== activeTabId).forEach(tab => {
      const b = document.createElement('button');
      b.className = 'site-ctx__item';
      b.textContent = tab.name;
      b.addEventListener('click', () => {
        const srcTab = getActiveTab();
        const grp = srcTab?.groups.find(g => g.id === gid);
        if (!grp || !srcTab) return;
        srcTab.groups = srcTab.groups.filter(g => g.id !== gid);
        tab.groups.push(grp);
        hideGroupCtx();
        getCacheForTab(activeTabId).delete(gid);
        save(); renderTabs(); render();
        showToast(tr('toastMovedTo', tab.name), 'success');
      });
      sub.appendChild(b);
    });
    moveWrap.appendChild(sub);
    groupCtxEl.appendChild(moveWrap);
  }

  // Divider
  const hr = document.createElement('hr'); hr.className = 'ctx-menu__divider';
  groupCtxEl.appendChild(hr);

  // Delete
  const dBtn = document.createElement('button');
  dBtn.className = 'site-ctx__item site-ctx__item--danger';
  dBtn.innerHTML = `${LI("Trash2",13)} ${t('deleteGroup')}`;
  dBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    const grp = tab?.groups.find(g => g.id === gid);
    hideGroupCtx();
    showConfirm(
      tr('confirmDeleteGroupTitle', grp?.name || 'group'),
      t('confirmDeleteGroupDesc'),
      t('delete'),
      () => {
        deleteGroupWithAnim(gid, () => {
          if (tab) tab.groups = tab.groups.filter(g => g.id !== gid);
          getCacheForTab(activeTabId).delete(gid);
          save(); render();
          showToast(tr('toastDeletedGroup', grp?.name), 'delete');
        });
      }
    );
  });
  groupCtxEl.appendChild(dBtn);
}

function showGroupCtx(e, gid) {
  closeAllDropdowns();
  groupCtxId = gid;
  _langReady.then(() => {
    buildGroupCtxMenu(gid);
    groupCtxEl.hidden = false;
    groupCtxEl.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    groupCtxEl.style.top  = Math.min(e.clientY, window.innerHeight - 120) + 'px';
  });
}
function hideGroupCtx() { groupCtxEl.hidden = true; groupCtxId = null; }

// group ctx handlers built dynamically in buildGroupCtxMenu above

/* ══ SITE CONTEXT MENU ══ */
const siteCtxEl = document.createElement('div');
siteCtxEl.className = 'site-ctx'; siteCtxEl.hidden = true;
siteCtxEl.innerHTML = `
  <button class="site-ctx__item" id="sCtxNewTab">
    ${LI("ExternalLink",13)}
    <span data-i18n="ctxOpenNewTab">Open in new tab</span>
  </button>
  <button class="site-ctx__item" id="sCtxSettings">
    ${LI("Pencil",13)}
    <span data-i18n="ctxEdit">Edit</span>
  </button>
  <button class="site-ctx__item" id="sCtxDuplicate">
    ${LI("Copy",13)}
    <span data-i18n="ctxDuplicate">Duplicate</span>
  </button>
  <button class="site-ctx__item" id="sCtxCopy">
    ${LI("Copy",13)}
    <span data-i18n="ctxCopyUrl">Copy URL</span>
  </button>
  <button class="site-ctx__item site-ctx__item--danger" id="sCtxRemove">
    ${LI("Trash2",13)}
    <span data-i18n="ctxRemove">Remove</span>
  </button>
`;
document.body.appendChild(siteCtxEl);
let siteCtxGid = null, siteCtxSid = null;

function showSiteCtx(e, gid, sid) {
  closeAllDropdowns();
  siteCtxGid = gid; siteCtxSid = sid; siteCtxEl.hidden = false;
  siteCtxEl.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  siteCtxEl.style.top  = Math.min(e.clientY, window.innerHeight - 80) + 'px';
}
document.getElementById('sCtxNewTab').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === siteCtxGid);
  const s = g?.sites.find(x => x.id === siteCtxSid);
  if (s?.url) window.open(s.url, '_blank');
  siteCtxEl.hidden = true;
});
document.getElementById('sCtxSettings').addEventListener('click', () => {
  const gid = siteCtxGid, sid = siteCtxSid; siteCtxEl.hidden = true; openSiteSettings(gid, sid);
});
document.getElementById('sCtxCopy').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === siteCtxGid);
  const s = g?.sites.find(x => x.id === siteCtxSid);
  if (s?.url) { navigator.clipboard.writeText(s.url); showToast(t('toastUrlCopied'), 'success'); }
  siteCtxEl.hidden = true;
});
document.getElementById('sCtxDuplicate').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === siteCtxGid);
  const s = g?.sites.find(x => x.id === siteCtxSid);
  if (g && s) {
    const idx = g.sites.indexOf(s);
    const clone = JSON.parse(JSON.stringify(s));
    clone.id = uid();
    g.sites.splice(idx + 1, 0, clone);
    siteCtxEl.hidden = true;
    save(); render();
    showToast(t('toastDuplicated'), 'success');
  }
});
document.getElementById('sCtxRemove').addEventListener('click', () => {
  siteCtxEl.hidden = true;
  const sid = siteCtxSid, gid = siteCtxGid;
  const g0 = getGroups().find(x => x.id === gid);
  const siteName = g0?.sites.find(s => s.id === sid)?.title || 'Site';
  const itemEl = document.querySelector(`[data-sid="${sid}"]`);
  const doRemove = () => {
    const g = getGroups().find(x => x.id === gid);
    if (g) g.sites = g.sites.filter(s => s.id !== sid);
    save(); render();
    showToast(tr('toastRemovedSite', siteName), 'delete');
  };
  if (itemEl) dissolveElement(itemEl, doRemove);
  else doRemove();
});

/* ── Canvas background context menu ── */
const canvasCtxMenu = document.createElement('div');
canvasCtxMenu.className = 'site-ctx'; canvasCtxMenu.hidden = true;
document.body.appendChild(canvasCtxMenu);

const _ccAddGrp = document.createElement('button');
_ccAddGrp.id = 'ccAddGrp';
_ccAddGrp.className = 'site-ctx__item';
_ccAddGrp.addEventListener('click', () => { hideCanvasCtx(); showGroupPicker(); });
canvasCtxMenu.appendChild(_ccAddGrp);

const _ccHr = document.createElement('hr'); _ccHr.className = 'ctx-menu__divider';
canvasCtxMenu.appendChild(_ccHr);

const _ccSettings = document.createElement('button');
_ccSettings.id = 'ccSettings';
_ccSettings.className = 'site-ctx__item';
_ccSettings.addEventListener('click', () => { hideCanvasCtx(); openSettings(); });
canvasCtxMenu.appendChild(_ccSettings);

function updateCanvasCtxLabels() {
  _ccAddGrp.innerHTML  = `${LI("SquarePlus",20)} ${t('addNewGroup')}`;
  _ccSettings.innerHTML = `${LI("Settings",20)} ${t('settings')}`;
}
_langReady.then(updateCanvasCtxLabels);

function hideCanvasCtx() { canvasCtxMenu.hidden = true; }

document.addEventListener('contextmenu', e => {
  // Only on canvas background — skip groups, menus, modals, header
  if (e.target.closest('.group-wrap, .site-ctx, .modal, .overlay, .header, .global-settings')) return;
  // Must be inside the page area (not browser chrome)
  if (!e.target.closest('.page, .canvas')) return;
  e.preventDefault();
  closeAllDropdowns();
  canvasCtxMenu.hidden = false;
  canvasCtxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + 'px';
  canvasCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 100) + 'px';
});

/* Close all ctx menus on outside click */
document.addEventListener('click', e => {
  if (!ctxMenu.hidden       && !ctxMenu.contains(e.target))       hideTabCtx();
  if (!canvasCtxMenu.hidden && !canvasCtxMenu.contains(e.target)) hideCanvasCtx();
  if (!renameTabOverlay.hidden && !renameTabOverlay.contains(e.target)) {} // handled by mousedown
  if (!groupCtxEl.hidden && !groupCtxEl.contains(e.target)) hideGroupCtx();
  if (!siteCtxEl.hidden && !siteCtxEl.contains(e.target)) siteCtxEl.hidden = true;
  // Close all open GWS emoji grids when clicking outside

  // Close modal emoji grid when clicking outside

});

/* ══ PICKER SHARED UTILITIES ══ */

function makeClock() {
  return { id: uid(), type: 'widget', widget: 'clock', cfg: { zones: [{ label: 'Local', tz: Intl.DateTimeFormat().resolvedOptions().timeZone }], showDate: true, color: null } };
}

function importFolder(folder) {
  tabs.push(folder); activeTabId = folder.id; save();
  showToast(tr('toastFolderCreated', folder.name), 'success');
}

function buildTabsFolder(validTabs) {
  const folder = { id: uid(), name: t('openTabs'), groups: [] };
  const sites = [makeClock(), ...validTabs.map(t => ({ id: uid(), title: t.title || getDomain(t.url), url: t.url, thumb: '' }))];
  const type = sites.length > 10 ? 'icons' : 'list';
  folder.groups.push({ id: uid(), name: t('groupAllTabs'), type, showUrl: false, showNames: type === 'icons', showCardsUrl: type === 'icons', sites });
  return folder;
}

function buildAIFolder() {
  const folder = { id: uid(), name: 'AI Workspace', groups: [] };
  const clock = makeClock();
  AI_WORKSPACE_GROUPS.forEach((g, idx) => {
    const type = idx === 0 ? 'cards' : (idx % 2 === 1 ? 'list' : 'icons');
    const sites = g.sites.map(s => ({ id: uid(), title: s.title, url: s.url, thumb: '' }));
    if (idx === 0) sites.unshift(clock);
    folder.groups.push({ id: uid(), name: g.name, type, showUrl: false, showNames: type !== 'list', showCardsUrl: type !== 'list', sites });
  });
  return folder;
}

function buildBookmarkFolder(tree) {
  const folder = { id: uid(), name: t('folderBookmarks'), groups: [] };
  function collectSites(node, sites) {
    if (!node.children) return;
    node.children.filter(n => n.url).forEach(n => sites.push({ id: uid(), title: n.title || getDomain(n.url), url: n.url, thumb: '' }));
    node.children.filter(n => !n.url && n.children).forEach(sub => {
      const subSites = []; collectSites(sub, subSites);
      if (subSites.length > 0) { sites.push({ id: uid(), type: 'title', text: sub.title }); subSites.forEach(s => sites.push(s)); }
    });
  }
  const topFolders = tree[0]?.children || [];
  const othersLinks = [];
  topFolders.forEach(container => {
    if (!container.children) return;
    container.children.filter(n => n.url).forEach(n => othersLinks.push({ id: uid(), title: n.title || getDomain(n.url), url: n.url, thumb: '' }));
    container.children.filter(n => !n.url && n.children).forEach(sub => {
      const sites = []; collectSites(sub, sites);
      if (sites.length > 0) {
        const type = sites.filter(s => !s.type).length > 10 ? 'icons' : 'list';
        folder.groups.push({ id: uid(), name: sub.title || t('defaultFolder'), type, showUrl: false, showNames: type === 'icons', showCardsUrl: type === 'icons', sites });
      }
    });
  });
  if (othersLinks.length > 0) {
    const oType = othersLinks.length > 10 ? 'icons' : 'list';
    folder.groups.push({ id: uid(), name: t('bookmarkOthers'), type: oType, showUrl: false, showNames: oType === 'icons', showCardsUrl: oType === 'icons', sites: othersLinks });
  }
  if (folder.groups.length > 0) folder.groups[0].sites.unshift(makeClock());
  return folder;
}

function renderPickerCards(cardsEl, defs, onComplete) {
  defs.filter(Boolean).forEach((def, i) => {
    const btn = document.createElement('button');
    btn.className = 'ob-card';
    const favHtml = def.favUrls?.length
      ? `<div class="ob-card__favs">${def.favUrls.slice(0,5).map(u => { const s = favSrc(u); return s ? `<img class="ob-card__fav" src="${s}" alt="">` : ''; }).join('')}</div>`
      : '';
    btn.innerHTML = `${def.isEmpty ? '<div class="ob-card__plus">+</div>' : favHtml}<div class="ob-card__footer"><div class="ob-card__title">${def.title}</div><div class="ob-card__meta">${def.meta}</div></div>`;
    btn.addEventListener('click', () => { if (!def.action()) onComplete(); });
    cardsEl.appendChild(btn);
    setTimeout(() => { btn.classList.add('ob-card--visible'); btn.style.animationDelay = `${i * 80}ms`; }, 50);
  });
}

// Shared folder creator used by both showOnboarding and showFolderPicker
function showFolderCreator({ overlayId, cardsElId, emptyMeta, emptyName, animated, onComplete }) {
  const overlay = document.getElementById(overlayId);
  const cardsEl = document.getElementById(cardsElId);
  cardsEl.innerHTML = '';

  let tabsCard = null, bookmarksCard = null;
  let pending = 2;

  function tryBuild() {
    if (--pending > 0) return;
    const aiGroups = AI_WORKSPACE_GROUPS.length;
    const aiSites  = AI_WORKSPACE_GROUPS.reduce((s,g) => s + g.sites.length, 0);
    renderPickerCards(cardsEl, [
      tabsCard,
      bookmarksCard,
      {
        title: t('aiWorkspaceName'),
        meta: tr('aiWorkspaceMeta', aiGroups, aiSites),
        favUrls: ['https://claude.ai','https://chatgpt.com','https://perplexity.ai','https://cursor.com','https://midjourney.com'],
        action: () => { importFolder(buildAIFolder()); }
      },
      { title: t('startEmpty'), meta: emptyMeta, isEmpty: true, action: () => { importFolder({ id: uid(), name: emptyName, groups: [] }); } }
    ], onComplete);
  }

  if (chrome?.tabs) {
    chrome.tabs.query({}, chromeTabs => {
      const valid = chromeTabs.filter(t => t.url && !/^chrome/.test(t.url) && t.title);
      if (valid.length > 0) {
        tabsCard = { title: tr('importOpenTabs', valid.length), meta: t('currentlyOpen'), favUrls: valid.map(t => t.url), action: () => { importFolder(buildTabsFolder(valid)); } };
      }
      tryBuild();
    });
  } else { tryBuild(); }

  if (chrome?.bookmarks) {
    chrome.bookmarks.getTree(tree => {
      let folderCount = 0, bookmarkCount = 0;
      function walk(node) {
        if (node.children) { if (node.id !== '0' && node.id !== '1' && node.id !== '2' && node.title) folderCount++; node.children.forEach(walk); }
        else if (node.url) bookmarkCount++;
      }
      tree.forEach(walk);
      if (bookmarkCount > 0) {
        const bookmarkUrls = [];
        function collectUrls(node) { if (bookmarkUrls.length >= 5) return; if (node.url) bookmarkUrls.push(node.url); if (node.children) node.children.forEach(collectUrls); }
        tree.forEach(collectUrls);
        bookmarksCard = {
          title: tr('importBookmarks', bookmarkCount),
          meta: tr('importFolders', folderCount),
          favUrls: bookmarkUrls,
          action: () => {
            chrome.bookmarks.getTree(t2 => {
              const folder = buildBookmarkFolder(t2);
              if (folder.groups.length > 0) importFolder(folder);
              onComplete();
            });
            return true; // async — onComplete called inside callback
          }
        };
      }
      tryBuild();
    });
  } else { tryBuild(); }

  if (animated) {
    overlay.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));
  } else {
    overlay.hidden = false;
  }
}

// Build preview DOM for a given sites array and type
function buildPreviewEl(sites, type) {
  const wrap = document.createElement('div');
  wrap.className = 'ob-card__preview';
  const previewSites = sites.slice(0, type === 'icons' ? 12 : type === 'cards' ? 6 : 8);

  if (type === 'list') {
    previewSites.forEach(site => {
      const el = document.createElement('div');
      el.className = 'list-item';
      const ini = getInit(site.title, site.url);
      const fav = favSrc(site.url);
      if (fav) {
        const img = elImg('list-item__fav'); img.src = fav; img.alt = '';
        img.onload = () => img.classList.add('loaded');
        img.onerror = () => img.replaceWith(elFb('list-item__fav-fb', ini));
        el.appendChild(img);
      } else { el.appendChild(elFb('list-item__fav-fb', ini)); }
      const txt = elDiv('list-item__text');
      txt.innerHTML = `<p class="list-item__name">${esc(site.title || getDomain(site.url))}</p><p class="list-item__domain">${esc(getDomain(site.url))}</p>`;
      el.appendChild(txt);
      wrap.appendChild(el);
    });
  } else if (type === 'icons') {
    const grid = document.createElement('div');
    grid.className = 'icons-grid show-names';
    previewSites.forEach(site => {
      const el = document.createElement('div');
      el.className = 'icon-item';
      const ini = getInit(site.title, site.url);
      const fav = favSrc(site.url);
      if (fav) {
        const img = elImg('icon-item__fav'); img.src = fav; img.alt = '';
        img.onload = () => img.classList.add('loaded');
        img.onerror = () => img.replaceWith(elFb('icon-item__fav-fb', ini));
        el.appendChild(img);
      } else { el.appendChild(elFb('icon-item__fav-fb', ini)); }
      const nm = document.createElement('span'); nm.className = 'icon-item__name';
      nm.textContent = site.title || getDomain(site.url);
      el.appendChild(nm);
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
  } else if (type === 'cards') {
    const grid = document.createElement('div');
    grid.className = 'cards-list show-names';
    previewSites.forEach(site => {
      const el = document.createElement('div');
      el.className = 'card-item';
      const ini = getInit(site.title, site.url);
      const fav = favSrc(site.url);
      const thumb = elDiv('card-item__thumb');
      if (fav) {
        const img = elImg('card-item__fav'); img.src = fav; img.alt = '';
        img.onload = () => img.classList.add('loaded');
        img.onerror = () => img.replaceWith(elFb('card-item__fav-fb', ini));
        thumb.appendChild(img);
      } else { thumb.appendChild(elFb('card-item__fav-fb', ini)); }
      el.appendChild(thumb);
      const info = elDiv('card-item__info');
      info.innerHTML = `<p class="card-item__name">${esc(site.title || getDomain(site.url))}</p>`;
      el.appendChild(info);
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
  }

  return wrap;
}

function showGroupPicker() {
  const overlay = document.getElementById('groupPickerOverlay');
  const cardsEl = document.getElementById('groupPickerCards');
  cardsEl.innerHTML = '';

  let currentType = 'list';
  const cardRefs = []; // { btn, sites, isEmpty }

  function closeGroupPicker() {
    overlay.classList.remove('is-open');
    overlay.addEventListener('transitionend', () => { overlay.hidden = true; }, { once: true });
  }

  function addGroupWithCurrent(name, sites) {
    const tab = getActiveTab();
    if (!tab) return;
    const showN = currentType === 'icons' || currentType === 'cards';
    const newId = uid();
    tab.groups.push({
      id: newId, name, type: currentType,
      showUrl: false, showNames: showN, showCardsUrl: showN, sites
    });
    save(); render({ newGroupId: newId });
    showToast(tr('toastGroupAdded', name), 'add');
    requestAnimationFrame(() => { canvas.scrollLeft = canvas.scrollWidth; });
  }

  function updateAllPreviews() {
    cardRefs.forEach(({ btn, sites, isEmpty }) => {
      if (isEmpty) return;
      const old = btn.querySelector('.ob-card__preview');
      if (!old) { btn.appendChild(buildPreviewEl(sites, currentType)); return; }
      // Fade out → swap → fade in (same pattern as group settings)
      old.style.transition = 'opacity 150ms ease';
      old.style.opacity = '0';
      setTimeout(() => {
        const fresh = buildPreviewEl(sites, currentType);
        fresh.style.opacity = '0';
        fresh.style.transition = 'opacity 150ms ease';
        old.replaceWith(fresh);
        requestAnimationFrame(() => { fresh.style.opacity = '1'; });
      }, 150);
    });
  }

  // Insert type switcher into the section, before cardsEl (remove stale one first)
  const section = overlay.querySelector('.onboarding__section');
  const stale = section.querySelector('.gp-type-switcher');
  if (stale) stale.remove();
  const switcher = document.createElement('div');
  switcher.className = 'gp-type-switcher';
  [
    ['list',  `<svg viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="32" height="5" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="11.5" width="32" height="5" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="19" width="32" height="5" rx="2" fill="currentColor" opacity=".5"/></svg>`, 'viewList'],
    ['icons', `<svg viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/><rect x="13.5" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/><rect x="25" y="2" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/><rect x="13.5" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/><rect x="25" y="13.5" width="9" height="9" rx="2" fill="currentColor" opacity=".5"/></svg>`, 'viewIcons'],
    ['cards', `<svg viewBox="0 0 36 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:hidden"><rect x="2" y="2" width="14" height="13" rx="2" fill="currentColor" opacity=".5"/><rect x="20" y="2" width="14" height="13" rx="2" fill="currentColor" opacity=".5"/><rect x="2" y="17" width="14" height="13" rx="2" fill="currentColor" opacity=".15"/><rect x="20" y="17" width="14" height="13" rx="2" fill="currentColor" opacity=".15"/></svg>`, 'viewCards'],
  ].forEach(([type, icon, labelKey]) => {
    const b = document.createElement('button');
    b.className = 'gp-type-btn' + (type === 'list' ? ' on' : '');
    b.dataset.t = type;
    b.innerHTML = icon + `<span data-i18n="${labelKey}">${t(labelKey)}</span>`;
    b.addEventListener('click', () => {
      currentType = type;
      switcher.querySelectorAll('.gp-type-btn').forEach(x => x.classList.toggle('on', x === b));
      updateAllPreviews();
    });
    switcher.appendChild(b);
  });
  section.insertBefore(switcher, cardsEl);

  function buildCards(defs) {
    defs.filter(Boolean).forEach((def, i) => {
      const btn = document.createElement('button');
      btn.className = 'ob-card';

      const footer = document.createElement('div');
      footer.className = 'ob-card__footer';
      footer.innerHTML = `<div class="ob-card__title">${def.title}</div><div class="ob-card__meta">${def.meta}</div>`;

      if (def.isEmpty) {
        const plus = document.createElement('div');
        plus.className = 'ob-card__plus';
        plus.textContent = '+';
        btn.appendChild(footer);
        btn.appendChild(plus);
        cardRefs.push({ btn, sites: [], isEmpty: true });
      } else {
        const preview = buildPreviewEl(def.sites, currentType);
        btn.appendChild(footer);
        btn.appendChild(preview);
        cardRefs.push({ btn, sites: def.sites, isEmpty: false });
      }

      btn.addEventListener('click', () => {
        closeGroupPicker();
        def.action();
      });
      cardsEl.appendChild(btn);
      setTimeout(() => {
        btn.style.animationDelay = `${i * 80}ms`;
        btn.classList.add('ob-card--visible');
      }, 50);
    });
  }

  let tabsCard = null, topCard = null, historyCard = null;
  let pending = 2;

  function tryBuild() {
    pending--;
    if (pending > 0) return;
    const defs = [
      tabsCard,
      topCard,
      historyCard,
      {
        title: t('startEmpty'),
        meta: t('blankGroup'),
        isEmpty: true,
        sites: [],
        action: () => addGroupWithCurrent(t('newGroup'), [])
      }
    ].filter(Boolean);
    buildCards(defs);
  }

  if (chrome?.tabs) {
    chrome.tabs.query({}, chromeTabs => {
      const valid = chromeTabs.filter(t => t.url && !/^chrome/.test(t.url) && t.title);
      if (valid.length > 0) {
        const sites = valid.map(t => ({ id: uid(), title: t.title || getDomain(t.url), url: t.url, thumb: '' }));
        tabsCard = {
          title: tr('importOpenTabs', valid.length),
          meta: t('currentlyOpen'),
          sites,
          action: () => addGroupWithCurrent(t('openTabs'), sites)
        };
      }
      tryBuild();
    });
  } else {
    tryBuild();
  }

  if (chrome?.history) {
    chrome.history.search({ text: '', startTime: Date.now() - 30*24*60*60*1000, maxResults: 1000 }, items => {
      const domainMap = new Map();
      items.forEach(item => {
        try {
          const domain = getDomain(item.url);
          const v = item.visitCount || 1;
          const cur = domainMap.get(domain);
          if (!cur) domainMap.set(domain, { url: item.url, title: item.title || domain, visits: v });
          else cur.visits += v;
        } catch {}
      });
      const sorted = [...domainMap.values()].sort((a,b) => b.visits - a.visits).slice(0, 20);
      if (sorted.length > 0) {
        const sites = sorted.map(s => ({ id: uid(), title: s.title, url: s.url, thumb: '' }));
        topCard = {
          title: tr('importMostVisited', sorted.length),
          meta: t('topSitesCard'),
          sites,
          action: () => addGroupWithCurrent(t('topSites'), sites)
        };
      }

      chrome.history.search({ text: '', maxResults: 10000 }, allItems => {
        const seen = new Set(); const histSites = [];
        for (const item of allItems) {
          if (histSites.length >= 100) break;
          try {
            const domain = getDomain(item.url);
            if (!seen.has(domain) && item.title && !/^chrome/.test(item.url) && !/^about/.test(item.url)) {
              seen.add(domain);
              histSites.push({ id: uid(), title: item.title, url: item.url, thumb: '' });
            }
          } catch {}
        }
        if (histSites.length > 0) {
          historyCard = {
            title: tr('importRecentHistory', histSites.length),
            meta: t('recentlyVisited'),
            sites: histSites,
            action: () => addGroupWithCurrent(t('history'), histSites)
          };
        }
        tryBuild();
      });
    });
  } else {
    tryBuild();
  }

  overlay.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeGroupPicker();
  });
}

/* ══ ADD SITE MODAL ══ */
const siteOverlay    = document.getElementById('siteOverlay');
const closeSiteBtn   = document.getElementById('closeSiteBtn');
const cancelSiteBtn  = document.getElementById('cancelSiteBtn');
const confirmSiteBtn = document.getElementById('confirmSiteBtn');
const siteTitleIn    = document.getElementById('siteTitleIn');
const siteUrlIn      = document.getElementById('siteUrlIn');
const siteUrlIcon    = document.getElementById('siteUrlIcon');
const suggestionsList= document.getElementById('suggestionsList');
const suggestionsEl  = document.getElementById('suggestions');
const siteError      = document.getElementById('siteError');

let activeSiteGid = null;
let suggTabs = { tabs: [], history: [], popular: [] };
let suggActiveTab = 'tabs';

// Default globe SVG for URL icon
const globeSVG = `${LI("Globe",13)}`;

function updateUrlIcon(bare) {
  if (!bare.trim()) { siteUrlIcon.innerHTML = globeSVG; return; }
  const url = buildUrl(bare);
  try {
    const domain = new URL(url).hostname;
    const img = document.createElement('img');
    img.style.cssText = 'width:1rem;height:1rem;border-radius:3px;object-fit:contain';
    img.src = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`;
    img.onerror = () => { siteUrlIcon.innerHTML = globeSVG; };
    siteUrlIcon.innerHTML = '';
    siteUrlIcon.appendChild(img);
  } catch { siteUrlIcon.innerHTML = globeSVG; }
}

function autoFillTitle(bare) {
  if (siteTitleIn.value.trim()) return;
  try {
    const url = buildUrl(bare);
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Skip punycode (xn--) — these are IDN encoded domains, not human-readable
    if (hostname.split('.').some(p => p.startsWith('xn--'))) return;
    const part = hostname.split('.')[0];
    if (part.length < 2) return;
    siteTitleIn.value = part.charAt(0).toUpperCase() + part.slice(1);
  } catch {}
}

function makeFavFb(ini) {
  const d = document.createElement('div'); d.className = 'suggestion-item__fav-fb'; d.textContent = ini; return d;
}

function makeSuggestion(item) {
  const btn = document.createElement('button');
  btn.className = 'suggestion-item';
  btn.type = 'button';

  const fav = favSrc(item.url);
  const ini = getInit(item.title, item.url);
  if (fav) {
    const img = document.createElement('img');
    img.className = 'suggestion-item__fav'; img.src = fav; img.alt = '';
    img.onerror = () => img.replaceWith(makeFavFb(ini));
    btn.appendChild(img);
  } else { btn.appendChild(makeFavFb(ini)); }

  const txt = document.createElement('div'); txt.className = 'suggestion-item__text';
  txt.innerHTML = `<p class="suggestion-item__title">${esc(item.title || getDomain(item.url))}</p>
                   <p class="suggestion-item__url">${esc(getDomain(item.url))}</p>`;
  btn.appendChild(txt);

  if (item.visits > 1) {
    const badge = document.createElement('span');
    badge.className = 'suggestion-item__badge';
    badge.textContent = item.visits > 99 ? '99+' : item.visits;
    btn.appendChild(badge);
  }

  btn.addEventListener('click', () => {
    siteUrlIn.value = stripProto(item.url);
    siteTitleIn.value = item.title || '';
    updateUrlIcon(siteUrlIn.value);
    // Show tabs mode — full list of active tab, no filtering
    showSuggTabs();
    siteTitleIn.focus();
  });

  return btn;
}

function renderSuggTab(tab, query) {
  suggestionsList.innerHTML = '';
  const q = query.toLowerCase().trim();
  let items = suggTabs[tab] || [];
  if (q) {
    items = items.filter(s =>
      s.title?.toLowerCase().includes(q) || getDomain(s.url).toLowerCase().includes(q)
    );
  }
  items.forEach(s => suggestionsList.appendChild(makeSuggestion(s)));
}

function initSuggTabs() {
  const track = document.getElementById('suggPillTrack');
  const thumb  = document.getElementById('suggPillThumb');
  if (!track || !thumb) return;
  const btns = track.querySelectorAll('.pill-switcher__btn');

  function moveThumb(btn, instant = false) {
    if (instant) thumb.style.transition = 'none';
    thumb.style.width     = btn.offsetWidth + 'px';
    thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (instant) requestAnimationFrame(() => { thumb.style.transition = ''; });
  }

  // Called after data loads — update list, keep tabs always visible
  function refreshVisibility() {
    // Hide tabs with no data, but always show the suggestions block
    btns.forEach(btn => {
      const t = btn.dataset.tab;
      const hasData = suggTabs[t] && suggTabs[t].length > 0;
      btn.style.display = hasData ? '' : 'none';
    });
    suggestionsEl.hidden = false;

    // If current active tab has no data, switch to first visible tab
    const activeBtnEl = track.querySelector(`.pill-switcher__btn[data-tab="${suggActiveTab}"]`);
    if (!activeBtnEl || activeBtnEl.style.display === 'none') {
      const firstVisible = [...btns].find(b => b.style.display !== 'none');
      if (firstVisible) selectTab(firstVisible);
    } else {
      renderSuggTab(suggActiveTab, '');
      requestAnimationFrame(() => moveThumb(activeBtnEl, true));
    }
  }

  function selectTab(btn) {
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    suggActiveTab = btn.dataset.tab;
    moveThumb(btn);
    renderSuggTab(suggActiveTab, '');
  }

  // Attach listeners once only
  btns.forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn));
  });

  // Expose refreshVisibility globally so loadSuggestions can call it
  window._suggRefresh = refreshVisibility;
  window._suggMoveThumb = () => {
    const curBtn = track.querySelector(`.pill-switcher__btn[data-tab="${suggActiveTab}"]`);
    if (curBtn) moveThumb(curBtn, true);
  };
  window._suggSelectFirst = () => {
    const first = [...btns].find(b => b.style.display !== 'none');
    if (first) selectTab(first);
  };
}

function showSuggTabs() {
  // Show tabbed mode — tabs visible, render active tab unfiltered
  document.getElementById('suggTabsEl').hidden = false;
  renderSuggTab(suggActiveTab, '');
  if (window._suggMoveThumb) window._suggMoveThumb();
}

function filterSuggestions(query) {
  const q = query.trim();
  if (!q) {
    // No query — show tabs + list
    suggestionsEl.hidden = false;
    renderSuggTab(suggActiveTab, '');
    if (window._suggMoveThumb) window._suggMoveThumb();
  } else {
    // Has query — hide everything
    suggestionsEl.hidden = true;
  }
}

function loadSuggestions() {
  suggTabs = { tabs: [], history: [], popular: [] };
  const seen = new Set();

  chrome.tabs.query({}, chromeTabs => {
    chromeTabs
      .filter(t => t.url && !/^chrome/.test(t.url))
      .forEach(t => {
        const domain = getDomain(t.url);
        if (!seen.has(domain)) {
          seen.add(domain);
          suggTabs.tabs.push({ url: t.url, title: t.title || domain, visits: 0 });
        }
      });

    chrome.history.search({ text: '', startTime: Date.now() - 30*24*60*60*1000, maxResults: 500 }, items => {
      const domainMap = new Map();
      items.forEach(item => {
        try {
          const domain = getDomain(item.url);
          const cur = domainMap.get(domain);
          const v = item.visitCount || 1;
          if (!cur) domainMap.set(domain, { url: item.url, title: item.title || domain, visits: v });
          else cur.visits += v;
        } catch {}
      });

      const sorted = [...domainMap.values()].sort((a,b) => b.visits - a.visits);

      sorted.forEach(s => {
        if (!seen.has(getDomain(s.url)) && suggTabs.history.length < 50) {
          seen.add(getDomain(s.url));
          suggTabs.history.push(s);
        }
      });

      const popSeen = new Set();
      sorted.slice(0, 20).forEach(s => {
        const d = getDomain(s.url);
        if (!popSeen.has(d)) { popSeen.add(d); suggTabs.popular.push(s); }
      });

      if (window._suggRefresh) window._suggRefresh();
    });
  });
}

function openSiteModal(gid) {
  activeSiteGid = gid;
  siteTitleIn.value = ''; siteUrlIn.value = '';
  siteUrlIcon.innerHTML = globeSVG;
  siteError.hidden = true;
  suggActiveTab = 'tabs';
  suggestionsEl.hidden = false;
  suggestionsList.innerHTML = '';
  const suggTabsEl = document.getElementById('suggTabsEl');
  if (suggTabsEl) suggTabsEl.hidden = false;
  siteOverlay.hidden = false;
  loadSuggestions();
  siteUrlIn.focus();
}
function closeOverlay(overlay, cb) {
  if (overlay.hidden) { if (cb) cb(); return; }
  overlay.classList.add('is-closing');
  const modal = overlay.querySelector('.modal');
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    overlay.classList.remove('is-closing');
    overlay.hidden = true;
    if (cb) cb();
  };
  (modal || overlay).addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 200);
}
function closeSiteModal() { closeOverlay(siteOverlay, () => { activeSiteGid = null; }); }

siteUrlIn.addEventListener('input', () => {
  const v = siteUrlIn.value;
  if (/^https?:\/\//i.test(v)) siteUrlIn.value = stripProto(v);
  autoFillTitle(siteUrlIn.value);
  updateUrlIcon(siteUrlIn.value);
  filterSuggestions(siteUrlIn.value);
});
siteUrlIn.addEventListener('paste', e => {
  e.preventDefault();
  const p = (e.clipboardData||window.clipboardData).getData('text');
  siteUrlIn.value = stripProto(p.trim());
  autoFillTitle(siteUrlIn.value);
  updateUrlIcon(siteUrlIn.value);
  filterSuggestions(siteUrlIn.value);
});

function handleAddSite() {
  const title = siteTitleIn.value.trim(), url = buildUrl(siteUrlIn.value);
  siteError.hidden = true;
  if (!title) { siteError.textContent = t('siteErrorTitle'); siteError.hidden = false; siteTitleIn.focus(); return; }
  if (!url)   { siteError.textContent = t('siteErrorUrl');   siteError.hidden = false; siteUrlIn.focus(); return; }
  try { new URL(url); } catch { siteError.textContent = t('siteErrorUrlFormat'); siteError.hidden = false; return; }
  const groups = getGroups(), g = groups.find(x => x.id === activeSiteGid);
  if (g) { g.sites.unshift({ id: uid(), title, url, thumb: '' }); }
  save(); render(); closeSiteModal();
  showToast(tr('toastAddedSite', title), 'add');
}

closeSiteBtn.addEventListener('click', closeSiteModal);
cancelSiteBtn.addEventListener('click', closeSiteModal);
confirmSiteBtn.addEventListener('click', handleAddSite);
{ let _d = false;
  siteOverlay.addEventListener('mousedown', e => { _d = e.target === siteOverlay; });
  siteOverlay.addEventListener('mouseup',   e => { if (_d && e.target === siteOverlay) closeSiteModal(); });
}

/* ══ SITE SETTINGS ══ */
const siteSettingsOverlay   = document.getElementById('siteSettingsOverlay');
const closeSiteSettingsBtn  = document.getElementById('closeSiteSettingsBtn');
const cancelSiteSettingsBtn = document.getElementById('cancelSiteSettingsBtn');
const saveSiteSettingsBtn   = document.getElementById('saveSiteSettingsBtn');
const editSiteTitleIn       = document.getElementById('editSiteTitleIn');
const editSiteUrlIn         = document.getElementById('editSiteUrlIn');
const editSiteError         = document.getElementById('editSiteError');
let editSiteGid = null, editSiteSid = null;

function openSiteSettings(gid, sid) {
  const g = getGroups().find(x => x.id === gid);
  const s = g?.sites.find(x => x.id === sid); if (!s) return;
  editSiteGid = gid; editSiteSid = sid;
  editSiteTitleIn.value = s.title;
  editSiteUrlIn.value = stripProto(s.url);
  editSiteError.hidden = true;
  siteSettingsOverlay.hidden = false; editSiteTitleIn.focus();
}
function closeSiteSettings() { closeOverlay(siteSettingsOverlay); }

function handleSaveSite() {
  const title = editSiteTitleIn.value.trim(), url = buildUrl(editSiteUrlIn.value);
  editSiteError.hidden = true;
  if (!title) { editSiteError.textContent = t('siteErrorTitle'); editSiteError.hidden = false; return; }
  if (!url)   { editSiteError.textContent = t('siteErrorUrl');   editSiteError.hidden = false; return; }
  try { new URL(url); } catch { editSiteError.textContent = t('siteErrorUrlFormat'); editSiteError.hidden = false; return; }
  const g = getGroups().find(x => x.id === editSiteGid);
  const s = g?.sites.find(x => x.id === editSiteSid);
  if (s) { s.title = title; s.url = url; s.thumb = ''; }
  const _cached = getCacheForTab(activeTabId).get(editSiteGid);
  if (_cached) _cached.dataset.type = '';
  save(); render(); closeSiteSettings();
  showToast(t('toastSiteUpdated'), 'update');
}

saveSiteSettingsBtn.addEventListener('click', handleSaveSite);
closeSiteSettingsBtn.addEventListener('click', closeSiteSettings);
cancelSiteSettingsBtn.addEventListener('click', closeSiteSettings);
{ let _d = false;
  siteSettingsOverlay.addEventListener('mousedown', e => { _d = e.target === siteSettingsOverlay; });
  siteSettingsOverlay.addEventListener('mouseup',   e => { if (_d && e.target === siteSettingsOverlay) closeSiteSettings(); });
}
editSiteUrlIn.addEventListener('input', () => { if (/^https?:\/\//i.test(editSiteUrlIn.value)) editSiteUrlIn.value = stripProto(editSiteUrlIn.value); });
editSiteUrlIn.addEventListener('paste', e => { e.preventDefault(); editSiteUrlIn.value = stripProto((e.clipboardData||window.clipboardData).getData('text').trim()); });

/* ══ GLOBAL KEYBOARD ══ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSiteModal(); closeSiteSettings();
    closeRenameTab(); hideTabCtx(); groupCtxEl.hidden = true; siteCtxEl.hidden = true;
    // Overlays not previously covered
    if (document.body.classList.contains('analytics-open')) closeAnalytics();
    if (document.body.classList.contains('settings-open'))  closeSettings();
    if (!confirmOverlay.hidden)     { confirmCallback = null; closeOverlay(confirmOverlay); }
    if (!wPickerOverlay.hidden)     closeOverlay(wPickerOverlay);
    if (!wEditOverlay.hidden)       closeWidgetEditModal(true);
    if (!addTitleOverlay.hidden)    closeAddTitleModal();
  }
  if (e.key === 'Enter') {
    if (!siteOverlay.hidden) handleAddSite();
    if (!siteSettingsOverlay.hidden) handleSaveSite();
  }
});

/* sidebar removed */

/* ══ ANALYTICS ══ */
const analyticsBtn     = document.getElementById('analyticsBtn');
const closeAnalyticsBtn= document.getElementById('closeAnalyticsBtn');
const analyticsBody    = document.getElementById('analyticsBody');
const analyticsPeriods = document.getElementById('analyticsPeriods');

// Update tooltip data-tips with i18n
if (analyticsBtn) analyticsBtn.dataset.tip = t('tooltipAnalytics');

let activePeriodDays = 30;

// Cache: Map<startTime, { items, fetchedAt }>
const analyticsCache = new Map();
const ANALYTICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function fetchHistory(startTime, cb) {
  const cached = analyticsCache.get(startTime);
  if (cached && Date.now() - cached.fetchedAt < ANALYTICS_CACHE_TTL) {
    cb(cached.items);
    return;
  }
  chrome.history.search({ text: '', startTime, maxResults: 10000 }, items => {
    analyticsCache.set(startTime, { items, fetchedAt: Date.now() });
    cb(items);
  });
}

const globalAnalytics = document.getElementById('globalAnalytics');

function openAnalytics() {
  closeAllDropdowns();
  document.documentElement.style.setProperty('--panel-slide', '600px');
  document.body.classList.add('panel-open', 'analytics-open');
  document.body.classList.remove('settings-open');
  setTimeout(() => renderAnalytics(activePeriodDays), 320);
}
function closeAnalytics() {
  document.body.classList.remove('analytics-open', 'panel-open');
}

analyticsBtn.addEventListener('click', e => { e.stopPropagation(); openAnalytics(); });
closeAnalyticsBtn.addEventListener('click', closeAnalytics);
// Click on .page while a panel is open closes it
document.querySelector('.page')?.addEventListener('click', () => {
  if (document.body.classList.contains('analytics-open')) closeAnalytics();
  else if (document.body.classList.contains('settings-open')) closeSettings();
});

analyticsPeriods.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    analyticsPeriods.querySelectorAll('.period-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    activePeriodDays = parseInt(btn.dataset.days);
    renderAnalytics(activePeriodDays);
  });
});

function renderAnalytics(days) {
  // Don't clear — show skeleton instead to avoid height jump
  analyticsBody.style.minHeight = analyticsBody.offsetHeight > 0 ? analyticsBody.offsetHeight + 'px' : '';

  let startTime;
  if (days === 0) {
    startTime = 0;
  } else if (days === 1) {
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    startTime = yesterday.getTime();
  } else {
    startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  }

  fetchHistory(startTime, items => {
    const filtered = days === 1 ? items.filter(item => {
      const today = new Date(); today.setHours(0,0,0,0);
      return item.lastVisitTime < today.getTime();
    }) : items;

    let totalVisits = 0;
    const domainMap = new Map();
    const dayMap    = new Array(7).fill(0);
    const hourMap   = new Array(24).fill(0);

    filtered.forEach(item => {
      const visits = item.visitCount || 1;
      totalVisits += visits;
      try {
        const domain = new URL(item.url).hostname.replace(/^www\./, '');
        domainMap.set(domain, (domainMap.get(domain) || 0) + visits);
      } catch {}
      if (item.lastVisitTime) {
        const d = new Date(item.lastVisitTime);
        dayMap[d.getDay()] += visits;
        hourMap[d.getHours()] += visits;
      }
    });

    const topSites = [...domainMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,10);
    const maxSite  = topSites[0]?.[1] || 1;
    const maxDay   = Math.max(...dayMap) || 1;
    const maxHour  = Math.max(...hourMap) || 1;

    // Build content off-screen, then swap in one frame
    const frag = document.createDocumentFragment();

    // ── Stats row ── (label above value)
    const stats = document.createElement('div'); stats.className = 'analytics-stats';
    [[totalVisits.toLocaleString(), t('pageVisits')],[filtered.length.toLocaleString(), t('uniquePages')]].forEach(([val,lbl]) => {
      stats.innerHTML += `<div class="analytics-stat"><span class="analytics-stat__label">${lbl}</span><span class="analytics-stat__value">${val}</span></div>`;
    });
    frag.appendChild(stats);

    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = 'analytics-loading'; empty.textContent = t('activityNoData');
      frag.appendChild(empty);
      analyticsBody.innerHTML = '';
      analyticsBody.appendChild(frag);
      analyticsBody.style.minHeight = '';
      return;
    }

    // ── Main row: Left = Top Sites, Right = Day + Hour ──
    const mainRow = document.createElement('div'); mainRow.className = 'analytics-main-row';

    // Left column — Top Sites
    const sitesCol = document.createElement('div'); sitesCol.className = 'analytics-col analytics-card';
    const siteTitle = document.createElement('p'); siteTitle.className = 'analytics-section-title'; siteTitle.textContent = t('topSites');
    const chart = document.createElement('div'); chart.className = 'analytics-chart';
    topSites.forEach(([domain, count]) => {
      const pct = Math.round((count / maxSite) * 100);
      const row = document.createElement('div'); row.className = 'analytics-bar-row';
      row.innerHTML = `
        <img class="analytics-favicon" src="https://www.google.com/s2/favicons?domain=${esc(domain)}&sz=32" loading="lazy" onerror="this.style.visibility='hidden'" alt="">
        <span class="analytics-bar-label">${esc(domain)}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct}%"></div></div>
        <span class="analytics-bar-count">${count}</span>`;
      chart.appendChild(row);
    });
    sitesCol.append(siteTitle, chart);

    // Right column — Day + Hour stacked
    const rightCol = document.createElement('div'); rightCol.className = 'analytics-col analytics-card';

    // Activity by day — column chart
    const dayTitle = document.createElement('p'); dayTitle.className = 'analytics-section-title'; dayTitle.textContent = t('activityByDay');
    const daysEl = document.createElement('div'); daysEl.className = 'analytics-days';
    const _dayFmt = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' });
    const _dayLabels = [0,1,2,3,4,5,6].map(d => {
      const date = new Date(2024, 0, 7 + d); // Sun=Jan7, Mon=Jan8, ...
      return _dayFmt.format(date).replace(/\.$/, '');
    });
    _dayLabels.forEach((label, i) => {
      const pct = dayMap[i] / maxDay;
      const heightPct = Math.max(3, Math.round(pct * 100));
      const col = document.createElement('div'); col.className = 'analytics-day';
      col.innerHTML = `<div class="analytics-day__bar" style="height:${heightPct}%"></div><span class="analytics-day__label">${label}</span>`;
      col.querySelector('.analytics-day__bar').style.opacity = Math.max(0.12, pct).toFixed(2);
      daysEl.appendChild(col);
    });

    // Activity by hour — heatmap with larger cells
    const hourTitle = document.createElement('p'); hourTitle.className = 'analytics-section-title'; hourTitle.textContent = t('activityByHour');
    const HOUR_LABELS = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am',
                         '12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
    const hoursGrid = document.createElement('div'); hoursGrid.className = 'analytics-hours';
    hourMap.forEach((count, h) => {
      const cell = document.createElement('div'); cell.className = 'analytics-hour-cell';
      cell.style.opacity = Math.max(0.07, (count / maxHour) * 0.95).toFixed(2);
      cell.dataset.tip = `${HOUR_LABELS[h]}: ${count}`;
      hoursGrid.appendChild(cell);
    });
    const hl = document.createElement('div'); hl.className = 'analytics-hour-labels';
    hl.innerHTML = '<span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>';

    rightCol.append(dayTitle, daysEl, hourTitle, hoursGrid, hl);
    mainRow.append(sitesCol, rightCol);
    frag.appendChild(mainRow);

    // Swap content in one paint
    analyticsBody.innerHTML = '';
    analyticsBody.appendChild(frag);
    analyticsBody.style.minHeight = '';
  });
}


/* ══ TOAST ══ */
const toastContainer = document.getElementById('toastContainer');

// ── Tooltip ──
const tipEl = document.getElementById('tip');
let _tipTimer = null;
document.addEventListener('mouseover', e => {
  const target = e.target.closest('[data-tip]');
  if (!target) return;
  clearTimeout(_tipTimer);
  _tipTimer = setTimeout(() => {
    const r = target.getBoundingClientRect();
    tipEl.textContent = target.dataset.tip;
    tipEl.hidden = false;
    tipEl.classList.remove('tip--show');
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 7;
    if (y < 6) y = r.bottom + 7;
    x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
    tipEl.style.left = x + 'px';
    tipEl.style.top  = y + 'px';
    requestAnimationFrame(() => tipEl.classList.add('tip--show'));
  }, 400);
});
document.addEventListener('mouseout', e => {
  if (!e.target.closest('[data-tip]')) return;
  clearTimeout(_tipTimer);
  tipEl.classList.remove('tip--show');
  tipEl.hidden = true;
});
document.addEventListener('mousedown', () => {
  clearTimeout(_tipTimer);
  tipEl.classList.remove('tip--show');
  tipEl.hidden = true;
});
const TOAST_ICONS = {
  success: `${LI("Check",14)}`,
  error:   `${LI("AlertCircle",14)}`,
  info:    `${LI("Info",14)}`,
  delete:  `${LI("Trash2",14)}`,
  update:  `${LI("Pencil",14)}`,
  add:     `${LI("Plus",14)}`,
};
function showToast(msg, type = 'info', duration = 2800) {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<span class="toast__icon">${TOAST_ICONS[type]||TOAST_ICONS.info}</span><span>${esc(msg)}</span>`;
  toastContainer.appendChild(t);
  setTimeout(() => {
    t.classList.add('is-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, duration);
}

/* ══ CONFIRM MODAL ══ */
const confirmOverlay  = document.getElementById('confirmOverlay');
const confirmTitle    = document.getElementById('confirmTitle');
const confirmDesc     = document.getElementById('confirmDesc');
const confirmOkBtn    = document.getElementById('confirmOkBtn');
const confirmCancelBtn= document.getElementById('confirmCancelBtn');
let confirmCallback = null;

function showConfirm(title, desc, okLabel, cb) {
  confirmTitle.textContent = title;
  confirmDesc.textContent  = desc;
  confirmOkBtn.textContent = okLabel || 'Delete';
  confirmCallback = cb;
  confirmOverlay.hidden = false;
}
confirmOkBtn.addEventListener('click', () => {
  const cb = confirmCallback; confirmCallback = null;
  closeOverlay(confirmOverlay, () => { if (cb) cb(); });
});
confirmCancelBtn.addEventListener('click', () => {
  confirmCallback = null; closeOverlay(confirmOverlay);
});
{ let _cd = false;
  confirmOverlay.addEventListener('mousedown', e => { _cd = e.target === confirmOverlay; });
  confirmOverlay.addEventListener('mouseup',   e => { if (_cd && e.target === confirmOverlay) { confirmCallback = null; closeOverlay(confirmOverlay); }});
}

/* ══ SETTINGS MODAL ══ */
const settingsBtn      = document.getElementById('settingsBtn');
const globalSettings   = document.getElementById('globalSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsThemeBtns= document.getElementById('settingsThemeBtns');

// Update settings tooltip with i18n
if (settingsBtn) settingsBtn.dataset.tip = t('tooltipSettings');

function openSettings() {
  closeAllDropdowns();
  const cur = localStorage.getItem('sdTheme') || 'light';
  settingsThemeBtns.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('is-active', b.dataset.themeVal === cur));
  document.documentElement.style.setProperty('--panel-slide', getSettingsPanelH() + 'px');
  document.body.classList.add('panel-open', 'settings-open');
  document.body.classList.remove('analytics-open');
}
function closeSettings() {
  document.body.classList.remove('settings-open', 'panel-open');
}

settingsBtn.addEventListener('click', e => { e.stopPropagation(); openSettings(); });
closeSettingsBtn.addEventListener('click', closeSettings);

settingsThemeBtns.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.themeVal;
    localStorage.setItem('sdTheme', val);
    applyTheme(val);
    settingsThemeBtns.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('is-active', b.dataset.themeVal === val));
    showToast(`Theme: ${val}`, 'info');
  });
});



/* ══ LANGUAGE SELECT ══ */
const settingsLangSelect = document.getElementById('settingsLangSelect');
if (settingsLangSelect) {
  settingsLangSelect.value = _savedLang;
  settingsLangSelect.addEventListener('change', () => {
    const lang = settingsLangSelect.value;
    localStorage.setItem('sdLang', lang);
    loadLang(lang);
  });
}

/* ══ ADD TITLE MODAL ══ */
const addTitleOverlay   = document.getElementById('addTitleOverlay');
const addTitleInput     = document.getElementById('addTitleInput');
const saveAddTitleBtn   = document.getElementById('saveAddTitleBtn');
const cancelAddTitleBtn = document.getElementById('cancelAddTitleBtn');
const closeAddTitleBtn  = document.getElementById('closeAddTitleBtn');
let addTitleGid = null;

let addTitleMode = 'add', addTitleSid = null; // mode: 'add' | 'rename'

function openAddTitleModal(gid) {
  addTitleGid = gid; addTitleMode = 'add'; addTitleSid = null;
  addTitleInput.value = '';
  document.querySelector('#addTitleOverlay .modal__title').textContent = t('addSectionTitle');
  document.getElementById('saveAddTitleBtn').textContent = t('add');
  addTitleOverlay.hidden = false;
  requestAnimationFrame(() => addTitleInput.focus());
}
function openRenameTitleModal(gid, sid) {
  addTitleGid = gid; addTitleMode = 'rename'; addTitleSid = sid;
  const g = getGroups().find(x => x.id === gid);
  const item = g?.sites.find(s => s.id === sid);
  addTitleInput.value = item?.text || '';
  document.querySelector('#addTitleOverlay .modal__title').textContent = t('renameSectionTitle');
  document.getElementById('saveAddTitleBtn').textContent = t('save');
  addTitleOverlay.hidden = false;
  requestAnimationFrame(() => { addTitleInput.focus(); addTitleInput.select(); });
}
function closeAddTitleModal() { closeOverlay(addTitleOverlay, () => { addTitleGid = null; addTitleSid = null; }); }

function saveAddTitle() {
  const text = addTitleInput.value.trim();
  if (!text || !addTitleGid) return;
  const g = getGroups().find(x => x.id === addTitleGid);
  if (!g) return;
  if (addTitleMode === 'rename' && addTitleSid) {
    const item = g.sites.find(s => s.id === addTitleSid);
    if (item) {
      item.text = text;
      const _cached = getCacheForTab(activeTabId).get(addTitleGid);
      if (_cached) _cached.dataset.type = '';
      save(); render();
      showToast(t('toastTitleUpdated'), 'update');
    }
  } else {
    g.sites.push({ id: uid(), type: 'title', text });
    save(); render();
    showToast(t('toastTitleAdded'), 'add');
  }
  closeAddTitleModal();
}

saveAddTitleBtn.addEventListener('click', saveAddTitle);
cancelAddTitleBtn.addEventListener('click', closeAddTitleModal);
closeAddTitleBtn.addEventListener('click', closeAddTitleModal);
addTitleInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveAddTitle(); if (e.key === 'Escape') closeAddTitleModal(); });
{ let _at = false;
  addTitleOverlay.addEventListener('mousedown', e => { _at = e.target === addTitleOverlay; });
  addTitleOverlay.addEventListener('mouseup',   e => { if (_at && e.target === addTitleOverlay) closeAddTitleModal(); });
}

/* ── Title item context menu ── */
const titleCtxEl = document.createElement('div');
titleCtxEl.className = 'site-ctx'; titleCtxEl.hidden = true;
titleCtxEl.innerHTML = `
  <button class="site-ctx__item" id="tCtxRename">
    ${LI("Pencil",13)}
    <span data-i18n="rename">Rename</span>
  </button>
  <button class="site-ctx__item site-ctx__item--danger" id="tCtxRemove">
    ${LI("Trash2",13)}
    <span data-i18n="remove">Remove</span>
  </button>
`;
document.body.appendChild(titleCtxEl);
let titleCtxGid = null, titleCtxSid = null;

function showTitleCtx(e, gid, sid) {
  closeAllDropdowns();
  titleCtxGid = gid; titleCtxSid = sid; titleCtxEl.hidden = false;
  titleCtxEl.style.left = Math.min(e.clientX, window.innerWidth - 140) + 'px';
  titleCtxEl.style.top  = Math.min(e.clientY, window.innerHeight - 60) + 'px';
}
document.getElementById('tCtxRename').addEventListener('click', () => {
  titleCtxEl.hidden = true;
  openRenameTitleModal(titleCtxGid, titleCtxSid);
});
document.getElementById('tCtxRemove').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === titleCtxGid);
  const titleText = g?.sites.find(s => s.id === titleCtxSid)?.text || 'Title';
  if (g) { g.sites = g.sites.filter(s => s.id !== titleCtxSid); save(); render(); }
  titleCtxEl.hidden = true;
  showToast(tr('toastRemovedTitle', titleText), 'delete');
});
document.addEventListener('click', () => { titleCtxEl.hidden = true; });


/* ══ KEYBOARD NAV DETECTION ══ */
// Show focus ring only when navigating with keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Tab') document.body.classList.add('keyboard-nav');
});
document.addEventListener('mousedown', () => {
  document.body.classList.remove('keyboard-nav');
});

/* ══ CLOSE ALL DROPDOWNS ══ */
function closeAllDropdowns() {
  hideTabCtx();
  hideGroupCtx();
  hideCanvasCtx();
  siteCtxEl.hidden = true;
  if (typeof addDropEl !== 'undefined')       addDropEl.hidden = true;
  if (typeof titleCtxEl !== 'undefined')      titleCtxEl.hidden = true;
  if (typeof widgetCtxEl !== 'undefined')     widgetCtxEl.hidden = true;
}


let _gwOpenWrap = null;

document.addEventListener('click', e => {
  if (!_gwOpenWrap) return;
  if (!_gwOpenWrap.contains(e.target)) closeGwrap(_gwOpenWrap);
}, true);

function openGwrap(wrap) {
  closeAllDropdowns();
  canvas.querySelectorAll('.group-wrap.gw-open').forEach(w => { if (w !== wrap) closeGwrap(w); });
  const groupEl = wrap.querySelector('.group');
  const panel   = wrap.querySelector('.gwrap-settings');
  if (!panel || !groupEl) return;
  const OVERLAP = 24;
  const hasBg = document.documentElement.hasAttribute('data-bg');
  if (hasBg) {
    // Step 1: solidify group bg quickly
    wrap.classList.add('gw-solidifying');
    setTimeout(() => {
      // Step 2: show panel + slide down
      wrap.classList.remove('gw-solidifying');
      wrap.classList.add('gw-open');
      groupEl.style.transform = `translateY(${panel.scrollHeight - OVERLAP}px)`;
      _gwOpenWrap = wrap;
      document.body.classList.add('gw-is-open');
    }, 160);
  } else {
    wrap.classList.add('gw-open');
    groupEl.style.transform = `translateY(${panel.scrollHeight - OVERLAP}px)`;
    _gwOpenWrap = wrap;
    document.body.classList.add('gw-is-open');
  }
}
function closeGwrap(wrap) {
  wrap.classList.remove('gw-open');
  const groupEl = wrap.querySelector('.group');
  if (groupEl) groupEl.style.transform = 'translateY(0)';
  _gwOpenWrap = null;
  document.body.classList.remove('gw-is-open');
  if (document.documentElement.hasAttribute('data-bg')) {
    wrap.classList.add('gw-closing');
    setTimeout(() => {
      // Slide done: hide settings sharply first
      const panel = wrap.querySelector('.gwrap-settings');
      if (panel) { panel.style.transition = 'opacity 60ms ease'; panel.style.opacity = '0'; }
      // Then fade group bg to transparent
      setTimeout(() => {
        wrap.classList.remove('gw-closing');
        if (panel) { panel.style.transition = ''; panel.style.opacity = ''; }
      }, 60);
    }, 560);
  }
}


/* ══ DISSOLVE ANIMATION ══════════════════════════════════════════════════════
   Plays particle explosion + dissolve on an item, then calls onComplete.
════════════════════════════════════════════════════════════════════════════ */
function animateZoomIn(el) {
  if (!el) return;
  el.style.opacity        = '0';
  el.style.transform      = 'scale(0)';
  el.style.transformOrigin = 'top center';
  el.style.transition     = 'none';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 220ms ease, transform 380ms cubic-bezier(0.34,1.4,0.64,1)';
      el.style.opacity    = '1';
      el.style.transform  = 'scale(1)';
      el.addEventListener('transitionend', e => {
        if (e.propertyName !== 'transform') return;
        el.style.transition     = '';
        el.style.opacity        = '';
        el.style.transform      = '';
        el.style.transformOrigin = '';
      }, { once: true });
    });
  });
}

function dissolveElement(el, onComplete) {
  if (!el || !document.body.contains(el)) { onComplete?.(); return; }

  // Inverse zoom: scale 1 → 0 with slight wobble + fade
  el.style.transformOrigin = 'center center';
  el.style.transition = [
    'opacity 280ms ease',
    'transform 300ms cubic-bezier(0.4,0,0.8,0.6)',
    'max-height 320ms ease',
    'padding 320ms ease',
    'margin 320ms ease'
  ].join(', ');
  // store height for collapse
  el.style.maxHeight = el.offsetHeight + 'px';
  el.style.overflow  = 'hidden';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity   = '0';
      el.style.transform = 'scale(0) rotate(8deg)';
      el.style.maxHeight = '0';
      el.style.paddingTop    = '0';
      el.style.paddingBottom = '0';
      el.style.marginTop     = '0';
      el.style.marginBottom  = '0';
    });
  });

  // Fire onComplete after longest transition
  el.addEventListener('transitionend', function handler(e) {
    if (e.propertyName !== 'opacity') return;
    el.removeEventListener('transitionend', handler);
    onComplete?.();
  });
}

/* ══ ONBOARDING ══════════════════════════════════════════════════════════ */
const AI_WORKSPACE_GROUPS = [
  { name: 'General Assistants', sites: [
    { title: 'Claude',      url: 'https://claude.ai' },
    { title: 'ChatGPT',     url: 'https://chatgpt.com' },
    { title: 'Perplexity',  url: 'https://perplexity.ai' },
  ]},
  { name: 'Development', sites: [
    { title: 'Cursor',   url: 'https://cursor.com' },
    { title: 'Lovable',  url: 'https://lovable.dev' },
    { title: 'Replit',   url: 'https://replit.com' },
    { title: 'Base44',   url: 'https://base44.com' },
  ]},
  { name: 'Content Creation', sites: [
    { title: 'Manus AI',  url: 'https://manus.im' },
    { title: 'HeyGen',    url: 'https://heygen.com' },
    { title: 'Synthesia', url: 'https://synthesia.io' },
    { title: 'Descript',  url: 'https://descript.com' },
    { title: 'Opus Clip', url: 'https://opus.pro' },
    { title: 'Beehiiv',   url: 'https://beehiiv.com' },
  ]},
  { name: 'Productivity', sites: [
    { title: 'Grammarly',   url: 'https://grammarly.com' },
    { title: 'NotebookLM',  url: 'https://notebooklm.google.com' },
    { title: 'Otio AI',     url: 'https://otio.ai' },
    { title: 'Gamma',       url: 'https://gamma.app' },
    { title: 'Granola',     url: 'https://granola.so' },
    { title: 'Superhuman',  url: 'https://superhuman.com' },
    { title: 'Wispr Flow',  url: 'https://wispr.flow' },
  ]},
  { name: 'Creativity', sites: [
    { title: 'ElevenLabs', url: 'https://elevenlabs.io' },
    { title: 'Suno',        url: 'https://suno.com' },
    { title: 'Midjourney',  url: 'https://midjourney.com' },
    { title: 'Runway',      url: 'https://runwayml.com' },
    { title: 'Kling',       url: 'https://klingai.com' },
    { title: 'Pika Labs',   url: 'https://pika.art' },
    { title: 'Canva',       url: 'https://canva.com' },
    { title: 'Google Veo',  url: 'https://labs.google/veo' },
    { title: 'Higgsfield',  url: 'https://higgsfield.ai' },
  ]},
  { name: 'Automation & AI', sites: [
    { title: 'Softr',      url: 'https://softr.io' },
    { title: 'n8n',         url: 'https://n8n.io' },
    { title: 'Zapier',      url: 'https://zapier.com' },
    { title: 'Lindy AI',    url: 'https://lindy.ai' },
    { title: 'Claude Code', url: 'https://claude.ai/code' },
    { title: 'Chatbase',    url: 'https://chatbase.co' },
    { title: 'Gemini',      url: 'https://gemini.google.com' },
    { title: 'Notion AI',   url: 'https://notion.so' },
    { title: 'Aptly',       url: 'https://aptly.so' },
  ]},
];

function hideOnboarding() {
  document.getElementById('onboardingOverlay').hidden = true;
}

function finishOnboarding() {
  hideOnboarding();
  renderTabs();
  render({ importAnim: true });
  initGroupSortable(); // called once after first render
  initTabsSortable();  // drag-and-drop for folder tabs
  applyNewTabToLinks();
  initSuggTabs();
}

function showOnboarding() {
  showFolderCreator({
    overlayId:  'onboardingOverlay',
    cardsElId:  'onboardingCards',
    emptyMeta:  t('blankWorkspace'),
    emptyName:  t('mySpace'),
    animated:   false,
    onComplete: finishOnboarding
  });
}



function showFolderPicker() {
  showFolderCreator({
    overlayId:  'folderPickerOverlay',
    cardsElId:  'folderPickerCards',
    emptyMeta:  t('blankFolder'),
    emptyName:  t('newFolderName'),
    animated:   true,
    onComplete: () => { closeFolderPicker(); renderTabs(); render({ importAnim: true }); }
  });
}

function closeFolderPicker() {
  const overlay = document.getElementById('folderPickerOverlay');
  overlay.classList.remove('is-open');
  overlay.addEventListener('transitionend', () => { overlay.hidden = true; }, { once: true });
}

// Click overlay bg to close
document.getElementById('folderPickerOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('folderPickerOverlay')) closeFolderPicker();
});

/* ══ BOOT ══ */
applyTheme(localStorage.getItem('sdTheme') || 'light');
load(() => {
  if (tabs.length === 0) {
    showOnboarding();
  } else {
    renderTabs();
    render();
    initGroupSortable(); // called once — SortableJS dynamically tracks new .group-wrap elements
    initTabsSortable();
    applyNewTabToLinks();
    initSuggTabs();
    canvas.classList.add('page-load');
    canvas.addEventListener('animationend', () => canvas.classList.remove('page-load'), { once: true });
  }
});

// Reposition pill on resize
window.addEventListener('resize', () => movePillToActive(true));

// Gradient fade detection on group body scroll
document.addEventListener('scroll', e => {
  const el = e.target;
  if (el?.classList?.contains('group__body')) {
    const group = el.closest('.group');
    if (!group) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    group.classList.toggle('body-at-end', atEnd);
  }
}, true);

// After render, check which groups overflow
function updateBodyGradients() {
  document.querySelectorAll('.group').forEach(groupEl => {
    const body = groupEl.querySelector('.group__body');
    if (!body) return;
    const overflows = body.scrollHeight > body.clientHeight + 4;
    groupEl.classList.toggle('body-no-overflow', !overflows);
    groupEl.classList.toggle('body-at-end', !overflows);
  });
  // Check icon/card name overflow — center short, left+gradient for long
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.icon-item__name').forEach(el => {
      el.classList.toggle('is-overflow', el.scrollWidth > el.clientWidth + 1);
    });
    // card-item__name is inside card-item__info which may be display:none
    // temporarily show the parent info div to measure
    document.querySelectorAll('.card-item__name').forEach(el => {
      const info = el.closest('.card-item__info');
      if (info && getComputedStyle(info).display === 'none') {
        info.style.display = 'flex';
        info.style.visibility = 'hidden';
        el.classList.toggle('is-overflow', el.scrollWidth > el.clientWidth + 1);
        info.style.display = '';
        info.style.visibility = '';
      } else {
        el.classList.toggle('is-overflow', el.scrollWidth > el.clientWidth + 1);
      }
    });
  }));
}

/* ══════════════════════════════════════════════════
   ADD DROPDOWN  (+ button → Website | Widget)
══════════════════════════════════════════════════ */
const addDropEl = document.createElement('div');
addDropEl.className = 'add-drop'; addDropEl.hidden = true;
addDropEl.innerHTML = `
  <button class="add-drop__item" id="addDropSite">
    ${LI("CirclePlus",20)}
    <span class="add-drop__label" data-i18n="addWebsite">Add website</span>
  </button>
  <button class="add-drop__item" id="addDropWidget">
    ${LI("LayoutGrid",20)}
    <span class="add-drop__label" data-i18n="addWidget">Add widget</span>
  </button>
`;
document.body.appendChild(addDropEl);
let addDropGid = null;

function showAddDropdown(e, gid) {
  closeAllDropdowns();
  addDropGid = gid;
  addDropEl.hidden = false;
  const r = e.target.getBoundingClientRect();
  addDropEl.style.left = r.left + 'px';
  addDropEl.style.top  = (r.bottom + 4) + 'px';
}
document.getElementById('addDropSite').addEventListener('click', () => {
  addDropEl.hidden = true; openSiteModal(addDropGid);
});
document.getElementById('addDropWidget').addEventListener('click', () => {
  addDropEl.hidden = true; openWidgetPicker(addDropGid);
});
document.addEventListener('click', e => {
  if (!addDropEl.hidden && !addDropEl.contains(e.target)) addDropEl.hidden = true;
});

/* ══════════════════════════════════════════════════
   WIDGET PICKER MODAL
══════════════════════════════════════════════════ */
const WIDGET_TYPES = [
  { key: 'clock',    labelKey: 'widgetClockLabel',    icon: '🕐', descKey: 'widgetClockDesc' },
  { key: 'weather',  labelKey: 'widgetWeatherLabel',  icon: '🌤', descKey: 'widgetWeatherDesc' },
  { key: 'pantone',  labelKey: 'widgetPantoneLabel',  icon: '🎨', descKey: 'widgetPantoneDesc' },
  { key: 'stocks',   labelKey: 'widgetStocksLabel',   icon: '📈', descKey: 'widgetStocksDesc' },
  { key: 'activity', labelKey: 'widgetActivityLabel', icon: '⬛', descKey: 'widgetActivityDesc' },
  { key: 'life',     labelKey: 'widgetLifeLabel',     icon: '🗓', descKey: 'widgetLifeDesc' },
];

let widgetPickerGid = null;
const wPickerOverlay = document.createElement('div');
wPickerOverlay.className = 'overlay'; wPickerOverlay.hidden = true;
wPickerOverlay.innerHTML = `
  <div class="modal modal--widget-picker">
    <div class="modal__header">
      <h2 class="modal__title" data-i18n="addWidget">${t('addWidget')}</h2>
      <button class="modal__close" id="closeWPickerBtn">
        ${LI("X",14)}
      </button>
    </div>
    <div class="modal__body widget-picker-grid" id="wPickerGrid"></div>
  </div>`;
document.body.appendChild(wPickerOverlay);

document.getElementById('closeWPickerBtn').addEventListener('click', () => { closeOverlay(wPickerOverlay); });
wPickerOverlay.addEventListener('mousedown', e => { if (e.target === wPickerOverlay) closeOverlay(wPickerOverlay); });

function makeWidgetPreview(key) {
  const wrap = document.createElement('div');
  wrap.className = 'widget-picker-preview';

  if (key === 'clock') {
    const now = new Date();
    const time = now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
    const date = now.toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
    wrap.innerHTML = `
      <div class="w-clock__time">${time}</div>
      <div class="w-clock__date">${date}</div>
      <div class="w-clock__zones">
        <div class="w-clock__zone"><span class="w-clock__zone-label">NY</span><span class="w-clock__zone-time">09:41</span></div>
        <div class="w-clock__zone"><span class="w-clock__zone-label">London</span><span class="w-clock__zone-time">14:41</span></div>
      </div>`;
    // live tick
    const ticker = setInterval(() => {
      if (!document.body.contains(wrap)) { clearInterval(ticker); return; }
      const n = new Date();
      const timeStr = n.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateStr2 = n.toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
      wrap.querySelector('.w-clock__time').textContent = timeStr;
      wrap.querySelector('.w-clock__date').textContent = dateStr2;
    }, 1000);

  } else if (key === 'weather') {
    wrap.innerHTML = `
      <div class="w-weather__row">
        <div class="w-weather__main">
          <div class="w-weather__temp">18°C</div>
          <div class="w-weather__feels">Feels like 16°</div>
        </div>
        <div class="w-weather__icon">🌤</div>
      </div>
      <div class="w-weather__meta">
        <span>💧 62%</span>
        <span>💨 14 km/h</span>
        <span>📍 Warsaw</span>
      </div>`;

  } else if (key === 'pantone') {
    const p = PANTONE_COLORS[Math.floor(Math.random() * PANTONE_COLORS.length)];
    const r=parseInt(p.hex.slice(1,3),16), g=parseInt(p.hex.slice(3,5),16), b=parseInt(p.hex.slice(5,7),16);
    const lum = (0.299*r+0.587*g+0.114*b)/255;
    const tc = lum > 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    const tc2 = lum > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
    wrap.style.background = p.hex;
    wrap.style.color = tc;
    wrap.innerHTML = `
      <div class="w-pantone__body" style="margin-top:auto">
        <div class="w-pantone__pantone" style="color:${tc2}">PANTONE®</div>
        <div class="w-pantone__name">${p.name}</div>
        <div class="w-pantone__hex" style="color:${tc2}">${p.hex.toUpperCase()}</div>
      </div>`;

  } else if (key === 'stocks') {
    wrap.innerHTML = `
      <div class="w-stocks__sym">AAPL</div>
      <div class="w-stocks__price">$189.42</div>
      <div class="w-stocks__chg up">↑ 1.24%</div>`;

  } else if (key === 'activity') {
    const dotCount = 35;
    const dots = Array.from({ length: dotCount }, () => {
      const lvl = Math.random() < 0.25 ? 0 : Math.floor(Math.random() * 5);
      return `<span class="w-activity__dot" data-level="${lvl}"></span>`;
    }).join('');
    wrap.innerHTML = `
      <div class="w-activity__header">
        <span class="w-activity__label" data-i18n="widgetActivityLabel">${t('widgetActivityLabel')}</span>
        <span class="w-activity__info" data-i18n="activityLast30Days">${t('activityLast30Days')}</span>
      </div>
      <div class="w-activity__grid">${dots}</div>`;

  } else if (key === 'life') {
    const total = 52 * 90, lived = 52 * 28;
    const cells = Array.from({length: 52 * 10}, (_, i) =>
      `<span style="width:5px;height:5px;border-radius:1px;background:${i < lived % (52*10) ? 'var(--primary-c)' : 'var(--border-c)'};display:inline-block"></span>`
    ).join('');
    wrap.innerHTML = `
      <div class="w-activity__header">
        <span class="w-activity__label" data-i18n="widgetLifeLabel">${t('widgetLifeLabel')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(52,1fr);gap:1px">${cells}</div>`;
  }

  return wrap;
}

function openWidgetPicker(gid) {
  widgetPickerGid = gid;
  const grid = document.getElementById('wPickerGrid');
  grid.innerHTML = '';
  WIDGET_TYPES.forEach(wt => {
    const cell = document.createElement('div');
    cell.className = 'widget-picker-cell';

    const footer = document.createElement('div');
    footer.className = 'widget-picker-item__footer';
    footer.innerHTML = `<span class="widget-picker-item__label" data-i18n="${wt.labelKey}">${t(wt.labelKey)}</span><span class="widget-picker-item__desc" data-i18n="${wt.descKey}">${t(wt.descKey)}</span>`;
    cell.appendChild(footer);

    const btn = document.createElement('button');
    btn.className = 'widget-picker-item';
    const preview = makeWidgetPreview(wt.key);
    btn.appendChild(preview);
    btn.addEventListener('click', () => {
      wPickerOverlay.hidden = true;
      addWidget(gid, wt.key);
    });
    cell.appendChild(btn);
    grid.appendChild(cell);
  });
  wPickerOverlay.hidden = false;
}

function addWidget(gid, wKey) {
  const g = getGroups().find(x => x.id === gid); if (!g) return;
  const defaults = {
    clock:    { zones: [{ label: 'Local', tz: Intl.DateTimeFormat().resolvedOptions().timeZone }], showDate: true, color: null },
    weather:  { city: 'auto', unit: 'C' },
    pantone:  { color: null },
    stocks:   { symbol: 'AAPL', range: '1M' },
    activity: { days: 30 },
    life:     { dob: '' },
  };
  const w = { id: uid(), type: 'widget', widget: wKey, cfg: defaults[wKey] || {} };

  // Widgets that need config: open edit first, add to group only on Save
  const needsConfig = ['clock', 'stocks', 'weather', 'life', 'activity'];
  if (needsConfig.includes(wKey)) {
    openWidgetEditNew(w, gid);
  } else {
    // pantone and others: add immediately
    g.sites.unshift(w);
    save(); render();
  }
}

// Open widget edit modal for a NEW (not yet saved) widget.
// The widget is only added to the group when user clicks Save.
function openWidgetEditNew(w, gid) {
  widgetEditPending = { w, gid };
  wEditIsNew = true; // set BEFORE openWidgetEdit so label updates correctly
  openWidgetEdit(w.id, gid);
}

/* ══════════════════════════════════════════════════
   WIDGET BUILDER
══════════════════════════════════════════════════ */
function buildWidget(site, gid) {
  const el = document.createElement('div');
  el.className = `widget widget--${site.widget}`;
  el.dataset.sid = site.id;
  el.dataset.widgetType = site.widget;

  // Determine text color based on bg
  function applyColor(color) {
    if (color) {
      el.style.background = color;
      el.removeAttribute('data-transparent');
      const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
      const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
      el.style.color = lum > 0.5 ? '#000' : '#fff';
    } else {
      el.style.background = '';
      el.style.color = '';
      el.dataset.transparent = '1';
      el.removeAttribute('data-local-bg');
      requestAnimationFrame(() => requestAnimationFrame(() => window._bgSampler?.applyEl(el)));
    }
  }

  switch (site.widget) {
    case 'clock':    buildClockWidget(el, site.cfg);   break;
    case 'weather':  buildWeatherWidget(el, site.cfg); break;
    case 'pantone':  buildPantoneWidget(el, site.cfg); break;
    case 'stocks':   buildStocksWidget(el, site.cfg);  break;
    case 'activity': buildActivityWidget(el, site.cfg);break;
    case 'life':     buildLifeWidget(el, site.cfg);     break;
  }

  if (site.widget !== 'pantone') applyColor(site.cfg?.color || null);

  // Right-click context — resolve gid dynamically so cross-group drag works
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    const liveGid = el.closest('[data-gid]')?.dataset.gid || gid;
    showWidgetCtx(e, site.id, liveGid);
  });
  return el;
}

/* ── Clock widget ── */
function buildClockWidget(el, cfg) {
  let timerId = null;
  function tick() {
    // Stop if removed from DOM
    if (timerId && !document.body.contains(el)) { clearTimeout(timerId); return; }
    const zones = cfg.zones || [{ label: 'Local', tz: Intl.DateTimeFormat().resolvedOptions().timeZone }];
    const primary = zones[0];
    const now = new Date();
    const opts = { timeZone: primary.tz, hour: '2-digit', minute: '2-digit', hour12: false };
    const time = now.toLocaleTimeString('en', opts);
    const dateOpts = { timeZone: primary.tz, weekday: 'short', month: 'short', day: 'numeric' };
    const date = now.toLocaleDateString(getLocale(), dateOpts);

    let html = `<div class="w-clock__time">${time}</div>`;
    if (cfg.showDate) html += `<div class="w-clock__date">${date}</div>`;
    if (zones.length > 1) {
      html += '<div class="w-clock__zones">';
      zones.slice(1).forEach(z => {
        const zoneTime = now.toLocaleTimeString('en', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false });
        html += `<div class="w-clock__zone"><span class="w-clock__zone-label">${z.label}</span><span class="w-clock__zone-time">${zoneTime}</span></div>`;
      });
      html += '</div>';
    }
    el.innerHTML = html;
    // Align next tick to the next wall-clock second
    const msToNext = 1000 - (Date.now() % 1000) + 5;
    timerId = setTimeout(tick, msToNext);
  }
  // Render immediately (even before DOM insertion) then keep ticking
  tick();
}

/* ── Weather widget ── */
function buildWeatherWidget(el, cfg) {
  el.innerHTML = `<div class="w-loading">${t('weatherLoading')}</div>`;
  const city = cfg.city && cfg.city !== 'auto' ? cfg.city : null;

  function fetchWeather(lat, lon, cityName) {
    const fields = 'current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature';
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${fields}`)
      .then(r => r.json()).then(d => {
        const c = d.current;
        const raw = c.temperature_2m;
        const feels = c.apparent_temperature;
        const temp = cfg.unit === 'F' ? Math.round(raw*9/5+32)+'°F' : Math.round(raw)+'°C';
        const feelsStr = cfg.unit === 'F' ? Math.round(feels*9/5+32)+'°' : Math.round(feels)+'°';
        const codes = {0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',61:'🌧',63:'🌧',65:'🌧',71:'❄️',73:'❄️',75:'❄️',80:'🌦',81:'🌧',82:'⛈',95:'⛈',96:'⛈',99:'⛈'};
        const icon = codes[c.weather_code] || '🌡';
        el.innerHTML = `
          <div class="w-weather__row">
            <div class="w-weather__main">
              <div class="w-weather__temp">${temp}</div>
              <div class="w-weather__feels">${tr('weatherFeelsLike', feelsStr)}</div>
            </div>
            <div class="w-weather__icon">${icon}</div>
          </div>
          <div class="w-weather__meta">
            <span>💧 ${c.relative_humidity_2m}%</span>
            <span>💨 ${Math.round(c.wind_speed_10m)} km/h</span>
            ${cityName ? `<span>📍 ${esc(cityName)}</span>` : ''}
          </div>`;
      }).catch(() => { el.innerHTML = `<div class="w-loading">${t('weatherUnavailable')}</div>`; });
  }

  if (city) {
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`)
      .then(r => r.json()).then(d => {
        const res = d.results?.[0];
        if (!res) { el.innerHTML = `<div class="w-loading">${t('weatherCityNotFound')}</div>`; return; }
        fetchWeather(res.latitude, res.longitude, res.name);
      }).catch(() => { el.innerHTML = `<div class="w-loading">${t('weatherGeocodingFailed')}</div>`; });
  } else {
    // Use cached coords if available — avoids repeated permission prompts
    if (window._geoCache) {
      fetchWeather(window._geoCache.lat, window._geoCache.lon, null);
    } else {
      navigator.geolocation?.getCurrentPosition(
        pos => {
          window._geoCache = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          fetchWeather(pos.coords.latitude, pos.coords.longitude, null);
        },
        () => { el.innerHTML = `<div class="w-loading">${t('weatherLocationPrompt')}</div>`; }
      );
    }
  }
}

/* ── Pantone widget ── */
const PANTONE_COLORS = [
  {name:'Viva Magenta',hex:'#BB2649'},{name:'Very Peri',hex:'#6667AB'},{name:'Classic Blue',hex:'#0F4C81'},
  {name:'Living Coral',hex:'#FF6B6B'},{name:'Ultra Violet',hex:'#5F4B8B'},{name:'Greenery',hex:'#88B04B'},
  {name:'Rose Quartz',hex:'#F7CAC9'},{name:'Serenity',hex:'#92A8D1'},{name:'Radiant Orchid',hex:'#B163A3'},
  {name:'Emerald',hex:'#009473'},{name:'Tangerine Tango',hex:'#DD4132'},{name:'Honeysuckle',hex:'#D94F70'},
  {name:'Turquoise',hex:'#45B5AA'},{name:'Mimosa',hex:'#EFC050'},{name:'Blue Iris',hex:'#5A5B9F'},
];
function buildPantoneWidget(el, cfg) {
  function renderPantone(p) {
    el.style.background = p.hex;
    const r=parseInt(p.hex.slice(1,3),16), g=parseInt(p.hex.slice(3,5),16), b=parseInt(p.hex.slice(5,7),16);
    const lum = (0.299*r+0.587*g+0.114*b)/255;
    const tc = lum > 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    const tc2 = lum > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
    el.innerHTML = `
      <div class="w-pantone__actions">
        <button class="w-pantone__action-btn" data-tip="${t('tooltipPantoneRefresh')}" style="color:${tc2}" id="pan_refresh">
          ${LI("RefreshCw",13)}
        </button>
        <button class="w-pantone__action-btn" data-tip="${t('tooltipPantoneCopy')}" style="color:${tc2}" id="pan_copy">
          ${LI("Copy",13)}
        </button>
      </div>
      <div class="w-pantone__body">
        <div class="w-pantone__pantone" style="color:${tc2}">Pantone®</div>
        <div class="w-pantone__name" style="color:${tc}">${p.name}</div>
        <div class="w-pantone__hex" style="color:${tc2}">${p.hex.toUpperCase()}</div>
      </div>`;
    el.querySelector('#pan_refresh').addEventListener('click', e => {
      e.stopPropagation();
      const next = PANTONE_COLORS[Math.floor(Math.random()*PANTONE_COLORS.length)];
      cfg._pantoneColor = next.hex; cfg._pantoneName = next.name; cfg._pantoneDate = new Date().toDateString();
      cfg._userPicked = true; // manual pick — keep across tabs
      renderPantone(next);
      save(); // persist immediately
    });
    el.querySelector('#pan_copy').addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(p.hex.toUpperCase()).catch(() => {});
      const btn = el.querySelector('#pan_copy');
      btn.innerHTML = `${LI("Check",13)}`;
      setTimeout(() => { btn.innerHTML = `${LI("Copy",13)}`; }, 1500);
    });
  }

  const today = new Date().toDateString();
  let p;
  if (cfg._pantoneColor && (cfg._userPicked || cfg._pantoneDate === today)) {
    // Use saved color (user picked or same day auto)
    p = { name: cfg._pantoneName, hex: cfg._pantoneColor };
  } else {
    // New day: pick new auto color
    const seed = new Date().getDate() + new Date().getMonth() * 31;
    p = PANTONE_COLORS[seed % PANTONE_COLORS.length];
    cfg._pantoneDate = today; cfg._pantoneName = p.name; cfg._pantoneColor = p.hex;
    cfg._userPicked = false;
    save();
  }
  renderPantone(p);
}

/* ── Stocks widget — minimal via Coinbase (crypto) or Frankfurter-style ── */
function buildStocksWidget(el, cfg) {
  const sym = (cfg.symbol || 'AAPL').toUpperCase();
  el.innerHTML = `<div class="w-stocks__sym">${sym}</div><div class="w-stocks__spinner"><span></span><span></span><span></span></div>`;

  const isCrypto = sym.endsWith('-USD') || ['BTC','ETH','SOL','BNB','DOGE','ADA','AVAX','XRP','DOT','MATIC'].includes(sym);

  if (isCrypto) {
    // Coinbase API — fast, no key, no CORS for extensions
    const coinSym = sym.replace('-USD','') + '-USD';
    Promise.all([
      fetch(`https://api.coinbase.com/v2/prices/${coinSym}/spot`).then(r=>r.json()),
      fetch(`https://api.coinbase.com/v2/prices/${coinSym}/buy`).then(r=>r.json()),
    ]).then(([spot, buy]) => {
      const price = parseFloat(spot.data?.amount || 0);
      const buyP  = parseFloat(buy.data?.amount || 0);
      const chg   = price > 0 && buyP > 0 ? ((price - buyP) / buyP * 100) : 0;
      const up    = chg >= 0;
      const label = sym.replace('-USD','');
      const fmt   = price > 1000 ? price.toLocaleString('en',{maximumFractionDigits:0}) : price.toFixed(2);
      el.innerHTML = `
        <div class="w-stocks__sym">${label}</div>
        <div class="w-stocks__price">$${fmt}</div>
        <div class="w-stocks__chg ${up?'up':'dn'}">${up?'↑':'↓'} ${Math.abs(chg).toFixed(2)}%</div>`;
    }).catch(() => {
      el.innerHTML = `<div class="w-stocks__sym">${sym.replace('-USD','')}</div><div class="w-stocks__na">—</div>`;
    });
  } else {
    // Stocks: use Finnhub free tier (no key needed for quote endpoint via proxy)
    // Fallback: use a fast public quote API
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d&corsDomain=finance.yahoo.com`;
    fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) })
      .then(r => r.json())
      .then(data => {
        const parsed = JSON.parse(data.contents);
        const meta = parsed?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error();
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose || meta.chartPreviousClose || price;
        const chg   = ((price - prev) / prev * 100);
        const up    = chg >= 0;
        el.innerHTML = `
          <div class="w-stocks__sym">${sym}</div>
          <div class="w-stocks__price">$${price.toFixed(2)}</div>
          <div class="w-stocks__chg ${up?'up':'dn'}">${up?'↑':'↓'} ${Math.abs(chg).toFixed(2)}%</div>`;
      })
      .catch(() => {
        el.innerHTML = `<div class="w-stocks__sym">${sym}</div><div class="w-stocks__na">—</div>`;
      });
  }
}

/* ── Activity widget ── */
function buildActivityWidget(el, cfg) {
  const days = cfg.days || 30;
  const uid2 = 'ag_' + Date.now();
  el.innerHTML = `
    <div class="w-activity__header">
      <span class="w-activity__label" data-i18n="widgetActivityLabel">${t('widgetActivityLabel')}</span>
      <span class="w-activity__info" id="${uid2}_info"></span>
    </div>
    <div class="w-activity__grid" id="${uid2}"></div>`;

  const msPerDay = 86400000;
  const now = Date.now();
  if (!chrome?.history) {
    el.querySelector('.w-activity__label').textContent = t('activityNoAccess');
    return;
  }
  chrome.history.search({ text: '', maxResults: 10000, startTime: now - days * msPerDay }, items => {
    const dateKeys = [];
    const counts = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(now - i * msPerDay);
      const key = d.toDateString();
      counts[key] = 0;
      dateKeys.unshift({ key, date: d });
    }
    items.forEach(item => {
      const d = new Date(item.lastVisitTime).toDateString();
      if (d in counts) counts[d]++;
    });

    const grid = document.getElementById(uid2);
    const infoEl = document.getElementById(uid2 + '_info');
    if (!grid) return;
    grid.innerHTML = '';
    const max = Math.max(...Object.values(counts), 1);

    dateKeys.forEach(({ key, date }) => {
      const v = counts[key];
      const dot = document.createElement('div');
      dot.className = 'w-activity__dot';
      const intensity = v === 0 ? 0 : Math.max(1, Math.ceil((v/max)*4));
      dot.dataset.level = intensity;

      dot.addEventListener('mouseenter', () => {
        const dateStr = date.toLocaleDateString(getLocale(), { weekday:'short', month:'short', day:'numeric' });
        infoEl.textContent = v ? `${dateStr} · ${v} ${t('pages')}` : dateStr;
        infoEl.style.visibility = 'visible';
      });
      dot.addEventListener('mouseleave', () => { infoEl.style.visibility = 'hidden'; });
      grid.appendChild(dot);
    });
  });
}

/* ══════════════════════════════════════════════════
   WIDGET CONTEXT MENU
══════════════════════════════════════════════════ */
const widgetCtxEl = document.createElement('div');
widgetCtxEl.className = 'site-ctx'; widgetCtxEl.hidden = true;
widgetCtxEl.innerHTML = `
  <button class="site-ctx__item" id="wCtxEdit">
    ${LI("Pencil",13)}
    <span data-i18n="ctxEdit">Edit</span>
  </button>
  <button class="site-ctx__item" id="wCtxDuplicate">
    ${LI("Copy",13)}
    <span data-i18n="ctxDuplicate">Duplicate</span>
  </button>
  <button class="site-ctx__item site-ctx__item--danger" id="wCtxRemove">
    ${LI("Trash2",13)}
    <span data-i18n="ctxRemove">Remove</span>
  </button>`;
document.body.appendChild(widgetCtxEl);
let wCtxSid = null, wCtxGid = null;
function showWidgetCtx(e, sid, gid) {
  closeAllDropdowns();
  wCtxSid = sid; wCtxGid = gid;
  const g = getGroups().find(x => x.id === gid);
  const w2 = g?.sites.find(s => s.id === sid);
  const editBtn = document.getElementById('wCtxEdit');
  if (editBtn) editBtn.style.display = w2?.widget === 'pantone' ? 'none' : '';
  widgetCtxEl.hidden = false;
  widgetCtxEl.style.left = Math.min(e.clientX, window.innerWidth-160)+'px';
  widgetCtxEl.style.top  = Math.min(e.clientY, window.innerHeight-80)+'px';
}
document.getElementById('wCtxEdit').addEventListener('click', () => {
  widgetCtxEl.hidden = true;
  const g = getGroups().find(x => x.id === wCtxGid);
  const w2 = g?.sites.find(s => s.id === wCtxSid);
  if (w2?.widget === 'pantone') return; // no settings for pantone
  openWidgetEdit(wCtxSid, wCtxGid);
});
document.getElementById('wCtxDuplicate').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === wCtxGid);
  const w2 = g?.sites.find(s => s.id === wCtxSid);
  if (g && w2) {
    const idx = g.sites.indexOf(w2);
    const clone = JSON.parse(JSON.stringify(w2));
    clone.id = uid();
    g.sites.splice(idx + 1, 0, clone);
    widgetCtxEl.hidden = true;
    save(); render();
    showToast(t('toastDuplicated'), 'success');
  }
});
document.getElementById('wCtxRemove').addEventListener('click', () => {
  widgetCtxEl.hidden = true;
  const sid = wCtxSid, gid = wCtxGid;
  const g0 = getGroups().find(x => x.id === gid);
  const wLabel = g0?.sites.find(s => s.id === sid)?.widget || 'widget';
  const itemEl = document.querySelector(`[data-sid="${sid}"]`);
  const doRemove = () => {
    const g = getGroups().find(x => x.id === gid);
    if (g) { g.sites = g.sites.filter(s => s.id !== sid); save(); render(); }
    showToast(tr('toastRemovedWidget', wLabel), 'delete');
  };
  if (itemEl) dissolveElement(itemEl, doRemove);
  else doRemove();
});
document.addEventListener('click', e => { if (!widgetCtxEl.contains(e.target)) widgetCtxEl.hidden = true; });

/* ══════════════════════════════════════════════════
   WIDGET EDIT MODAL
══════════════════════════════════════════════════ */
const wEditOverlay = document.createElement('div');
wEditOverlay.className = 'overlay'; wEditOverlay.hidden = true;
wEditOverlay.innerHTML = `
  <div class="modal modal--widget-edit">
    <div class="wedge__preview" id="wEditPreview"></div>
    <div class="wedge__settings">
      <div class="modal__header">
        <h2 class="modal__title" id="wEditTitle" data-i18n="addWidgetTitle">Edit widget</h2>
        <button class="modal__close" id="closeWEditBtn">
          ${LI("X",14)}
        </button>
      </div>
      <div class="modal__body" id="wEditBody"></div>
      <div class="modal__footer">
        <button class="btn btn-outline btn-sm" id="wEditCancel" data-i18n="cancel">Cancel</button>
        <button class="btn btn-default btn-sm" id="wEditSave" data-i18n="save">Save</button>
      </div>
    </div>
  </div>`;
document.body.appendChild(wEditOverlay);
function closeWidgetEditModal(cancelled) {
  wEditIsNew = false;
  widgetEditPending = null;
  closeOverlay(wEditOverlay);
}
document.getElementById('closeWEditBtn').addEventListener('click', () => closeWidgetEditModal(true));
document.getElementById('wEditCancel').addEventListener('click', () => closeWidgetEditModal(true));
wEditOverlay.addEventListener('mousedown', e => {
  // Don't close modal if click landed on the Coloris picker (which is in body, outside overlay)
  if (e.target === wEditOverlay && !document.getElementById('clr-picker')?.classList.contains('clr-open')) {
    closeWidgetEditModal(true);
  }
});


let wEditSid = null, wEditGid = null;
let wEditIsNew = false;      // true when editing a brand-new (not-yet-committed) widget
let widgetEditPending = null; // { w, gid } for new widget pending save
function openWidgetEdit(sid, gid) {
  wEditSid = sid; wEditGid = gid;
  const g = getGroups().find(x => x.id === gid);
  // New widget not yet in g.sites — use pending object directly
  const w = (wEditIsNew && widgetEditPending) ? widgetEditPending.w : g?.sites.find(s => s.id === sid);
  if (!w) return;
  const body = document.getElementById('wEditBody');
  const title = document.getElementById('wEditTitle');
  body.innerHTML = '';

  // Build / refresh the left-panel live preview — reads current form state
  function refreshPreview() {
    const previewPane = document.getElementById('wEditPreview');
    if (!previewPane) return;
    previewPane.innerHTML = '';

    // Collect current color from form
    const colorVal = document.getElementById('wEditColor')?.value;
    const isTransparentSel = document.getElementById('wEditTransparentSwatch')?.classList.contains('is-sel');
    const pvCfg = Object.assign({}, w.cfg || {});
    pvCfg.color = (isTransparentSel || !colorVal) ? null : colorVal;

    // Collect widget-specific settings from form
    switch (w.widget) {
      case 'clock': {
        const zonesEl = document.getElementById('wClockZones');
        if (zonesEl) pvCfg.zones = JSON.parse(zonesEl.dataset.zones || '[]');
        const showDateEl = document.getElementById('wEditShowDate');
        if (showDateEl) pvCfg.showDate = showDateEl.checked;
        break;
      }
      case 'weather': {
        const unitEl = document.getElementById('wEditUnit');
        if (unitEl) pvCfg.unit = unitEl.dataset.val || pvCfg.unit;
        const cityEl = document.getElementById('wEditCity');
        if (cityEl) pvCfg.city = cityEl.value.trim() || 'auto';
        break;
      }
      case 'stocks': {
        const customVal = document.getElementById('wEditSymbol')?.value.trim();
        const selBtn = document.querySelector('.stocks-preset-btn.is-sel');
        pvCfg.symbol = (customVal || selBtn?.dataset.sym || pvCfg.symbol || 'AAPL').toUpperCase();
        break;
      }
      case 'activity': {
        const daysVal = parseInt(document.getElementById('wEditDays')?.dataset.val);
        if (daysVal) pvCfg.days = daysVal;
        break;
      }
      case 'life': {
        const d = document.getElementById('wEditDobDay')?.dataset.val || '';
        const m = document.getElementById('wEditDobMonth')?.dataset.val || '';
        const y = document.getElementById('wEditDobYear')?.dataset.val || '';
        if (d && m && y) pvCfg.dob = `${y}-${m}-${d}`;
        const lifespan = parseInt(document.getElementById('wEditLifespan')?.value);
        if (lifespan) pvCfg.lifespan = lifespan;
        break;
      }
    }

    const pvEl = buildWidget({ ...w, cfg: pvCfg }, gid);
    pvEl.addEventListener('contextmenu', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    previewPane.appendChild(pvEl);
    const lbl = document.createElement('span');
    lbl.className = 'wedge__preview__label';
    lbl.dataset.i18n = 'preview';
    lbl.textContent = t('preview');
    previewPane.appendChild(lbl);
  }

  const isTransparent = !w.cfg?.color;
  const PRESET_COLORS = [
    '#3B82F6','#06B6D4','#F59E0B','#F97316','#EC4899','#A855F7',
  ];
  const isCustomColor = w.cfg?.color && !PRESET_COLORS.includes(w.cfg.color);
  const colorRow = `
    <div class="field">
      <div class="color-swatch-grid">
        <button class="color-swatch color-swatch--transparent${isTransparent?' is-sel':''}" id="wEditTransparentSwatch" data-tip="${t('transparent')}">
          ${LI("Ban",12,{"style":"pointer-events:none;stroke:#aaa"})}
        </button>
        ${PRESET_COLORS.map(c => `<button class="color-swatch${w.cfg?.color===c?' is-sel':''}" data-color="${c}" style="background:${c}" data-tip="${c}"></button>`).join('')}
        <button class="color-swatch color-swatch--custom${isCustomColor?' is-sel':''}" id="wEditCustomSwatch" data-tip="${t('customColor')}" style="${isCustomColor?`background:${w.cfg.color}`:''}">
          <input type="text" id="wEditColor" data-coloris value="${w.cfg?.color||'#3B82F6'}" style="position:absolute;width:100%;height:100%;opacity:0;cursor:pointer;top:0;left:0;padding:0;border:none;background:none;" spellcheck="false" autocomplete="off"/>
          ${(()=>{const _s=(!isCustomColor)?"#aaa":(()=>{const _h=w.cfg.color;const _r=parseInt(_h.slice(1,3),16),_g=parseInt(_h.slice(3,5),16),_b=parseInt(_h.slice(5,7),16);return(0.299*_r+0.587*_g+0.114*_b)/255>0.45?"#000":"#fff";})();return LI("Pipette",12,{"id":"wEditCustomIcon","style":"pointer-events:none;position:relative;z-index:1;stroke:"+_s});})()}
        </button>
      </div>
    </div>`;

  function openSimpleDropdown(trigger, items, onSelect) {
    document.querySelectorAll('.tz-dropdown').forEach(d => d.remove());
    const dropdown = document.createElement('div');
    dropdown.className = 'tz-dropdown';
    const list = document.createElement('div');
    list.className = 'tz-dropdown__list';
    const curVal = trigger.dataset.val;
    items.forEach(({value, label}) => {
      const item = document.createElement('div');
      item.className = 'tz-dropdown__item' + (curVal === value ? ' is-selected' : '');
      item.textContent = label;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        trigger.dataset.val = value;
        trigger.querySelector('.tz-select__val').textContent = label;
        dropdown.remove();
        onSelect(value);
      });
      list.appendChild(item);
    });
    dropdown.appendChild(list);
    const rect = trigger.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left  = rect.left + 'px';
    dropdown.style.top   = (rect.bottom + 2) + 'px';
    dropdown.style.width = rect.width + 'px';
    document.body.appendChild(dropdown);
    requestAnimationFrame(() => { const sel = dropdown.querySelector('.is-selected'); if (sel) sel.scrollIntoView({block:'nearest'}); });
    function close(e) { if (!dropdown.contains(e.target) && e.target !== trigger) { dropdown.remove(); document.removeEventListener('mousedown', close); } }
    setTimeout(() => document.addEventListener('mousedown', close), 10);
  }

  switch (w.widget) {
    case 'clock': {
      title.textContent = t('editClockTitle');
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const currentZones = (w.cfg?.zones || [{ label: 'Local', tz: localTz }]).map(z => ({...z}));

      // Common timezones list grouped
      const TZ_LIST = [
        { label: 'Local ('+localTz+')', tz: localTz },
        { label: '── Americas ──', tz: null },
        { label: 'New York',      tz: 'America/New_York' },
        { label: 'Chicago',       tz: 'America/Chicago' },
        { label: 'Denver',        tz: 'America/Denver' },
        { label: 'Los Angeles',   tz: 'America/Los_Angeles' },
        { label: 'Toronto',       tz: 'America/Toronto' },
        { label: 'Vancouver',     tz: 'America/Vancouver' },
        { label: 'São Paulo',     tz: 'America/Sao_Paulo' },
        { label: 'Mexico City',   tz: 'America/Mexico_City' },
        { label: '── Europe ──',  tz: null },
        { label: 'London',        tz: 'Europe/London' },
        { label: 'Paris',         tz: 'Europe/Paris' },
        { label: 'Berlin',        tz: 'Europe/Berlin' },
        { label: 'Warsaw',        tz: 'Europe/Warsaw' },
        { label: 'Rome',          tz: 'Europe/Rome' },
        { label: 'Madrid',        tz: 'Europe/Madrid' },
        { label: 'Amsterdam',     tz: 'Europe/Amsterdam' },
        { label: 'Stockholm',     tz: 'Europe/Stockholm' },
        { label: 'Kyiv',          tz: 'Europe/Kiev' },
        { label: 'Moscow',        tz: 'Europe/Moscow' },
        { label: 'Istanbul',      tz: 'Europe/Istanbul' },
        { label: '── Asia ──',    tz: null },
        { label: 'Dubai',         tz: 'Asia/Dubai' },
        { label: 'Mumbai',        tz: 'Asia/Kolkata' },
        { label: 'Bangkok',       tz: 'Asia/Bangkok' },
        { label: 'Singapore',     tz: 'Asia/Singapore' },
        { label: 'Hong Kong',     tz: 'Asia/Hong_Kong' },
        { label: 'Shanghai',      tz: 'Asia/Shanghai' },
        { label: 'Seoul',         tz: 'Asia/Seoul' },
        { label: 'Tokyo',         tz: 'Asia/Tokyo' },
        { label: '── Pacific ──', tz: null },
        { label: 'Sydney',        tz: 'Australia/Sydney' },
        { label: 'Auckland',      tz: 'Pacific/Auckland' },
        { label: 'Hawaii',        tz: 'Pacific/Honolulu' },
      ];

      // Build flat list with GMT offset labels
      function getTzLabel(tz) {
        try {
          const offset = new Intl.DateTimeFormat('en', {timeZone: tz, timeZoneName:'shortOffset'})
            .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
          return `${offset} ${tz.replace('_',' ')}`;
        } catch { return tz; }
      }

      function renderZoneRows() {
        const rows = document.getElementById('wClockZones');
        if (!rows) return;
        const zones2 = JSON.parse(rows.dataset.zones || '[]');
        rows.innerHTML = '';

        zones2.forEach((z, i) => {
          const row = document.createElement('div');
          row.className = 'clock-zone-row';

          // Custom dropdown trigger
          const trigger = document.createElement('div');
          trigger.className = 'tz-select';
          trigger.tabIndex = 0;
          trigger.dataset.i = i;
          trigger.dataset.tz = z.tz;
          trigger.innerHTML = `<span class="tz-select__val">${getTzLabel(z.tz)}</span>${LI("ChevronDown",12)}`;

          trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            openTzDropdown(trigger, i, rows);
          });
          trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTzDropdown(trigger, i, rows); } });

          row.appendChild(trigger);

          if (i > 0) {
            const del = document.createElement('button');
            del.className = 'clock-zone-del'; del.dataset.tip = t('remove'); del.textContent = '✕';
            del.addEventListener('click', () => {
              const zs = JSON.parse(rows.dataset.zones);
              zs.splice(i, 1);
              rows.dataset.zones = JSON.stringify(zs);
              renderZoneRows();
            });
            row.appendChild(del);
          }
          rows.appendChild(row);
        });
        requestAnimationFrame(() => refreshPreview());
      }

      function openTzDropdown(trigger, idx, rows) {
        // Remove existing
        document.querySelectorAll('.tz-dropdown').forEach(d => d.remove());
        const dropdown = document.createElement('div');
        dropdown.className = 'tz-dropdown';

        // Search input
        const search = document.createElement('input');
        search.className = 'tz-dropdown__search field__input';
        search.placeholder = t('clockSearchTimezone');
        dropdown.appendChild(search);

        const list = document.createElement('div');
        list.className = 'tz-dropdown__list';
        dropdown.appendChild(list);

        function renderList(filter) {
          list.innerHTML = '';
          // Common abbreviation zones not in IANA but widely expected
          const extraTz = ['UTC','Etc/UTC','Etc/GMT','CET','EET','WET','MET','EST','CST6CDT','MST','PST8PDT'];
          const ianaTz = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : TZ_LIST.filter(t=>t.tz).map(t=>t.tz);
          // merge extras that aren't already in the IANA list
          const allTz = [...new Set([...extraTz, ...ianaTz])];
          const filtered = allTz.filter(tz => {
            if (!filter) return true;
            return tz.toLowerCase().includes(filter.toLowerCase()) ||
                   getTzLabel(tz).toLowerCase().includes(filter.toLowerCase());
          }).slice(0, 100);
          filtered.forEach(tz => {
            const now = new Date();
            let t;
            try { t = now.toLocaleTimeString('en', {timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false}); }
            catch { return; } // skip invalid
            const item = document.createElement('div');
            item.className = 'tz-dropdown__item';
            item.dataset.tz = tz;
            const zs = JSON.parse(rows.dataset.zones);
            if (zs[idx]?.tz === tz) item.classList.add('is-selected');
            item.innerHTML = `<span>${getTzLabel(tz)}</span><span class="tz-dropdown__time">${t}</span>`;
            item.addEventListener('mousedown', e => {
              e.preventDefault();
              const zs2 = JSON.parse(rows.dataset.zones);
              zs2[idx] = { label: tz.split('/').pop().replace('_',' '), tz };
              rows.dataset.zones = JSON.stringify(zs2);
              dropdown.remove();
              renderZoneRows();
            });
            list.appendChild(item);
          });
        }
        renderList('');
        search.addEventListener('input', () => renderList(search.value));

        // Position below trigger
        const rect = trigger.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 2) + 'px';
        dropdown.style.width = rect.width + 'px';
        document.body.appendChild(dropdown);
        // No auto-focus — user opens dropdown intentionally

        // Close on outside click
        function close(e) {
          if (!dropdown.contains(e.target) && e.target !== trigger) {
            dropdown.remove();
            document.removeEventListener('mousedown', close);
          }
        }
        setTimeout(() => document.addEventListener('mousedown', close), 10);
      }

      body.innerHTML = `
        <div class="field">
          <div id="wClockZones" class="clock-zones-list" data-zones='${JSON.stringify(currentZones)}'></div>
          <button class="btn btn-outline btn-sm" id="wClockAddZone" data-i18n="clockAddZone" style="margin-top:.5rem;width:100%">${t('clockAddZone')}</button>
        </div>
        <div class="switch-row" style="padding:.5rem 0">
          <span class="switch-row__label" data-i18n="clockShowDate">${t('clockShowDate')}</span>
          <label class="switch"><input type="checkbox" id="wEditShowDate" ${w.cfg?.showDate?'checked':''}/><span class="switch__track"></span></label>
        </div>
        ${colorRow}`;

      renderZoneRows();

      document.getElementById('wClockAddZone').addEventListener('click', () => {
        const rows = document.getElementById('wClockZones');
        const zs = JSON.parse(rows.dataset.zones);
        zs.push({ label: 'New York', tz: 'America/New_York' });
        rows.dataset.zones = JSON.stringify(zs);
        renderZoneRows();
      });

      // Live preview: show date toggle
      requestAnimationFrame(() => {
        document.getElementById('wEditShowDate')?.addEventListener('change', () => refreshPreview());
      });
      break;
    }
    case 'weather': {
      title.textContent = t('editWeatherTitle');
      const cityVal = w.cfg?.city && w.cfg.city !== 'auto' ? w.cfg.city : '';
      body.innerHTML = `
        <div class="field"><label class="field__label" data-i18n="weatherCityLabel">${t('weatherCityLabel')}</label>
        <input class="field__input" id="wEditCity" placeholder="${t('weatherCityPlaceholder')}" value="${cityVal}"/></div>
        <div class="field"><div class="pill-switcher" id="wEditUnit" data-val="${w.cfg?.unit!=='F'?'C':'F'}">
          <div class="pill-switcher__track">
            <div class="pill-switcher__thumb"></div>
            <button class="pill-switcher__btn${w.cfg?.unit!=='F'?' active':''}" data-val="C" data-i18n="weatherCelsius">${t('weatherCelsius')}</button>
            <button class="pill-switcher__btn${w.cfg?.unit==='F'?' active':''}" data-val="F" data-i18n="weatherFahrenheit">${t('weatherFahrenheit')}</button>
          </div>
        </div></div>${colorRow}`;
      requestAnimationFrame(() => {
        document.getElementById('wEditUnit')?.querySelectorAll('.pill-switcher__btn').forEach(btn => {
          btn.addEventListener('click', () => requestAnimationFrame(() => refreshPreview()));
        });
      });
      break;
    }
    case 'stocks': {
      title.textContent = t('editStocksTitle');
      const TOP_STOCKS = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','NFLX','AMD','INTC'];
      const TOP_CRYPTO = ['BTC-USD','ETH-USD','BNB-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD','AVAX-USD','DOT-USD','MATIC-USD'];
      const cur = w.cfg?.symbol || 'AAPL';
      const isStock = TOP_STOCKS.includes(cur);
      const isCrypto = TOP_CRYPTO.includes(cur);
      const isCustom = !isStock && !isCrypto;
      body.innerHTML = `
        <div class="field">
          <label class="field__label" data-i18n="stocksTypeLabel">${t('stocksTypeLabel')}</label>
          <div class="stocks-presets">
            <div class="stocks-preset-group" id="stocksPresetStocks">
              <p class="stocks-preset-label" data-i18n="stocksTopStocks">${t('stocksTopStocks')}</p>
              <div class="stocks-preset-btns">
                ${TOP_STOCKS.map(s=>`<button class="stocks-preset-btn${s===cur?' is-sel':''}" data-sym="${s}">${s}</button>`).join('')}
              </div>
            </div>
            <div class="stocks-preset-group">
              <p class="stocks-preset-label" data-i18n="stocksTopCrypto">${t('stocksTopCrypto')}</p>
              <div class="stocks-preset-btns">
                ${TOP_CRYPTO.map(s=>`<button class="stocks-preset-btn${s===cur?' is-sel':''}" data-sym="${s}">${s.replace('-USD','')}</button>`).join('')}
              </div>
            </div>
            <div class="stocks-preset-group">
              <p class="stocks-preset-label" data-i18n="stocksCustom">${t('stocksCustom')}</p>
              <input class="field__input" id="wEditSymbol" placeholder="${t('stocksPlaceholder')}" value="${isCustom?cur:''}"/>
            </div>
          </div>
        </div>${colorRow}`;
      // Bind preset buttons
      body.querySelectorAll('.stocks-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          body.querySelectorAll('.stocks-preset-btn').forEach(b => b.classList.remove('is-sel'));
          btn.classList.add('is-sel');
          const inp = document.getElementById('wEditSymbol');
          if (inp) inp.value = '';
          requestAnimationFrame(() => refreshPreview());
        });
      });
      requestAnimationFrame(() => {
        document.getElementById('wEditSymbol')?.addEventListener('input', () => refreshPreview());
      });
      break;
    }
    case 'life': {
      title.textContent = t('editLifeTitle');
      const _dob = w.cfg?.dob || '';
      const [_dobY='', _dobM='', _dobD=''] = _dob ? _dob.split('-') : [];
      const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const _curY = new Date().getFullYear();

      body.innerHTML = `
        <div class="field">
          <label class="field__label" data-i18n="lifeDobLabel">${t('lifeDobLabel')}</label>
          <div class="dob-selects" id="dobSelects"></div>
        </div>
        <div class="field">
          <label class="field__label" data-i18n="lifeExpLabel">${t('lifeExpLabel')}</label>
          <input class="field__input" id="wEditLifespan" type="number" min="50" max="120" value="${w.cfg?.lifespan||90}"/>
        </div>
        ${colorRow}`;

      requestAnimationFrame(() => {
        const dobSelects = document.getElementById('dobSelects');

        function makeTrigger(id, val, label) {
          const t = document.createElement('div');
          t.className = 'tz-select'; t.id = id; t.tabIndex = 0;
          t.dataset.val = val;
          t.innerHTML = `<span class="tz-select__val">${label}</span>${LI('ChevronDown',12)}`;
          return t;
        }

        const dayItems   = Array.from({length:31}, (_,i) => ({value: String(i+1).padStart(2,'0'), label: String(i+1)}));
        const monthItems = _MONTHS.map((m,i) => ({value: String(i+1).padStart(2,'0'), label: m}));
        const yearItems  = Array.from({length: _curY - 1923}, (_,i) => ({value: String(_curY-i), label: String(_curY-i)}));

        const dayTrig   = makeTrigger('wEditDobDay',   _dobD, _dobD ? parseInt(_dobD)                     : t('dobDay'));
        const monthTrig = makeTrigger('wEditDobMonth', _dobM, _dobM ? _MONTHS[parseInt(_dobM)-1]           : t('dobMonth'));
        const yearTrig  = makeTrigger('wEditDobYear',  _dobY, _dobY || t('dobYear'));

        dayTrig  .addEventListener('click', e => { e.stopPropagation(); openSimpleDropdown(dayTrig,   dayItems,   () => refreshPreview()); });
        monthTrig.addEventListener('click', e => { e.stopPropagation(); openSimpleDropdown(monthTrig, monthItems, () => refreshPreview()); });
        yearTrig .addEventListener('click', e => { e.stopPropagation(); openSimpleDropdown(yearTrig,  yearItems,  () => refreshPreview()); });

        dobSelects.append(dayTrig, monthTrig, yearTrig);
        document.getElementById('wEditLifespan')?.addEventListener('input', () => refreshPreview());
      });
      break;
    }
    case 'activity': {
      title.textContent = t('editActivityTitle');
      const curDays = w.cfg?.days === 90 ? '90' : '30';
      body.innerHTML = `
        <div class="field"><div class="pill-switcher" id="wEditDays" data-val="${curDays}">
          <div class="pill-switcher__track">
            <div class="pill-switcher__thumb"></div>
            <button class="pill-switcher__btn${curDays==='30'?' active':''}" data-val="30" data-i18n="activityLast30Days">${t('activityLast30Days')}</button>
            <button class="pill-switcher__btn${curDays==='90'?' active':''}" data-val="90" data-i18n="activityLast90Days">${t('activityLast90Days')}</button>
          </div>
        </div></div>${colorRow}`;
      requestAnimationFrame(() => {
        document.getElementById('wEditDays')?.querySelectorAll('.pill-switcher__btn').forEach(btn => {
          btn.addEventListener('click', () => requestAnimationFrame(() => refreshPreview()));
        });
      });
      break;
    }
    case 'pantone':
      // Pantone has no settings — close immediately
      wEditOverlay.hidden = true;
      return;
    default: {
      title.textContent = t('addWidgetTitle');
      body.innerHTML = colorRow;
    }
  }
  wEditOverlay.hidden = false;
  requestAnimationFrame(() => refreshPreview());
  // Update Save/Add button label based on mode
  document.getElementById('wEditSave').textContent = wEditIsNew ? t('add') : t('save');

  // Init pill switchers
  requestAnimationFrame(() => {
    document.querySelectorAll('.pill-switcher').forEach(sw => {
      const btns = sw.querySelectorAll('.pill-switcher__btn');
      const thumb = sw.querySelector('.pill-switcher__thumb');
      function updateThumb(btn, instant = false) {
        if (instant) thumb.style.transition = 'none';
        thumb.style.width     = btn.offsetWidth + 'px';
        thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
        if (instant) requestAnimationFrame(() => { thumb.style.transition = ''; });
      }
      const activeBtn = sw.querySelector('.pill-switcher__btn.active') || btns[0];
      updateThumb(activeBtn, true);
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          sw.dataset.val = btn.dataset.val;
          updateThumb(btn);
        });
      });
    });
  });

  // Bind color swatches
  requestAnimationFrame(() => {
    const ci = document.getElementById('wEditColor');
    const customSwatch = document.getElementById('wEditCustomSwatch');
    const transpSwatch = document.getElementById('wEditTransparentSwatch');

    if (ci && window.Coloris) {
      Coloris({ el: '#wEditColor' });
    }

    function resetAllSwatches() {
      document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('is-sel'));
      if (customSwatch) {
        customSwatch.style.background = '';
        const icon = document.getElementById('wEditCustomIcon');
        if (icon) icon.style.stroke = '#aaa';
      }
    }

    // Transparent swatch
    if (transpSwatch) {
      transpSwatch.addEventListener('click', () => {
        resetAllSwatches();
        transpSwatch.classList.add('is-sel');
        refreshPreview();
      });
    }

    // Preset swatch buttons
    document.querySelectorAll('.color-swatch[data-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        resetAllSwatches();
        btn.classList.add('is-sel');
        if (ci) {
          ci.value = btn.dataset.color;
          ci.dispatchEvent(new Event('input', { bubbles: true }));
        }
        refreshPreview();
      });
    });

    // When user picks via Coloris — update custom swatch bg, deselect presets
    if (ci) {
      ci.addEventListener('change', () => {
        const val = ci.value.toLowerCase();
        const isPreset = [...document.querySelectorAll('.color-swatch[data-color]')]
          .some(b => b.dataset.color.toLowerCase() === val);
        document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('is-sel'));
        if (customSwatch) {
          customSwatch.classList.toggle('is-sel', !isPreset);
          customSwatch.style.background = isPreset ? '' : val;
          const icon = document.getElementById('wEditCustomIcon');
          if (icon) {
            if (!isPreset) {
              const r = parseInt(val.slice(1,3),16), g = parseInt(val.slice(3,5),16), b = parseInt(val.slice(5,7),16);
              const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
              icon.style.stroke = lum > 0.45 ? '#000' : '#fff';
            } else {
              icon.style.stroke = '#aaa';
            }
          }
        }
        refreshPreview();
      });
    }
  });
}

document.getElementById('wEditSave').addEventListener('click', () => {
  const g = getGroups().find(x => x.id === wEditGid); if (!g) return;
  // New widget: insert into sites only on confirmed Save
  if (wEditIsNew && widgetEditPending) g.sites.unshift(widgetEditPending.w);
  const w = g.sites.find(s => s.id === wEditSid); if (!w) return;

  const colorVal = document.getElementById('wEditColor')?.value;
  const isTransparentSel = document.getElementById('wEditTransparentSwatch')?.classList.contains('is-sel');
  w.cfg.color = (isTransparentSel || !colorVal) ? null : colorVal;

  switch (w.widget) {
    case 'clock': {
      const zonesEl = document.getElementById('wClockZones');
      if (zonesEl) w.cfg.zones = JSON.parse(zonesEl.dataset.zones || '[]');
      w.cfg.showDate = document.getElementById('wEditShowDate')?.checked;
      break;
    }
    case 'weather':
      w.cfg.unit = document.getElementById('wEditUnit')?.dataset.val || 'C';
      const cityInput = document.getElementById('wEditCity')?.value.trim();
      w.cfg.city = cityInput || 'auto';
      break;
    case 'stocks': {
      const customVal = document.getElementById('wEditSymbol')?.value.trim();
      const selBtn = document.querySelector('.stocks-preset-btn.is-sel');
      w.cfg.symbol = (customVal || selBtn?.dataset.sym || 'AAPL').toUpperCase();
      break;
    }
    case 'activity': w.cfg.days = parseInt(document.getElementById('wEditDays')?.dataset.val)||30; break;
    case 'life':
      const _d = document.getElementById('wEditDobDay')?.dataset.val || '';
      const _m = document.getElementById('wEditDobMonth')?.dataset.val || '';
      const _y = document.getElementById('wEditDobYear')?.dataset.val || '';
      w.cfg.dob      = (_d && _m && _y) ? `${_y}-${_m}-${_d}` : '';
      w.cfg.lifespan = parseInt(document.getElementById('wEditLifespan')?.value) || 90;
      break;
  }
  save();
  // Force group body rebuild by clearing cached siteIds on group elements
  document.querySelectorAll('.group[data-site-ids], .group').forEach(el => {
    if (el.dataset.siteIds !== undefined) el.dataset.siteIds = '';
    if (el.dataset.settings !== undefined) el.dataset.settings = '';
  });
  const savedSid = wEditSid;
  const _wasNew = wEditIsNew;
  wEditIsNew = false;
  widgetEditPending = null;
  render();
  wEditOverlay.hidden = true;
  showToast(_wasNew ? t('toastWidgetAdded') : t('toastWidgetUpdated'), _wasNew ? 'add' : 'update');
  // Animate the newly saved widget
  requestAnimationFrame(() => {
    const savedEl = document.querySelector(`[data-sid="${savedSid}"]`);
    if (savedEl) animateZoomIn(savedEl);
  });
});

/* ── Life in Weeks widget ── */
function buildLifeWidget(el, cfg) {
  if (!cfg.dob) {
    el.innerHTML = `<div class="w-loading">${t('lifeSetDob')}</div>`;
    return;
  }

  const dob      = new Date(cfg.dob);
  const lifespan = cfg.lifespan || 90;
  const now      = new Date();

  // Build year-by-year grid: each row = 1 year of life
  // Each year starts on birthday and has exactly 52 weeks displayed
  // Current position = which year + which week within that year
  const COLS = 52;
  const ROWS = lifespan;

  // For each row (year of life), calculate how many weeks are lived
  // Year 0 = age 0-1 (birthday to next birthday), etc.
  function getBirthday(yearsAfter) {
    const d = new Date(dob);
    d.setFullYear(d.getFullYear() + yearsAfter);
    return d;
  }

  // Find current year of life and week within it
  let currentYear = -1;
  let currentWeek = -1;
  for (let y = 0; y < lifespan; y++) {
    const yearStart = getBirthday(y);
    const yearEnd   = getBirthday(y + 1);
    if (now >= yearStart && now < yearEnd) {
      currentYear = y;
      const msIntoYear = now - yearStart;
      currentWeek = Math.floor(msIntoYear / (7 * 24 * 3600 * 1000));
      break;
    }
  }

  const yearsLived = (now - dob) / (365.25 * 24 * 3600 * 1000);
  const totalWeeks = lifespan * 52;
  const weeksLived = currentYear * 52 + currentWeek;
  const pct = Math.min((weeksLived / totalWeeks * 100), 100).toFixed(1);

  el.innerHTML = `
    <div class="w-life__header">
      <span class="w-life__label" data-i18n="widgetLifeLabel">${t('widgetLifeLabel')}</span>
      <span class="w-life__stats">${Math.floor(yearsLived)}y · ${pct}%</span>
    </div>
    <div class="w-life__grid"></div>`;

  const grid = el.querySelector('.w-life__grid');
  const canvas = document.createElement('canvas');
  const cellSize = 5, gap = 1, step = cellSize + gap;
  canvas.width  = COLS * step - gap;
  canvas.height = ROWS * step - gap;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';
  grid.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function drawCell(x, y, color) {
    const radius = cellSize / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function _renderDots(isDotDark) {
    const filledColor  = isDotDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)';
    const currentColor = isDotDark ? 'rgba(255,255,255,1.0)'  : 'rgba(0,0,0,1.0)';
    const emptyColor   = isDotDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * step, y = row * step;
        let color;
        if (row < currentYear) {
          color = filledColor;
        } else if (row === currentYear) {
          if (col < currentWeek) color = filledColor;
          else if (col === currentWeek) color = currentColor;
          else color = emptyColor;
        } else {
          color = emptyColor;
        }
        drawCell(x, y, color);
      }
    }
  }

  // Determine initial dot color from global brightness or theme
  const bgHex = cfg.color || '';
  let isDotDark;
  if (!cfg.color) {
    const localBg = el.dataset.localBg;
    if (localBg) {
      isDotDark = localBg === 'dark';
    } else {
      const bgBright = document.documentElement.getAttribute('data-bg-bright');
      isDotDark = bgBright === 'dark' ? true : bgBright === 'light' ? false : document.documentElement.dataset.theme === 'dark';
    }
  } else if (bgHex.length === 7) {
    const r=parseInt(bgHex.slice(1,3),16), g=parseInt(bgHex.slice(3,5),16), b=parseInt(bgHex.slice(5,7),16);
    isDotDark = (0.299*r+0.587*g+0.114*b)/255 < 0.5;
  } else {
    isDotDark = document.documentElement.dataset.theme === 'dark';
  }

  _renderDots(isDotDark);
  // Allow _bgSampler to recolor dots once local brightness is known
  if (!cfg.color) el._recolorLife = _renderDots;
}

// ── Coloris global init ──────────────────────────────────────────────────────
if (window.Coloris) {
  Coloris.init();
  Coloris({
    theme: 'default',
    themeMode: 'auto',
    formatToggle: false,
    alpha: false,
    closeButton: false,
    clearButton: false,
    swatches: [],
    onChange: (color, input) => {
      if (input && input.id === 'wEditColor') {
        const val = color.toLowerCase();
        document.querySelectorAll('.color-swatch[data-color]').forEach(b => {
          b.classList.toggle('is-sel', b.dataset.color.toLowerCase() === val);
        });
      }
    }
  });
}
