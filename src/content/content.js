/* AdStash content script — tombol Simpan, ekstraksi postingan, dan modal simpan.
 * Berjalan di facebook.com, instagram.com, tiktok.com. Semua UI ada di Shadow DOM
 * supaya tidak bentrok dengan CSS halaman. */
(() => {
  if (window.__adstashLoaded) return;
  window.__adstashLoaded = true;

  const HOST = location.hostname;
  const PLATFORM = /(^|\.)facebook\.com$/.test(HOST) ? 'facebook'
    : /(^|\.)instagram\.com$/.test(HOST) ? 'instagram'
    : /(^|\.)tiktok\.com$/.test(HOST) ? 'tiktok' : 'other';
  const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', other: 'Web' };
  const SOURCE_LABEL = { feed: 'Feed', meta_library: 'Meta Ad Library', tiktok_cc: 'TikTok Creative Center' };
  /** Sumber halaman saat ini (dihitung ulang karena situs ini SPA). */
  const SOURCE = () =>
    PLATFORM === 'facebook' && /^\/ads\/library/.test(location.pathname) ? 'meta_library'
    : /^ads\.tiktok\.com$/.test(HOST) && /creativecenter/.test(location.pathname) ? 'tiktok_cc'
    : 'feed';

  let enabled = true;
  let categories = [];
  let lastCategory = '';

  function applySettings(s) {
    s = s || {};
    enabled = !s.enabled || s.enabled[PLATFORM] !== false;
    categories = s.categories || [];
    lastCategory = s.lastCategory || '';
    if (!enabled) hideButton(true);
  }
  chrome.storage.local.get('settings', ({ settings }) => {
    if (settings) applySettings(settings);
    else chrome.runtime.sendMessage({ type: 'getSettings' }, applySettings);
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.settings) applySettings(ch.settings.newValue);
  });

  /* ------------------------------------------------------------------ */
  /* Ikon                                                                 */
  /* ------------------------------------------------------------------ */
  const ICON = {
    bookmark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 20.3s-7.8-4.6-7.8-10.3A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.8 2.6c0 5.7-7.8 10.3-7.8 10.3z"/></svg>',
    rec: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>',
    video: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>'
  };

  /* ------------------------------------------------------------------ */
  /* Shadow root + CSS                                                    */
  /* ------------------------------------------------------------------ */
  const hostEl = document.createElement('adstash-root');
  hostEl.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const root = hostEl.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
    .btn-float{position:fixed;display:none;align-items:center;gap:6px;height:32px;padding:0 12px 0 10px;border-radius:999px;border:0;
      background:#F2542D;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);
      transition:transform .12s ease,background .12s ease;z-index:2147483646;white-space:nowrap}
    .btn-float:hover{transform:translateY(-1px);background:#DA4520}
    .btn-float.saved{background:#1F9D55}
    .btn-float.show{display:inline-flex}
    .overlay{position:fixed;inset:0;background:rgba(15,15,20,.55);display:flex;align-items:center;justify-content:center;
      z-index:2147483647;padding:20px;animation:fade .15s ease}
    @keyframes fade{from{opacity:0}to{opacity:1}}
    .panel{background:#fff;color:#1A1A1A;width:min(920px,100%);max-height:calc(100vh - 40px);border-radius:16px;display:flex;flex-direction:column;
      box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden;font-size:14px;line-height:1.45}
    .head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #EEE}
    .head h2{margin:0;font-size:16px;font-weight:700;flex:1}
    .pill{font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#F3F3F1;color:#555}
    .icon-btn{border:0;background:transparent;color:#666;cursor:pointer;padding:6px;border-radius:8px;display:inline-flex}
    .icon-btn:hover{background:#F3F3F1;color:#111}
    .body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:0;overflow:auto;flex:1}
    .media-col{padding:16px;background:#FAFAF8;border-right:1px solid #EEE;overflow:auto}
    .form-col{padding:16px 18px;overflow:auto}
    .media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .media-grid.single{grid-template-columns:1fr}
    .m-item{position:relative;border-radius:10px;overflow:hidden;background:#E9E9E6;aspect-ratio:4/5;cursor:pointer;border:2px solid transparent}
    .m-item.sel{border-color:#F2542D}
    .m-item img{width:100%;height:100%;object-fit:cover;display:block}
    .m-item .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#888}
    .m-item .tick{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.9);
      border:1.5px solid #bbb;display:flex;align-items:center;justify-content:center;color:#fff}
    .m-item.sel .tick{background:#F2542D;border-color:#F2542D}
    .m-item .kind{position:absolute;left:6px;top:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,.6);color:#fff;padding:2px 6px;border-radius:6px}
    .m-item .vstat{position:absolute;left:6px;right:6px;bottom:6px;font-size:11px;background:rgba(0,0,0,.72);color:#fff;padding:6px 8px;border-radius:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .m-item .vstat button{border:0;background:#F2542D;color:#fff;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
    .m-item .vstat.ok{background:rgba(31,157,85,.9)}
    .hint{font-size:12px;color:#777;margin-top:10px}
    .empty-media{padding:30px 10px;text-align:center;color:#888;font-size:13px}
    label.f{display:block;font-size:12px;font-weight:600;color:#555;margin:0 0 5px}
    .row{margin-bottom:12px}
    .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    input[type=text],textarea,select{width:100%;border:1px solid #DDD;border-radius:9px;padding:8px 10px;font-size:13.5px;color:#1A1A1A;background:#fff;outline:none}
    input[type=text]:focus,textarea:focus,select:focus{border-color:#F2542D;box-shadow:0 0 0 3px rgba(242,84,45,.15)}
    textarea{resize:vertical;min-height:38px;line-height:1.45}
    .cat-wrap{display:flex;gap:6px}
    .cat-wrap select{flex:1}
    .small-btn{border:1px solid #DDD;background:#fff;border-radius:9px;padding:0 10px;font-size:12.5px;cursor:pointer;color:#333;white-space:nowrap}
    .small-btn:hover{background:#F6F6F4}
    .rate{display:flex;align-items:center;gap:14px}
    .stars{display:flex;gap:2px}
    .stars button,.fav{border:0;background:transparent;cursor:pointer;padding:2px;display:inline-flex}
    .stars svg{fill:#DDD}.stars button.on svg{fill:#F5A524}
    .fav svg{fill:none;stroke:#999;stroke-width:2}.fav.on svg{fill:#E5484D;stroke:#E5484D}
    .foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #EEE;background:#fff}
    .foot .meta{flex:1;font-size:12px;color:#777}
    .btn{border:0;border-radius:10px;padding:9px 16px;font-size:13.5px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#F3F3F1;color:#333}.btn.ghost:hover{background:#EAEAE6}
    .btn.primary{background:#F2542D;color:#fff}.btn.primary:hover{background:#DA4520}
    .btn:disabled{opacity:.6;cursor:default}
    .toast{position:fixed;right:20px;bottom:20px;background:#1A1A1A;color:#fff;padding:12px 14px;border-radius:12px;font-size:13px;
      display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);z-index:2147483647;max-width:380px;animation:fade .15s ease}
    .toast a{color:#FFB199;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
    .recbar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1A1A1A;color:#fff;border-radius:999px;padding:8px 10px 8px 16px;
      display:flex;align-items:center;gap:12px;font-size:13px;z-index:2147483647;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    .recbar .dot{width:10px;height:10px;border-radius:50%;background:#E5484D;animation:blink 1s infinite}
    @keyframes blink{50%{opacity:.25}}
    .recbar button{border:0;background:#fff;color:#111;font-weight:700;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:12px}
    .intel{border:1px solid #F1D9CF;background:#FFF8F5;border-radius:12px;padding:0 12px;margin-bottom:14px}
    .intel summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:10px 0;font-weight:700;font-size:13px}
    .intel summary::-webkit-details-marker{display:none}
    .intel summary::after{content:'▾';margin-left:auto;color:#999;font-size:12px}
    .intel[open] summary::after{content:'▴'}
    .intel-sum{font-weight:500;color:#8A4B35;font-size:12px}
    .row3,.row4{display:grid;gap:8px;margin-bottom:10px}
    .row3{grid-template-columns:1.2fr 1fr .8fr}.row4{grid-template-columns:repeat(4,1fr)}
    input[type=date],input[type=number]{width:100%;border:1px solid #DDD;border-radius:9px;padding:7px 8px;font-size:13px;color:#1A1A1A;background:#fff;outline:none}
    input[type=date]:focus,input[type=number]:focus{border-color:#F2542D}
    .cc-line{font-size:12px;color:#555;margin:-2px 0 8px}
    .intel-hint{font-size:11.5px;color:#8A8A85;margin-bottom:10px}
    .merge{display:flex;align-items:flex-start;gap:8px;padding:10px 18px;background:#EEF6FF;border-bottom:1px solid #D7E6F7;font-size:12.5px;color:#1D3F66;cursor:pointer}
    .merge input{margin-top:2px;flex:0 0 auto}
    .merge.weak{background:#FFF7E6;border-bottom-color:#F3DFB4;color:#6B4A0E}
    .merge-txt{display:flex;gap:12px;align-items:flex-start}
    .cmp{display:flex;gap:6px;flex:0 0 auto}
    .cmp-item{display:flex;flex-direction:column;align-items:center;gap:2px}
    .cmp-item img,.cmp-item i{width:54px;height:54px;object-fit:cover;border-radius:8px;background:#ddd;display:block;border:1px solid rgba(0,0,0,.08)}
    .cmp-item small{font-size:10px;opacity:.8}
    .cmp-txt{line-height:1.45}
    @media (max-width:720px){.body{grid-template-columns:1fr}.media-col{border-right:0;border-bottom:1px solid #EEE}}
  </style>
  <button class="btn-float" part="save-btn" title="Simpan ke AdStash (Alt+Shift+S)">${ICON.bookmark}<span>Simpan</span></button>`;
  (document.body || document.documentElement).appendChild(hostEl);

  const floatBtn = root.querySelector('.btn-float');
  const floatLabel = floatBtn.querySelector('span');

  // Cegah shortcut keyboard halaman (mis. J/K/L di FB/IG) saat mengetik di UI kita
  ['keydown', 'keyup', 'keypress'].forEach((t) =>
    root.addEventListener(t, (e) => e.stopPropagation()));

  /* ------------------------------------------------------------------ */
  /* Utilitas                                                             */
  /* ------------------------------------------------------------------ */
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const text = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const abs = (href) => { try { return new URL(href, location.href).href; } catch { return ''; } };

  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  function outermost(el, sel) {
    let found = null;
    let cur = el && el.closest(sel);
    while (cur) { found = cur; cur = cur.parentElement && cur.parentElement.closest(sel); }
    return found;
  }

  function videoAtPoint(x, y) {
    if (x == null) return null;
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el.tagName === 'VIDEO') {
        const r = visibleRect(el);
        if (r && r.width >= 160 && r.height >= 160) return el;
      }
    }
    return null;
  }

  /** Bungkus video: naik selama ukuran induk masih "sekitar" ukuran video. */
  function videoWrapper(video) {
    const vr = video.getBoundingClientRect();
    let el = video;
    for (let i = 0; i < 12 && el.parentElement && el.parentElement !== document.body; i++) {
      const pr = el.parentElement.getBoundingClientRect();
      if (pr.height > vr.height * 1.35 + 40 || pr.width > vr.width * 2.6 + 40) break;
      el = el.parentElement;
    }
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Menemukan "kontainer postingan"                                      */
  /* ------------------------------------------------------------------ */
  function findContainer(target, x, y) {
    if (!target || target === hostEl || !(target instanceof Element)) return null;
    let c = null;
    const src = SOURCE();
    if (src !== 'feed') {
      // Ad Library / Creative Center: kartu sudah ditandai oleh scanCards()
      c = target.closest('[data-adstash-card]');
      return c && visibleRect(c) ? c : null;
    }
    if (PLATFORM === 'facebook') {
      c = target.closest('div[aria-posinset]') || outermost(target, 'div[role="article"]');
    } else if (PLATFORM === 'instagram') {
      c = target.closest('article');
    } else if (PLATFORM === 'tiktok') {
      c = target.closest('[data-e2e="recommend-list-item-container"], article, [data-e2e="search_top-item"], [class*="DivItemContainer"]');
    }
    if (c && visibleRect(c) && c.getBoundingClientRect().height > 120) return c;
    // Reels / halaman video penuh: pakai bungkus video di bawah kursor
    const v = target.tagName === 'VIDEO' ? target : videoAtPoint(x, y);
    if (v) return videoWrapper(v);
    return null;
  }

  /** Fallback untuk klik kanan di elemen mana pun. */
  function genericContainer(target) {
    if (!target || !(target instanceof Element)) return null;
    const specific = findContainer(target);
    if (specific) return specific;
    let el = target;
    for (let i = 0; i < 14 && el && el !== document.body; i++) {
      const r = el.getBoundingClientRect();
      if (r.height >= 250 && r.width >= 200 && el.querySelector('img, video')) return el;
      el = el.parentElement;
    }
    return target.closest('img, video') || target;
  }

  /* ------------------------------------------------------------------ */
  /* Ekstraksi data                                                       */
  /* ------------------------------------------------------------------ */
  function bestSrc(img) {
    let best = img.currentSrc || img.src || '';
    let bestW = 0;
    const ss = img.getAttribute('srcset');
    if (ss) {
      for (const part of ss.split(',')) {
        const [u, d] = part.trim().split(/\s+/);
        const w = parseInt(d, 10) || 0;
        if (u && w >= bestW) { bestW = w; best = u; }
      }
    }
    return abs(best);
  }

  function isAvatarLike(img) {
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (/profile picture|foto profil|avatar|profilbild/.test(alt)) return true;
    if (/emoji|static\.xx\.fbcdn|rsrc\.php/.test(img.src)) return true;
    const r = img.getBoundingClientRect();
    if (r.width < 110 || r.height < 110) return true;
    if (img.naturalWidth && img.naturalWidth < 150) return true;
    return false;
  }

  function collectMedia(container) {
    const out = [];
    const seen = new Set();
    const scope = container.tagName === 'VIDEO' || container.tagName === 'IMG' ? container.parentElement || container : container;
    const vids = container.tagName === 'VIDEO' ? [container] : $$('video', scope);
    for (const v of vids) {
      const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src) || '';
      const key = src || ('video#' + out.length);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'video', url: src, poster: v.poster ? abs(v.poster) : '', el: v });
    }
    const imgs = container.tagName === 'IMG' ? [container] : $$('img', scope);
    for (const img of imgs) {
      if (isAvatarLike(img)) continue;
      // lewati gambar yang sebenarnya poster video yang sudah ada
      if (img.closest('video')) continue;
      const src = bestSrc(img);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push({ kind: 'image', url: src, el: img });
      if (out.length >= 20) break;
    }
    return out;
  }

  function cleanUrl(u) {
    try {
      const url = new URL(u, location.href);
      ['__cft__[0]', '__tn__', 'fbclid', 'igshid', 'igsh', '_r', 'is_from_webapp', 'sender_device', 'ref', 'mibextid']
        .forEach((k) => url.searchParams.delete(k));
      for (const k of [...url.searchParams.keys()]) if (k.startsWith('__cft__')) url.searchParams.delete(k);
      return url.href;
    } catch { return u || ''; }
  }

  function decodeOutbound(href) {
    try {
      const u = new URL(href, location.href);
      if (/^(l|lm)\.facebook\.com$|^l\.instagram\.com$/.test(u.hostname)) {
        const target = u.searchParams.get('u');
        if (target) return cleanUrl(target);
      }
      return null;
    } catch { return null; }
  }

  const INTERNAL_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|messenger\.com|whatsapp\.com|fbcdn\.net|cdninstagram\.com|tiktokcdn\.com)$/;

  /* --- Label bahasa/UI situs: default + pembaruan jarak jauh (hanya daftar kata, bukan kode) --- */
  const L0 = {
    libraryId: ['Library ID', 'ID Galeri', 'ID Pustaka', 'ID Arsip', 'ID Perpustakaan'],
    startedRunning: ['started running on', 'mulai ditayangkan pada', 'mulai ditayangkan', 'mulai tayang pada', 'mulai berjalan pada'],
    active: ['active', 'aktif'],
    inactive: ['inactive', 'tidak aktif', 'nonaktif'],
    variationsUse: ['use', 'menggunakan'],
    cta: ['shop now', 'belanja sekarang', 'send message', 'kirim pesan', 'send whatsapp message', 'kirim pesan whatsapp', 'whatsapp', 'learn more', 'pelajari selengkapnya', 'sign up', 'daftar', 'order now', 'pesan sekarang', 'beli sekarang', 'download', 'unduh', 'install now', 'instal sekarang', 'book now', 'pesan', 'get offer', 'dapatkan penawaran', 'contact us', 'hubungi kami', 'apply now', 'daftar sekarang', 'watch more', 'tonton lainnya', 'get quote', 'minta penawaran', 'call now', 'telepon sekarang', 'subscribe', 'berlangganan', 'see menu', 'lihat menu', 'get directions', 'buy tickets', 'play game', 'use app'],
    cc: {
      likes: ['likes', 'like', 'suka'], comments: ['comments', 'comment', 'komentar'], shares: ['shares', 'share', 'dibagikan', 'bagikan'],
      ctr: ['ctr'], budget: ['budget', 'anggaran'], objective: ['campaign objective', 'objective', 'tujuan kampanye', 'tujuan'],
      industry: ['industry', 'industri'], region: ['region', 'wilayah', 'negara']
    }
  };
  let L = L0;
  let CTA_RE, LIB_LABEL, LIB_ID_RE, LIB_ID_RE_G, LIB_META, STARTED_RE, ACTIVE_RE, INACTIVE_RE, VAR_RE;
  let CC_LABEL = {};
  const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const alt = (list) => [...list].sort((a, b) => b.length - a.length).map(reEsc).join('|');
  function mergeLabels(remote) {
    const out = { ...L0, cc: { ...L0.cc } };
    const ok = (a) => Array.isArray(a) && a.every((w) => typeof w === 'string' && w.length >= 2 && w.length <= 60) && a.length <= 40;
    if (remote && typeof remote === 'object') {
      for (const k of Object.keys(L0)) {
        if (k === 'cc') continue;
        // gabungkan: kata bawaan tetap ada, kata baru dari remote ditambahkan
        if (ok(remote[k])) out[k] = [...new Set([...L0[k], ...remote[k]])];
      }
      if (remote.cc && typeof remote.cc === 'object') {
        for (const k of Object.keys(L0.cc)) if (ok(remote.cc[k])) out.cc[k] = [...new Set([...L0.cc[k], ...remote.cc[k]])];
      }
    }
    return out;
  }
  function rebuildLabels(remote) {
    L = mergeLabels(remote);
    CTA_RE = new RegExp('^(' + alt(L.cta) + ')$', 'i');
    const ids = alt(L.libraryId);
    LIB_LABEL = new RegExp('(' + ids + ')', 'i');
    LIB_ID_RE = new RegExp('(?:' + ids + ')\\s*:?\\s*(\\d{6,})', 'i');
    LIB_ID_RE_G = new RegExp('(?:' + ids + ')\\s*:?\\s*\\d{6,}', 'gi');
    LIB_META = new RegExp(ids + '|' + alt(L.startedRunning) + '|Started running|Mulai ditayangkan|Mulai tayang|See ad details|See summary details|Lihat detail|Lihat ringkasan|^Sponsored$|^Bersponsor$|^Platforms?$|^Platform$|ads? use this creative|iklan menggunakan', 'i');
    STARTED_RE = new RegExp('(?:' + alt(L.startedRunning) + ')\\s+(.+)', 'i');
    ACTIVE_RE = new RegExp('^(' + alt(L.active) + ')$', 'i');
    INACTIVE_RE = new RegExp('^(' + alt(L.inactive) + ')$', 'i');
    VAR_RE = new RegExp('(\\d+)\\s+(?:ads?|iklan)\\s+(?:' + alt(L.variationsUse) + ')', 'i');
    for (const k of Object.keys(L.cc)) CC_LABEL[k] = new RegExp('^(' + alt(L.cc[k]) + ')', 'i');
  }
  rebuildLabels(null);
  try {
    chrome.storage.local.get('remoteConfig').then(({ remoteConfig }) => {
      if (remoteConfig && remoteConfig.labels) { rebuildLabels(remoteConfig.labels); scheduleScan(); }
    }).catch(() => {});
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.remoteConfig) { rebuildLabels(ch.remoteConfig.newValue && ch.remoteConfig.newValue.labels); scheduleScan(); }
    });
  } catch {}
  const looksLikeDomain = (t) => /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t) || /https?:|www\./i.test(t);

  function outboundOf(a) {
    const href = a.getAttribute('href') || '';
    const decoded = decodeOutbound(href);
    if (decoded) return decoded;
    try {
      const u = new URL(href, location.href);
      if (/^https?:$/.test(u.protocol) && !INTERNAL_HOST.test(u.hostname)) return cleanUrl(u.href);
    } catch {}
    return '';
  }

  function findLanding(container) {
    let landingUrl = '';
    let cta = '';
    let fallbackCta = '';
    for (const a of $$('a[href]', container)) {
      const target = outboundOf(a);
      if (!target) continue;
      if (!landingUrl) landingUrl = target;
      const ls = text(a).split('\n').map((x) => x.trim()).filter(Boolean);
      const hit = ls.find((l) => CTA_RE.test(l));
      if (!cta && hit) cta = hit;
      const t = ls[0] || '';
      if (!fallbackCta && t && t.length <= 30 && !looksLikeDomain(t)) fallbackCta = t;
    }
    // CTA tanpa link luar (mis. "Kirim Pesan" ke Messenger/WhatsApp)
    if (!cta) {
      for (const el of $$('a[href], div[role="button"], button, [role="link"]', container)) {
        const t = text(el).split('\n')[0];
        if (!CTA_RE.test(t)) continue;
        cta = t;
        const href = el.getAttribute && el.getAttribute('href');
        if (!landingUrl && href && /wa\.me|whatsapp|m\.me/.test(href)) landingUrl = abs(href);
        break;
      }
    }
    return { landingUrl, cta: cta || fallbackCta };
  }

  const MORE_RE = /^(see more|lihat selengkapnya|selengkapnya|more|… more|\.\.\. more|lainnya|lebih banyak|… lainnya)$/i;

  async function expandCaption(container) {
    let clicked = 0;
    for (const el of $$('div[role="button"], span[role="button"], button, span', container)) {
      if (clicked >= 2) break;
      if (el.closest('a[href]')) continue;
      if (el.children.length > 2) continue;
      const t = text(el);
      if (t.length > 22 || !MORE_RE.test(t)) continue;
      try { el.click(); clicked++; } catch {}
    }
    if (clicked) await sleep(350);
  }

  /** Artikel bersarang di dalam artikel lain = komentar (FB). */
  function isNestedArticle(art, container) {
    if (!art || art === container || !container.contains(art)) return false;
    const outer = art.parentElement && art.parentElement.closest('[role="article"]');
    return !!outer && container.contains(outer);
  }

  function longestText(container, selectors, exclude = []) {
    let best = '';
    for (const el of $$(selectors, container)) {
      if (exclude.some((x) => x && x.contains(el))) continue;
      // abaikan teks di dalam komentar (artikel bersarang di FB)
      if (PLATFORM === 'facebook' && isNestedArticle(el.closest('[role="article"]'), container)) continue;
      const t = text(el);
      if (t.length > best.length && t.length < 6000) best = t;
    }
    return best;
  }

  function stripCaption(c) {
    return (c || '')
      .replace(/\s*(… |\.\.\. )?(see more|lihat selengkapnya|more|lainnya|see less|sembunyikan|lebih sedikit)\s*$/i, '')
      .trim();
  }

  function extractFacebook(c) {
    let advertiser = '';
    let advertiserUrl = '';
    for (const sel of ['h2 a', 'h3 a', 'h4 a', 'strong a', 'a strong', 'h2 span', 'h3 span', 'h4 span']) {
      const el = c.querySelector(sel);
      const t = text(el);
      if (t && t.length < 90) {
        advertiser = t.split('\n')[0];
        const a = el.closest('a') || el.querySelector('a');
        if (a) advertiserUrl = cleanUrl(a.href).replace(/\?$/, '');
        break;
      }
    }
    const msgEls = $$('[data-ad-comet-preview="message"], [data-ad-preview="message"]', c);
    let caption = msgEls.map(text).filter(Boolean).join('\n\n');
    if (!caption) caption = longestText(c, 'div[dir="auto"], span[dir="auto"]');
    let postUrl = '';
    for (const a of $$('a[href]', c)) {
      const h = a.getAttribute('href') || '';
      if (/\/(posts|videos|reel|photo|permalink\.php|watch|groups\/[^/]+\/posts)\b|story_fbid=|\/ads\/library\/\?id=/.test(h)) {
        postUrl = cleanUrl(abs(h));
        break;
      }
    }
    if (!postUrl && /\/(reel|posts|videos|watch|permalink)/.test(location.pathname)) postUrl = cleanUrl(location.href);
    return { advertiser, advertiserUrl, caption, postUrl };
  }

  function extractInstagram(c) {
    let advertiser = '';
    let advertiserUrl = '';
    const header = c.querySelector('header');
    const scope = header || c;
    for (const a of $$('a[href]', scope)) {
      const h = a.getAttribute('href') || '';
      const t = text(a);
      if (/^\/[A-Za-z0-9._]+\/?$/.test(h) && t && t.length < 60 && !/^(explore|reels|direct)$/i.test(t)) {
        advertiser = t.split('\n')[0];
        advertiserUrl = abs(h);
        break;
      }
    }
    const caption = longestText(c, 'h1, span[dir="auto"], div[dir="auto"], span', [header]);
    let postUrl = '';
    const a = c.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (a) postUrl = cleanUrl(abs(a.getAttribute('href')));
    else if (/\/(p|reel|reels)\//.test(location.pathname)) postUrl = cleanUrl(location.href);
    return {
      advertiser,
      advertiserUrl,
      caption: advertiser && caption.startsWith(advertiser) ? caption.slice(advertiser.length).trim() : caption,
      postUrl
    };
  }

  function extractTikTok(c) {
    const pick = (sels, scope) => {
      for (const s of sels) {
        const el = (scope || c).querySelector(s);
        if (el && text(el)) return el;
      }
      return null;
    };
    const authorSels = ['[data-e2e="video-author-uniqueid"]', '[data-e2e="feed-video-nickname"]', '[data-e2e="browse-username"]', '[data-e2e="video-author-nickname"]', 'a[href^="/@"] h3', 'a[href^="/@"]'];
    const descSels = ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="search-card-video-caption"]'];
    const authorEl = pick(authorSels) || pick(authorSels, document);
    const descEl = pick(descSels) || pick(descSels, document);
    const advertiser = text(authorEl).split('\n')[0];
    const aLink = (authorEl && authorEl.closest('a[href^="/@"], a[href*="tiktok.com/@"]')) || c.querySelector('a[href^="/@"]');
    let postUrl = '';
    const vA = c.querySelector('a[href*="/video/"], a[href*="/photo/"]');
    if (vA) postUrl = cleanUrl(abs(vA.getAttribute('href')));
    else if (/\/(video|photo)\//.test(location.pathname)) postUrl = cleanUrl(location.href);
    const advertiserUrl = aLink ? abs(aLink.getAttribute('href')).split('?')[0] : '';
    if (!postUrl && advertiserUrl) {
      // Feed For You: ID video ada di id pemutar, mis. "xgwrapper-0-7312345678901234567"
      const w = c.querySelector('[id^="xgwrapper-"], [id*="-video-"]');
      const m = w && w.id.match(/(\d{15,})$/);
      if (m) postUrl = `${advertiserUrl.replace(/\/$/, '')}/video/${m[1]}`;
    }
    return {
      advertiser,
      advertiserUrl,
      caption: text(descEl) || longestText(c, 'span, div[dir="auto"]'),
      postUrl
    };
  }

  async function extract(container) {
    await expandCaption(container);
    const src = SOURCE();
    let base;
    let intel = { source: src };
    if (src === 'meta_library') {
      base = extractMetaLibrary(container);
      intel = { ...intel, ...libraryIntel(container) };
    } else if (src === 'tiktok_cc') {
      base = extractCC(container);
      intel = { ...intel, cc: ccMetrics(container) };
    } else if (PLATFORM === 'facebook') base = extractFacebook(container);
    else if (PLATFORM === 'instagram') base = extractInstagram(container);
    else if (PLATFORM === 'tiktok') base = extractTikTok(container);
    else base = { advertiser: '', advertiserUrl: '', caption: longestText(container, 'p, span, div'), postUrl: location.href };
    const { landingUrl, cta } = findLanding(container);
    return {
      platform: PLATFORM,
      ...base,
      caption: stripCaption(base.caption),
      landingUrl,
      cta,
      pageUrl: location.href,
      media: collectMedia(container),
      intel,
      stats: extractStats(container)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Sinyal winning: angka, tanggal, Ad Library, Creative Center          */
  /* ------------------------------------------------------------------ */
  const NUM = '(\\d[\\d.,]*\\s*(?:k|rb|ribu|m|jt|juta)?)';

  /** "1,2 rb" → 1200, "1.2K" → 1200, "1.024" → 1024, "3,4 jt" → 3400000 */
  function parseCount(raw) {
    if (raw == null) return null;
    const m = String(raw).toLowerCase().match(/(\d[\d.,]*)\s*(k|rb|ribu|m|jt|juta)?(?![a-z])/);
    if (!m) return null;
    const suf = m[2] || '';
    const mult = /^(k|rb|ribu)$/.test(suf) ? 1e3 : /^(m|jt|juta)$/.test(suf) ? 1e6 : 1;
    if (mult > 1) {
      const v = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      return isNaN(v) ? null : Math.round(v * mult);
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(m[1])) return parseInt(m[1].replace(/[.,]/g, ''), 10);
    const v = parseFloat(m[1].replace(',', '.'));
    return isNaN(v) ? null : Math.round(v);
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7, agt: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };
  const iso = (y, mo, d) => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  /** "Nov 1, 2026" | "1 Nov 2026" | "1 November 2026" | "2026-11-01" → "2026-11-01" */
  function parseHumanDate(s) {
    if (!s) return '';
    s = String(s).trim();
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] != null) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return '';
  }

  /** Teks kontainer tanpa komentar bersarang + aria-label (FB menaruh jumlah reaksi di aria-label). */
  function statsHaystack(c) {
    let t = text(c);
    if (PLATFORM === 'facebook') {
      for (const art of $$('[role="article"]', c)) {
        if (isNestedArticle(art, c)) { const at = text(art); if (at) t = t.replace(at, ' '); }
      }
    }
    const labels = $$('[aria-label]', c).slice(0, 300).map((el) => el.getAttribute('aria-label'));
    return t + '\n' + labels.join('\n');
  }

  function firstMatch(hay, res) {
    for (const re of res) {
      const m = hay.match(re);
      if (m) { const v = parseCount(m[1]); if (v != null) return v; }
    }
    return null;
  }

  function extractStats(c) {
    const s = {};
    const src = SOURCE();
    if (src === 'tiktok_cc') {
      const cc = ccMetrics(c);
      s.likes = parseCount(cc.likes);
      s.comments = parseCount(cc.comments);
      s.shares = parseCount(cc.shares);
    } else if (PLATFORM === 'tiktok') {
      const pick = (keys) => {
        for (const k of keys) {
          const el = c.querySelector(`[data-e2e="${k}"]`) || document.querySelector(`[data-e2e="${k}"]`);
          if (el && text(el)) return parseCount(text(el));
        }
        return null;
      };
      s.likes = pick(['like-count', 'browse-like-count']);
      s.comments = pick(['comment-count', 'browse-comment-count']);
      s.shares = pick(['share-count', 'browse-share-count']);
      s.saves = pick(['undefined-count', 'favorite-count', 'collect-count', 'browse-favorite-count']);
      s.views = pick(['video-views', 'play-count']);
    } else if (src === 'feed') {
      // IG: hitungan like post ada di <section>, bukan di like komentar
      const scope = PLATFORM === 'instagram' ? ($$('section', c).find((x) => /\b(likes?|suka|others|lainnya)\b/i.test(text(x))) || c) : c;
      const hay = statsHaystack(scope);
      const full = scope === c ? hay : statsHaystack(c);
      s.likes = firstMatch(hay, [
        new RegExp('(?:all reactions|semua reaksi)\\s*:?\\s*' + NUM, 'i'),
        new RegExp(NUM + '\\s*(?:likes?|suka|reactions?|reaksi|tanggapan)\\b', 'i')
      ]);
      if (s.likes == null) {
        const m = hay.match(new RegExp('(?:and|dan)\\s+' + NUM + '\\s*(?:others|lainnya)', 'i'));
        if (m) s.likes = parseCount(m[1]) + 1;
      }
      s.comments = firstMatch(full, [new RegExp(NUM + '\\s*(?:comments?|komentar)\\b', 'i')]);
      s.shares = firstMatch(full, [new RegExp(NUM + '\\s*(?:shares?|kali dibagikan|dibagikan)\\b', 'i')]);
      s.views = firstMatch(full, [new RegExp(NUM + '\\s*(?:views|plays|kali ditonton|x ditonton|tayangan|penayangan)\\b', 'i')]);
    }
    Object.keys(s).forEach((k) => { if (s[k] == null) delete s[k]; });
    return Object.keys(s).length ? { at: Date.now(), ...s } : null;
  }

  /* --- Meta Ad Library --- */

  function libraryIntel(card) {
    const t = text(card);
    const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
    const out = { libraryId: '', active: null, startDate: '', endDate: '', variations: null, checkedAt: Date.now() };
    const idm = t.match(LIB_ID_RE);
    if (idm) out.libraryId = idm[1];
    if (lines.some((l) => INACTIVE_RE.test(l))) out.active = false;
    else if (lines.some((l) => ACTIVE_RE.test(l))) out.active = true;
    for (const l of lines) {
      const sm = l.match(STARTED_RE);
      if (sm && !out.startDate) out.startDate = parseHumanDate(sm[1]);
      const rm = l.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (rm && !out.startDate) {
        const a = parseHumanDate(rm[1]);
        const b = parseHumanDate(rm[2]);
        if (a && b) { out.startDate = a; out.endDate = b; }
      }
    }
    const vm = t.match(VAR_RE);
    if (vm) out.variations = parseInt(vm[1], 10);
    else if (/multiple versions|beberapa versi/i.test(t)) out.variations = 2;
    return out;
  }

  function extractMetaLibrary(card) {
    const lines = text(card).split('\n').map((x) => x.trim()).filter(Boolean);
    let advertiser = '';
    let advertiserUrl = '';
    for (const a of $$('a[href]', card)) {
      const h = a.getAttribute('href') || '';
      const t = text(a);
      if (/facebook\.com\/(?!ads\/|l\.php)[^/?#]+/.test(abs(h)) && t && t.length < 80 && !LIB_META.test(t)) {
        advertiser = t.split('\n')[0];
        advertiserUrl = cleanUrl(abs(h));
        break;
      }
    }
    if (!advertiser) {
      const i = lines.findIndex((l) => /^(sponsored|bersponsor)$/i.test(l));
      if (i > 0) advertiser = lines[i - 1];
    }
    let caption = '';
    for (const el of $$('div, span', card)) {
      const t = text(el);
      if (t.length <= caption.length || t.length > 5000) continue;
      if (LIB_META.test(t) || t === advertiser) continue;
      if (t.split('\n').some((l) => LIB_META.test(l.trim()))) continue;
      caption = t;
    }
    const id = (text(card).match(LIB_ID_RE) || [])[1];
    return {
      advertiser,
      advertiserUrl,
      caption,
      postUrl: id ? `https://www.facebook.com/ads/library/?id=${id}` : cleanUrl(location.href)
    };
  }

  /* --- TikTok Creative Center --- */
  function labelValue(lines, labelRe, valueRe) {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      const same = lines[i].replace(labelRe, '').replace(/^[\s:：]+/, '').trim();
      if (same && valueRe.test(same)) return same;
      if (lines[i + 1] && valueRe.test(lines[i + 1])) return lines[i + 1];
      if (lines[i - 1] && valueRe.test(lines[i - 1])) return lines[i - 1];
    }
    return '';
  }

  function ccMetrics(c) {
    const lines = text(c).split('\n').map((x) => x.trim()).filter(Boolean);
    const num = /^\d[\d.,]*\s*(k|m|rb|jt)?$/i;
    const word = /^[^\d:]{2,40}$/;
    return {
      // Label bisa menempel dengan nilainya ("Likes120.5K"), jadi tanpa \b; nilai divalidasi regex kedua
      likes: labelValue(lines, CC_LABEL.likes, num),
      comments: labelValue(lines, CC_LABEL.comments, num),
      shares: labelValue(lines, CC_LABEL.shares, num),
      ctr: labelValue(lines, CC_LABEL.ctr, /%|top|tinggi|high|low|rendah/i),
      budget: labelValue(lines, CC_LABEL.budget, /^(low|medium|high|rendah|sedang|tinggi)$/i),
      objective: labelValue(lines, CC_LABEL.objective, word),
      industry: labelValue(lines, CC_LABEL.industry, word),
      region: labelValue(lines, CC_LABEL.region, word)
    };
  }

  function extractCC(card) {
    const CC_META = new RegExp('^(' + alt(Object.values(L.cc).flat()) + '|see analytics|lihat analitik|details?|detail)$', 'i');
    let advertiser = '';
    const brand = card.querySelector('[class*="brand" i], [class*="advertiser" i], [class*="Brand"], [class*="Advertiser"]');
    if (brand && text(brand).length < 80) advertiser = text(brand).split('\n')[0];
    let caption = '';
    for (const el of $$('div, span, p', card)) {
      const t = text(el);
      if (t.length <= caption.length || t.length > 3000) continue;
      if (t.split('\n').some((l) => CC_META.test(l.trim()))) continue;
      if (t === advertiser) continue;
      caption = t;
    }
    const a = card.querySelector('a[href*="topads"], a[href*="material_id"], a[href*="/detail"]');
    return {
      advertiser,
      advertiserUrl: '',
      caption,
      postUrl: a ? abs(a.getAttribute('href')) : (/\/topads\/[^/]+\/?\w*/.test(location.pathname) || /material_id|id=/.test(location.search) ? location.href : '')
    };
  }

  /* --- Penanda kartu di Ad Library & Creative Center --- */
  function bigMediaCount(el) {
    let n = 0;
    for (const m of $$('video, img', el)) {
      const r = m.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 90) n++;
      if (n > 1) break;
    }
    return n;
  }

  function scanCards() {
    const src = SOURCE();
    if (src === 'feed' || !document.body) return;
    const labelTest = src === 'meta_library' ? (v) => LIB_LABEL.test(v) : (v) => { const t = v.trim().toLowerCase(); return L.cc.ctr.concat(L.cc.likes).some((w) => w.toLowerCase() === t); };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const starts = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.length < 80 && labelTest(n.nodeValue)) starts.push(n.parentElement);
    }
    for (const el of starts) {
      if (!el || el.closest('[data-adstash-card]') || hostEl.contains(el)) continue;
      let card = el;
      while (card.parentElement && card.parentElement !== document.body) {
        const p = card.parentElement;
        if (src === 'meta_library') {
          if ((p.textContent.match(LIB_ID_RE_G) || []).length > 1) break;
          if (bigMediaCount(card) && p.getBoundingClientRect().width > card.getBoundingClientRect().width * 1.5 + 20) break;
        } else {
          // Creative Center: satu kartu = satu video/gambar utama
          if (bigMediaCount(card) >= 1 && bigMediaCount(p) > 1) break;
          if (bigMediaCount(card) && p.getBoundingClientRect().width > card.getBoundingClientRect().width * 1.6 + 20) break;
        }
        card = p;
      }
      if (bigMediaCount(card) || src === 'meta_library') card.setAttribute('data-adstash-card', '1');
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanCards, 700);
  }
  new MutationObserver(() => { if (SOURCE() !== 'feed') scheduleScan(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  scheduleScan();

  /* --- Tugas refresh dari Library (tab dibuka oleh ekstensi) --- */
  function mainContainer() {
    if (SOURCE() !== 'feed') {
      scanCards();
      return document.querySelector('[data-adstash-card]');
    }
    if (PLATFORM === 'facebook') return document.querySelector('div[aria-posinset]') || outermost(document.querySelector('[role="main"] [role="article"]'), '[role="article"]') || document.querySelector('[role="main"]');
    if (PLATFORM === 'instagram') return document.querySelector('main article') || document.querySelector('article') || document.querySelector('main');
    return document.querySelector('[data-e2e="recommend-list-item-container"], [data-e2e="browse-video"]') || document.body;
  }

  async function runTask(task) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await sleep(1500);
      let c = mainContainer();
      if (task.libraryId && SOURCE() === 'meta_library') {
        c = $$('[data-adstash-card]').find((x) => text(x).includes(task.libraryId)) || c;
      }
      if (!c) continue;
      await expandCaption(c);
      const stats = extractStats(c);
      const intel = SOURCE() === 'meta_library' ? libraryIntel(c) : SOURCE() === 'tiktok_cc' ? { cc: ccMetrics(c), checkedAt: Date.now() } : null;
      const hasIntel = intel && (intel.startDate || intel.active != null || intel.variations != null || (intel.cc && intel.cc.ctr));
      if (stats || hasIntel) {
        chrome.runtime.sendMessage({ type: 'taskResult', ok: true, stats, intel: hasIntel ? intel : null });
        return;
      }
    }
    chrome.runtime.sendMessage({ type: 'taskResult', ok: false });
  }
  chrome.runtime.sendMessage({ type: 'getTask' }, (task) => {
    if (chrome.runtime.lastError) return;
    if (task) runTask(task);
  });

  /* ------------------------------------------------------------------ */
  /* Tombol Simpan melayang                                               */
  /* ------------------------------------------------------------------ */
  let current = null;
  let hideTimer = null;
  let modalOpen = false;
  const savedContainers = new WeakSet();
  let lastPointer = { x: 0, y: 0 };

  function positionButton() {
    if (!current || !current.isConnected) return hideButton(true);
    const r = current.getBoundingClientRect();
    if (r.bottom < 40 || r.top > window.innerHeight - 40) return hideButton(true);
    const bw = floatBtn.offsetWidth || 96;
    const top = Math.min(Math.max(r.top, 8) + 8, r.bottom - 40);
    const roomRight = window.innerWidth - r.right;
    const left = roomRight > bw + 16 ? r.right + 8 : r.right - bw - 10;
    floatBtn.style.top = `${Math.round(top)}px`;
    floatBtn.style.left = `${Math.round(Math.max(8, left))}px`;
  }

  function showButtonFor(c) {
    clearTimeout(hideTimer);
    if (c !== current) {
      current = c;
      const saved = savedContainers.has(c);
      floatBtn.classList.toggle('saved', saved);
      floatBtn.firstElementChild.outerHTML = saved ? ICON.check : ICON.bookmark;
      floatLabel.textContent = saved ? 'Tersimpan' : 'Simpan';
    }
    floatBtn.classList.add('show');
    positionButton();
  }

  function hideButton(now) {
    clearTimeout(hideTimer);
    const go = () => { floatBtn.classList.remove('show'); current = null; };
    if (now) go(); else hideTimer = setTimeout(go, 700);
  }

  let rafPending = false;
  document.addEventListener('mousemove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY, target: e.target };
    if (!enabled || modalOpen || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (lastPointer.target === hostEl) { clearTimeout(hideTimer); return; }
      const c = findContainer(lastPointer.target, lastPointer.x, lastPointer.y);
      if (c) showButtonFor(c); else if (current) hideButton(false);
    });
  }, { passive: true, capture: true });

  window.addEventListener('scroll', () => { if (current && !modalOpen) positionButton(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { if (current) positionButton(); }, { passive: true });

  floatBtn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  floatBtn.addEventListener('mouseleave', () => hideButton(false));
  floatBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (current) openSaveModal(current);
  });

  // Klik kanan → simpan
  let lastContextTarget = null;
  document.addEventListener('contextmenu', (e) => { lastContextTarget = e.target; }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'saveFromContextMenu' && lastContextTarget) {
      const c = genericContainer(lastContextTarget);
      if (c) openSaveModal(c);
    } else if (msg?.type === 'saveHovered') {
      const c = current || findContainer(lastPointer.target, lastPointer.x, lastPointer.y);
      if (c) openSaveModal(c);
      else toast('Arahkan kursor ke postingan dulu, lalu tekan Alt+Shift+S.');
    }
  });

  /* ------------------------------------------------------------------ */
  /* Media helper: ambil blob, frame poster, rekam video                  */
  /* ------------------------------------------------------------------ */
  async function pageFetch(url, timeoutMs = 60000) {
    if (!url) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        credentials: url.startsWith('blob:') ? 'same-origin' : 'include'
      });
      if (!res.ok) return null;
      const b = await res.blob();
      return b.size && !/text\/html/i.test(b.type) ? b : null;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  function captureFrame(video) {
    return new Promise((resolve) => {
      try {
        if (!video.videoWidth) return resolve(null);
        const max = 960;
        const s = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.round(video.videoWidth * s);
        cv.height = Math.round(video.videoHeight * s);
        cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => resolve(b), 'image/jpeg', 0.85); // throw jika canvas "tainted"
      } catch {
        resolve(null);
      }
    });
  }

  function recordVideo(video, { onTick, maxSec = 300 } = {}) {
    return new Promise((resolve, reject) => {
      let stream;
      try {
        stream = video.captureStream ? video.captureStream() : null;
      } catch (err) {
        return reject(new Error('Video ini diproteksi lintas-domain sehingga tidak bisa direkam.'));
      }
      if (!stream) return reject(new Error('Browser tidak mendukung perekaman video ini.'));
      const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      let rec;
      try { rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined); }
      catch (err) { return reject(err); }
      if (video.error) return reject(new Error('Video gagal diputar di halaman ini, jadi tidak bisa direkam.'));
      const chunks = [];
      let last = 0;
      let stopped = false;
      let failReason = '';
      let lastProgressAt = performance.now();
      let lastProgressTime = -1;
      const start = performance.now();
      const stop = (reason) => {
        if (stopped) return;
        stopped = true;
        if (typeof reason === 'string') failReason = reason;
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('ended', stop);
        clearInterval(tick);
        if (rec.state !== 'inactive') rec.stop();
      };
      const onTime = () => {
        const ct = video.currentTime;
        const dur = isFinite(video.duration) ? video.duration : 0;
        if (ct + 0.6 < last) return stop(); // video berulang (loop)
        last = ct;
        if (dur && ct >= dur - 0.12) stop();
      };
      const tick = setInterval(() => {
        const now = performance.now();
        const sec = (now - start) / 1000;
        const dur = isFinite(video.duration) ? video.duration : 0;
        onTick && onTick(sec, dur);
        if (video.currentTime !== lastProgressTime) { lastProgressTime = video.currentTime; lastProgressAt = now; }
        if (video.error) return stop('Video berhenti karena error pemutaran.');
        // Video tidak bergerak 8 detik → kemungkinan dijeda platform
        if (now - lastProgressAt > 8000) {
          return stop(video.currentTime > 1 ? '' : 'Video tidak berputar. Klik play pada video lalu coba Rekam lagi.');
        }
        if (sec > maxSec || (dur && sec > dur + 6)) stop();
      }, 250);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (failReason) return reject(new Error(failReason));
        const blob = new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] });
        blob.size ? resolve(blob) : reject(new Error('Rekaman kosong.'));
      };
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', stop);
      try { video.currentTime = 0; } catch {}
      rec.start(1000);
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
      recordVideo.stop = stop;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function sendToBackground(meta, items, onProgress) {
    const port = chrome.runtime.connect({ name: 'adstash-save' });
    const result = new Promise((resolve, reject) => {
      port.onMessage.addListener((m) => {
        if (m.t === 'progress') onProgress && onProgress(m.text);
        else if (m.t === 'done') { resolve(m); port.disconnect(); }
        else if (m.t === 'error') { reject(new Error(m.message)); port.disconnect(); }
      });
      port.onDisconnect.addListener(() => reject(new Error('Koneksi ke ekstensi terputus. Muat ulang halaman lalu coba lagi.')));
    });
    port.postMessage({ t: 'begin', ad: meta, items: items.map((it) => ({ kind: it.kind, sourceUrl: it.url || '' })) });
    const CHUNK = 1024 * 1024;
    for (let i = 0; i < items.length; i++) {
      for (const role of ['main', 'poster']) {
        const p = items[i][role];
        if (!p) continue;
        if (p.blob) {
          onProgress && onProgress(`Mengirim media ${i + 1}/${items.length}…`);
          for (let off = 0; off < p.blob.size; off += CHUNK) {
            const data = await blobToBase64(p.blob.slice(off, off + CHUNK));
            port.postMessage({ t: 'chunk', i, role, mime: p.blob.type, data });
          }
        } else if (p.url) {
          port.postMessage({ t: 'url', i, role, url: p.url });
        }
      }
    }
    port.postMessage({ t: 'commit' });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Modal simpan                                                         */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg, action) {
    const old = root.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const a = document.createElement('a');
      a.textContent = action.label;
      a.addEventListener('click', () => { action.onClick(); t.remove(); });
      t.appendChild(a);
    }
    root.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  async function openSaveModal(container) {
    if (modalOpen) return;
    modalOpen = true;
    hideButton(true);
    let data;
    try {
      data = await extract(container);
    } catch (err) {
      modalOpen = false;
      toast('Gagal membaca postingan: ' + err.message);
      return;
    }

    // Siapkan status media
    for (const m of data.media) {
      m.selected = true;
      if (m.kind === 'video') {
        m.frameBlob = await captureFrame(m.el);
        m.previewUrl = m.frameBlob ? URL.createObjectURL(m.frameBlob) : m.poster || '';
        if (m.url.startsWith('blob:')) {
          m.prefetched = await pageFetch(m.url, 6000);
          m.status = m.prefetched ? 'ok' : 'stream';
        } else if (/^https?:/.test(m.url)) {
          m.status = 'url';
        } else {
          m.status = 'stream';
        }
      }
    }
    // Kalau ada video, gambar-gambar kecil biasanya hanya thumbnail → jangan dipilih default
    if (data.media.some((m) => m.kind === 'video')) {
      data.media.forEach((m) => { if (m.kind === 'image' && data.media.length > 3) m.selected = false; });
    }

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-label="Simpan iklan">
        <div class="head">
          <h2>Simpan ke AdStash</h2>
          <span class="pill">${esc(SOURCE() === 'feed' ? PLATFORM_LABEL[PLATFORM] : SOURCE_LABEL[SOURCE()])}</span>
          <button class="icon-btn x" title="Tutup (Esc)">${ICON.close}</button>
        </div>
        <label class="merge" hidden><input type="checkbox" name="merge" checked><span class="merge-txt"></span></label>
        <div class="body">
          <div class="media-col">
            <div class="media-grid"></div>
            <div class="hint mhint"></div>
          </div>
          <div class="form-col">
            <details class="intel">
              <summary><span>Sinyal winning</span><span class="intel-sum"></span></summary>
              <div class="row3">
                <div><label class="f">Mulai tayang</label><input type="date" name="startDate"></div>
                <div><label class="f">Status</label><select name="active"><option value="">Tidak diketahui</option><option value="1">Aktif</option><option value="0">Tidak aktif</option></select></div>
                <div><label class="f">Variasi iklan</label><input type="number" min="0" name="variations" placeholder="—"></div>
              </div>
              <div class="row4">
                <div><label class="f">Like</label><input type="number" min="0" name="likes" placeholder="—"></div>
                <div><label class="f">Komentar</label><input type="number" min="0" name="comments" placeholder="—"></div>
                <div><label class="f">Share</label><input type="number" min="0" name="shares" placeholder="—"></div>
                <div><label class="f">Views</label><input type="number" min="0" name="views" placeholder="—"></div>
              </div>
              <div class="cc-line"></div>
              <div class="intel-hint"></div>
            </details>
            <div class="row"><label class="f">Akun pengiklan</label><input type="text" name="advertiser" placeholder="Nama akun / brand"></div>
            <div class="row"><label class="f">Kategori</label>
              <div class="cat-wrap"><select name="category"></select><button class="small-btn addcat" type="button">+ Baru</button></div>
            </div>
            <div class="row"><label class="f">Caption / copywriting</label><textarea name="caption" rows="6" placeholder="Caption iklan"></textarea></div>
            <div class="row2 row">
              <div><label class="f">Tag</label><input type="text" name="tags" placeholder="hook kuat, testimoni, promo"></div>
              <div><label class="f">Tombol CTA</label><input type="text" name="cta" placeholder="mis. Kirim Pesan"></div>
            </div>
            <div class="row"><label class="f">Catatan pribadi</label><textarea name="notes" rows="2" placeholder="Kenapa iklan ini menarik?"></textarea></div>
            <div class="row2 row">
              <div><label class="f">Link postingan</label><input type="text" name="postUrl" placeholder="https://"></div>
              <div><label class="f">Landing page</label><input type="text" name="landingUrl" placeholder="https://"></div>
            </div>
            <div class="row"><label class="f">Penilaian</label>
              <div class="rate"><div class="stars"></div><button class="fav" type="button" title="Favorit">${ICON.heart}</button></div>
            </div>
          </div>
        </div>
        <div class="foot">
          <div class="meta"></div>
          <button class="btn ghost cancel" type="button">Batal</button>
          <button class="btn primary save" type="button">Simpan</button>
        </div>
      </div>`;
    root.appendChild(overlay);

    const q = (s) => overlay.querySelector(s);
    const f = (n) => overlay.querySelector(`[name="${n}"]`);
    f('advertiser').value = data.advertiser || '';
    f('caption').value = data.caption || '';
    f('cta').value = data.cta || '';
    f('postUrl').value = data.postUrl || '';
    f('landingUrl').value = data.landingUrl || '';

    // Sinyal winning
    const intel = data.intel || {};
    const st = data.stats || {};
    f('startDate').value = intel.startDate || '';
    f('active').value = intel.active === true ? '1' : intel.active === false ? '0' : '';
    if (intel.variations != null) f('variations').value = intel.variations;
    ['likes', 'comments', 'shares', 'views'].forEach((k) => { if (st[k] != null) f(k).value = st[k]; });
    const found = [intel.startDate, intel.active != null, intel.variations != null, ...['likes', 'comments', 'shares', 'views'].map((k) => st[k] != null)].filter(Boolean).length;
    q('.intel-sum').textContent = found ? `${found} data terdeteksi` : 'belum ada data terdeteksi';
    if (found) q('.intel').open = true;
    const cc = intel.cc || {};
    const ccTxt = [cc.ctr && `CTR ${cc.ctr}`, cc.budget && `Budget ${cc.budget}`, cc.objective && `Tujuan: ${cc.objective}`, cc.industry && `Industri: ${cc.industry}`].filter(Boolean).join(' · ');
    q('.cc-line').textContent = ccTxt;
    q('.intel-hint').textContent = SOURCE() === 'feed'
      ? 'Tanggal mulai, status, dan jumlah variasi tersedia di Meta Ad Library. Dari halaman Library AdStash, klik "Cek di Ad Library" untuk melengkapinya.'
      : 'Data diambil dari ' + SOURCE_LABEL[SOURCE()] + '. Koreksi jika ada yang keliru.';

    // Iklan yang sama sudah tersimpan? → tawarkan perbarui, bukan duplikat
    let mergeTarget = null;
    // Gambar utama untuk dibandingkan visualnya (aturan sama dengan thumbnail di background)
    const firstImg = data.media.find((m) => m.kind === 'image' && /^https?:/.test(m.url));
    const firstVid = data.media.find((m) => m.kind === 'video');
    let visual = null;
    if (firstImg) visual = { url: firstImg.url };
    else if (firstVid && firstVid.frameBlob) visual = { dataUrl: await blobToDataUrl(firstVid.frameBlob) };
    else if (firstVid && firstVid.poster) visual = { url: firstVid.poster };
    const curPreview = firstImg ? firstImg.url : firstVid ? firstVid.previewUrl : '';
    chrome.runtime.sendMessage({
      type: 'findSimilar',
      platform: PLATFORM,
      advertiser: data.advertiser,
      caption: data.caption,
      postUrl: data.postUrl,
      libraryId: intel.libraryId || '',
      visual
    }, (res) => {
      if (chrome.runtime.lastError || !res || !overlay.isConnected) return;
      mergeTarget = res;
      const lbl = q('.merge');
      lbl.hidden = false;
      lbl.classList.toggle('weak', !res.strong);
      f('merge').checked = !!res.strong;
      const when = new Date(res.savedAt).toLocaleDateString('id-ID');
      q('.merge-txt').innerHTML = `
        <span class="cmp">
          <span class="cmp-item">${res.thumb ? `<img alt="" src="${esc(res.thumb)}">` : '<i></i>'}<small>Tersimpan</small></span>
          <span class="cmp-item">${curPreview ? `<img alt="" src="${esc(curPreview)}">` : '<i></i>'}<small>Sekarang</small></span>
        </span>
        <span class="cmp-txt">${res.strong ? 'Iklan ini <b>sudah tersimpan</b>' : 'Mungkin sama dengan iklan tersimpan'}: <b>${esc(res.advertiser || 'tanpa nama')}</b> (${esc(when)}, ${esc(res.reason)}).
        <br>Centang untuk <b>memperbarui data iklan itu</b>; biarkan kosong untuk menyimpan sebagai iklan baru.${res.strong ? '' : ' <b>Bandingkan visualnya dulu.</b>'}</span>`;
    });

    // Kategori
    const sel = f('category');
    const fillCats = (chosen) => {
      sel.innerHTML = '<option value="">— Pilih kategori —</option>' +
        categories.map((c) => `<option ${c === chosen ? 'selected' : ''}>${esc(c)}</option>`).join('');
    };
    fillCats(lastCategory);
    q('.addcat').addEventListener('click', () => {
      const wrap = q('.cat-wrap');
      if (wrap.querySelector('input')) return;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'Nama kategori baru, Enter';
      sel.style.display = 'none';
      wrap.insertBefore(inp, sel);
      inp.focus();
      const finish = async (saveIt) => {
        const name = inp.value.trim();
        if (saveIt && name) {
          const res = await chrome.runtime.sendMessage({ type: 'addCategory', name });
          categories = res.categories;
          fillCats(name);
        }
        inp.remove();
        sel.style.display = '';
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      inp.addEventListener('blur', () => finish(true));
    });

    // Rating & favorit
    let rating = 0;
    let favorite = false;
    const stars = q('.stars');
    const drawStars = () => {
      stars.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = `${i} bintang`;
        b.className = i <= rating ? 'on' : '';
        b.innerHTML = ICON.star;
        b.addEventListener('click', () => { rating = rating === i ? 0 : i; drawStars(); });
        stars.appendChild(b);
      }
    };
    drawStars();
    q('.fav').addEventListener('click', (e) => { favorite = !favorite; e.currentTarget.classList.toggle('on', favorite); });

    // Media grid
    const grid = q('.media-grid');
    const drawMedia = () => {
      grid.innerHTML = '';
      grid.classList.toggle('single', data.media.length === 1);
      if (!data.media.length) {
        grid.innerHTML = '<div class="empty-media">Tidak ada gambar/video yang terdeteksi.<br>Caption dan info lain tetap bisa disimpan.</div>';
      }
      data.media.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'm-item' + (m.selected ? ' sel' : '');
        const src = m.kind === 'image' ? m.url : m.previewUrl;
        card.innerHTML = (src ? `<img alt="" src="${esc(src)}">` : `<div class="ph">${ICON.video}</div>`) +
          `<span class="kind">${m.kind === 'video' ? 'VIDEO' : 'FOTO'}</span><span class="tick">${ICON.check}</span>`;
        if (m.kind === 'video') {
          const st = document.createElement('div');
          st.className = 'vstat' + (m.status === 'ok' || m.status === 'recorded' || m.status === 'url' ? ' ok' : '');
          if (m.status === 'recorded') st.textContent = `Rekaman siap (${(m.prefetched.size / 1048576).toFixed(1)} MB)`;
          else if (m.status === 'ok') st.textContent = 'Video siap disimpan';
          else if (m.status === 'url') st.textContent = 'Video akan diunduh';
          else {
            st.innerHTML = '<span>Video streaming: rekam supaya tersimpan</span>';
            const rb = document.createElement('button');
            rb.type = 'button';
            rb.innerHTML = `${ICON.rec} Rekam`;
            rb.addEventListener('click', (e) => { e.stopPropagation(); startRecording(m); });
            st.appendChild(rb);
          }
          card.appendChild(st);
        }
        card.addEventListener('click', () => { m.selected = !m.selected; drawMedia(); });
        grid.appendChild(card);
      });
      const n = data.media.filter((m) => m.selected).length;
      q('.meta').textContent = `${n} dari ${data.media.length} media dipilih`;
      const needRec = data.media.some((m) => m.selected && m.kind === 'video' && m.status === 'stream');
      q('.mhint').textContent = needRec
        ? 'Video streaming (umum di FB/IG) tidak bisa diunduh langsung. Klik "Rekam" — video diputar ulang dari awal dan direkam sampai selesai. Tanpa rekaman, yang tersimpan hanya thumbnail-nya.'
        : 'Klik media untuk memilih/batal memilih.';
    };
    drawMedia();

    async function startRecording(m) {
      overlay.style.display = 'none';
      const bar = document.createElement('div');
      bar.className = 'recbar';
      bar.innerHTML = '<span class="dot"></span><span class="lbl">Merekam… biarkan video berputar</span><button type="button">Stop</button>';
      root.appendChild(bar);
      const lbl = bar.querySelector('.lbl');
      bar.querySelector('button').addEventListener('click', () => recordVideo.stop && recordVideo.stop());
      const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      try {
        m.el.scrollIntoView({ block: 'center' });
        const blob = await recordVideo(m.el, {
          onTick: (sec, dur) => { lbl.textContent = `Merekam ${fmt(sec)}${dur ? ' / ' + fmt(dur) : ''}`; }
        });
        m.prefetched = blob;
        m.status = 'recorded';
        m.selected = true;
      } catch (err) {
        toast(err.message || 'Gagal merekam video.');
      } finally {
        bar.remove();
        overlay.style.display = '';
        drawMedia();
      }
    }

    const close = () => {
      overlay.remove();
      modalOpen = false;
      data.media.forEach((m) => { if (m.previewUrl && m.previewUrl.startsWith('blob:') && m.frameBlob) URL.revokeObjectURL(m.previewUrl); });
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); doSave(); }
    };
    document.addEventListener('keydown', onKey, true);
    q('.x').addEventListener('click', close);
    q('.cancel').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    const saveBtn = q('.save');
    let saving = false;
    async function doSave() {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyiapkan…';
      try {
        const meta = {
          platform: PLATFORM,
          advertiser: f('advertiser').value.trim(),
          advertiserUrl: data.advertiserUrl,
          caption: f('caption').value.trim(),
          category: sel.value,
          tags: f('tags').value.split(',').map((t) => t.trim()).filter(Boolean),
          notes: f('notes').value.trim(),
          cta: f('cta').value.trim(),
          postUrl: f('postUrl').value.trim(),
          landingUrl: f('landingUrl').value.trim(),
          pageUrl: data.pageUrl,
          rating,
          favorite
        };
        const num = (n) => { const v = f(n).value.trim(); return v === '' ? null : Math.max(0, parseInt(v, 10)); };
        meta.intel = {
          ...(data.intel || {}),
          startDate: f('startDate').value || '',
          active: f('active').value === '1' ? true : f('active').value === '0' ? false : null,
          variations: num('variations'),
          checkedAt: Date.now()
        };
        const snap = { likes: num('likes'), comments: num('comments'), shares: num('shares'), views: num('views') };
        if (data.stats && data.stats.saves != null) snap.saves = data.stats.saves;
        Object.keys(snap).forEach((k) => { if (snap[k] == null) delete snap[k]; });
        meta.stats = Object.keys(snap).length ? { at: Date.now(), source: SOURCE(), ...snap } : null;
        if (mergeTarget && f('merge') && f('merge').checked) meta.mergeInto = mergeTarget.id;
        const items = [];
        for (const m of data.media.filter((x) => x.selected)) {
          const it = { kind: m.kind, url: /^https?:/.test(m.url) ? m.url : '' };
          if (m.kind === 'image') {
            it.main = /^https?:/.test(m.url) ? { url: m.url } : { blob: await pageFetch(m.url, 15000) };
          } else {
            if (m.prefetched) it.main = { blob: m.prefetched };
            else if (/^https?:/.test(m.url)) {
              saveBtn.textContent = 'Mengunduh video…';
              const b = await pageFetch(m.url);
              it.main = b ? { blob: b } : { url: m.url };
            }
            it.poster = m.frameBlob ? { blob: m.frameBlob } : (m.poster ? { url: m.poster } : null);
          }
          items.push(it);
        }
        const res = await sendToBackground(meta, items, (t) => { saveBtn.textContent = t; });
        savedContainers.add(container);
        close();
        const msg = res.merged
          ? 'Data winning iklan yang sudah tersimpan diperbarui.'
          : res.missing
            ? `Tersimpan. ${res.missing} media tidak bisa diunduh (info & thumbnail tetap tersimpan).`
            : 'Iklan tersimpan ke AdStash.';
        toast(msg, { label: 'Buka', onClick: () => chrome.runtime.sendMessage({ type: 'openLibrary', adId: res.id }) });
      } catch (err) {
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
        toast('Gagal menyimpan: ' + (err.message || err));
      }
    }
    saveBtn.addEventListener('click', doSave);
    setTimeout(() => f('advertiser').value ? sel.focus() : f('advertiser').focus(), 50);
  }
})();
