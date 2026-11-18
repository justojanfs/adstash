import { saveAdWithBlobs, uid, countAds, getAd, putAd, getAllAds, getBlob } from './shared/db.js';
import { visualSignature, compareVisual } from './shared/visual.js';
import { getSettings, saveSettings } from './shared/settings.js';
import { ensureMigrated, restoreSnapshot } from './shared/migrate.js';
import { checkForUpdate, scheduleChecks, noteVersionChange, applyBadge } from './shared/update.js';
import { SCHEMA_VERSION } from './shared/config.js';

/* ---------- Siklus hidup: migrasi, versi, cek update ---------- */
// Dipanggil tiap service worker bangun (juga setelah "Muat ulang" hasil update manual).
const bootReady = (async () => {
  try {
    await ensureMigrated();
    await noteVersionChange();
    scheduleChecks();
    checkForUpdate().catch(() => {});
  } catch (e) { console.warn('[AdStash] boot:', e); }
})();
// Pintu debug untuk pengujian/DevTools service worker (tidak terjangkau dari halaman web).
self.__adstash = { checkForUpdate, restoreSnapshot, ensureMigrated, getSettings, saveSettings, getAd, putAd, getAllAds };
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'adstash-update') checkForUpdate().catch(() => {}); });

const SITES = [
  'https://*.facebook.com/*',
  'https://*.instagram.com/*',
  'https://*.tiktok.com/*',
  'https://ads.tiktok.com/*'
];

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'adstash-save',
      title: 'Simpan postingan ini ke AdStash',
      contexts: ['all'],
      documentUrlPatterns: SITES
    });
    chrome.contextMenus.create({
      id: 'adstash-open',
      title: 'Buka AdStash Library',
      contexts: ['action']
    });
  });
  if (details.reason === 'install') {
    await saveSettings({}); // tulis default
    await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION, lastSeenVersion: chrome.runtime.getManifest().version });
    chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html?welcome=1') });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'adstash-open') return openLibrary();
  if (info.menuItemId === 'adstash-save' && tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'saveFromContextMenu' }, { frameId: info.frameId || 0 })
      .catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-hovered') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'saveHovered' }).catch(() => {});
});

function openLibrary(query = '') {
  const url = chrome.runtime.getURL('src/library/library.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, query ? { active: true, url: url + query } : { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: url + query });
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'openLibrary') {
    openLibrary(msg.adId ? `?open=${encodeURIComponent(msg.adId)}` : '');
    sendResponse({ ok: true });
  } else if (msg?.type === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  } else if (msg?.type === 'addCategory') {
    getSettings().then(async (s) => {
      const name = String(msg.name || '').trim();
      if (name && !s.categories.includes(name)) s.categories.push(name);
      await saveSettings({ categories: s.categories });
      sendResponse({ categories: s.categories });
    });
    return true;
  } else if (msg?.type === 'findSimilar') {
    bootReady.then(() => findSimilar(msg)).then(sendResponse).catch(() => sendResponse(null));
    return true;
  } else if (msg?.type === 'refresh') {
    startRefresh(msg.adId, msg.kind).then(sendResponse);
    return true;
  } else if (msg?.type === 'openAdLibrarySearch') {
    chrome.storage.session.set({ pendingLink: { adId: msg.adId, at: Date.now() } }).then(() => {
      const q = encodeURIComponent(msg.query || '');
      chrome.tabs.create({ url: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ID&q=${q}&search_type=keyword_unordered&media_type=all` });
      sendResponse({ ok: true });
    });
    return true;
  } else if (msg?.type === 'getTask') {
    const t = _sender.tab && tasks.get(_sender.tab.id);
    sendResponse(t ? { kind: t.kind, libraryId: t.libraryId } : null);
  } else if (msg?.type === 'taskResult') {
    const t = _sender.tab && tasks.get(_sender.tab.id);
    if (t) applyTaskResult(t, msg).then((r) => t.finish(r));
    sendResponse({ ok: true });
  } else if (msg?.type === 'count') {
    countAds().then((n) => sendResponse({ count: n }));
    return true;
  } else if (msg?.type === 'ensureMigrated') {
    bootReady.then(() => ensureMigrated()).then(sendResponse);
    return true;
  } else if (msg?.type === 'checkUpdate') {
    checkForUpdate({ force: true }).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return true;
  } else if (msg?.type === 'dismissUpdate') {
    chrome.storage.local.set({ updateState: { dismissedVersion: msg.version || '' } }).then(applyBadge).then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg?.type === 'restoreSnapshot') {
    restoreSnapshot().then(sendResponse);
    return true;
  } else if (msg?.type === 'reloadExtension') {
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 150);
    return false;
  }
  return false;
});

/* ---------- Penerimaan data simpan dari content script ---------- */

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchMedia(url) {
  if (!/^https?:/i.test(url || '')) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || /text\/html/i.test(blob.type)) return null;
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const max = 480;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch {
    return null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'adstash-save') return;

  let meta = null;
  let items = [];
  // parts[i] = { main: {chunks, mime} | {url}, poster: {chunks, mime} | {url} }
  const parts = {};
  const slot = (i, role) => {
    parts[i] = parts[i] || {};
    parts[i][role] = parts[i][role] || { chunks: [], mime: '' };
    return parts[i][role];
  };

  // Jaga service worker tetap hidup selama transfer besar
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  port.onDisconnect.addListener(() => clearInterval(keepAlive));

  port.onMessage.addListener(async (m) => {
    try {
      if (m.t === 'begin') {
        meta = m.ad;
        items = m.items || [];
      } else if (m.t === 'url') {
        slot(m.i, m.role).url = m.url;
      } else if (m.t === 'chunk') {
        const s = slot(m.i, m.role);
        s.mime = m.mime || s.mime;
        s.chunks.push(b64ToBytes(m.data));
      } else if (m.t === 'commit') {
        await bootReady;
        const result = await commit(meta, items, parts, (text) => port.postMessage({ t: 'progress', text }));
        port.postMessage({ t: 'done', ...result });
      }
    } catch (err) {
      port.postMessage({ t: 'error', message: String(err && err.message || err) });
    }
  });
});

async function resolvePart(p) {
  if (!p) return null;
  if (p.chunks && p.chunks.length) return new Blob(p.chunks, { type: p.mime || '' });
  if (p.url) return fetchMedia(p.url);
  return null;
}

async function buildMedia(items, parts, progress, onlyKinds = null) {
  const blobs = [];
  const media = [];
  let missing = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (onlyKinds && !onlyKinds.includes(it.kind)) continue;
    progress(`Mengambil media ${i + 1}/${items.length}…`);
    const main = await resolvePart(parts[i]?.main);
    const poster = it.kind === 'video' ? await resolvePart(parts[i]?.poster) : null;
    const rec = {
      id: uid('m_'),
      type: it.kind,
      mime: main ? main.type : '',
      size: main ? main.size : 0,
      sourceUrl: /^https?:/i.test(it.sourceUrl || '') ? it.sourceUrl : '',
      missing: !main
    };
    if (main) blobs.push({ id: rec.id, blob: main });
    else missing++;
    if (poster) {
      rec.posterId = uid('p_');
      blobs.push({ id: rec.posterId, blob: poster });
    }
    if (!main && !poster) continue;
    media.push(rec);
  }
  return { media, blobs, missing };
}

function visualSource(media, blobs) {
  const firstImg = media.find((m) => m.type === 'image' && !m.missing);
  const firstPoster = media.find((m) => m.posterId);
  return firstImg
    ? blobs.find((b) => b.id === firstImg.id).blob
    : firstPoster ? blobs.find((b) => b.id === firstPoster.posterId).blob : null;
}

async function buildThumb(media, blobs) {
  const firstImg = media.find((m) => m.type === 'image' && !m.missing);
  const firstPoster = media.find((m) => m.posterId);
  const source = visualSource(media, blobs);
  if (!source) return null;
  const thumb = await makeThumb(source);
  if (thumb) {
    const id = uid('t_');
    blobs.push({ id, blob: thumb });
    return id;
  }
  return firstImg ? firstImg.id : firstPoster.posterId;
}

const MAX_SNAPSHOTS = 60;

function mergeIntel(oldI = {}, newI = {}) {
  const out = { ...oldI };
  for (const k of ['libraryId', 'startDate', 'endDate']) if (newI[k]) out[k] = newI[k];
  for (const k of ['active', 'variations']) if (newI[k] !== null && newI[k] !== undefined && newI[k] !== '') out[k] = newI[k];
  if (newI.cc) {
    const cc = { ...(oldI.cc || {}) };
    for (const [k, v] of Object.entries(newI.cc)) if (v) cc[k] = v;
    out.cc = cc;
  }
  const sources = new Set([...(oldI.sources || (oldI.source ? [oldI.source] : [])), ...(newI.source ? [newI.source] : [])]);
  out.sources = [...sources];
  out.source = oldI.source || newI.source || 'feed';
  out.checkedAt = Date.now();
  return out;
}

function appendStats(ad, snap) {
  if (!snap) return;
  ad.stats = [...(ad.stats || []), snap].slice(-MAX_SNAPSHOTS);
}

async function commit(meta, items, parts, progress) {
  if (!meta) throw new Error('Data iklan kosong');

  if (meta.mergeInto) {
    const ex = await getAd(meta.mergeInto);
    if (ex) return mergeCommit(ex, meta, items, parts, progress);
  }

  const { media, blobs, missing } = await buildMedia(items, parts, progress);
  progress('Membuat thumbnail…');
  const thumbId = await buildThumb(media, blobs);
  const vsrc = visualSource(media, blobs);
  const visual = vsrc ? await visualSignature(vsrc) : null;

  const now = Date.now();
  const ad = {
    id: uid('ad_'),
    platform: meta.platform || 'other',
    advertiser: (meta.advertiser || '').trim(),
    advertiserUrl: meta.advertiserUrl || '',
    caption: meta.caption || '',
    category: meta.category || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    notes: meta.notes || '',
    postUrl: meta.postUrl || '',
    landingUrl: meta.landingUrl || '',
    pageUrl: meta.pageUrl || '',
    cta: meta.cta || '',
    rating: Number(meta.rating) || 0,
    favorite: !!meta.favorite,
    savedAt: now,
    updatedAt: now,
    media,
    thumbId,
    visual,
    intel: mergeIntel({}, meta.intel || { source: 'feed' }),
    stats: meta.stats ? [meta.stats] : []
  };

  progress('Menyimpan…');
  await saveAdWithBlobs(ad, blobs);
  if (meta.category) saveSettings({ lastCategory: meta.category });
  return { id: ad.id, missing, mediaCount: media.length };
}

/** Iklan yang sama disimpan lagi (mis. dari Ad Library): perbarui, jangan duplikat. */
async function mergeCommit(ex, meta, items, parts, progress) {
  // Pengaman: ID Ad Library berbeda = pasti iklan berbeda → simpan sebagai iklan baru
  const exLib = ex.intel && ex.intel.libraryId;
  const newLib = meta.intel && meta.intel.libraryId;
  if (exLib && newLib && exLib !== newLib) {
    const { mergeInto, ...rest } = meta;
    return commit(rest, items, parts, progress);
  }
  // Riwayat: simpan keadaan sebelum digabung supaya bisa dipulihkan
  const hist = {
    at: Date.now(),
    intel: JSON.parse(JSON.stringify(ex.intel || {})),
    statsLen: (ex.stats || []).length,
    fields: {},
    addedMedia: [],
    prevThumbId: ex.thumbId || null,
    from: { advertiser: meta.advertiser || '', libraryId: newLib || '', postUrl: meta.postUrl || '' }
  };
  for (const k of ['advertiser', 'advertiserUrl', 'caption', 'landingUrl', 'cta', 'category', 'notes', 'rating', 'favorite', 'tags', 'libraryUrl']) {
    hist.fields[k] = ex[k] === undefined ? null : JSON.parse(JSON.stringify(ex[k]));
  }
  ex.intel = mergeIntel(ex.intel || { source: 'feed' }, meta.intel || {});
  appendStats(ex, meta.stats);
  for (const k of ['advertiser', 'advertiserUrl', 'caption', 'landingUrl', 'cta', 'category']) {
    if (!ex[k] && meta[k]) ex[k] = meta[k];
  }
  ex.tags = [...new Set([...(ex.tags || []), ...(meta.tags || [])])];
  if (meta.notes && !(ex.notes || '').includes(meta.notes)) ex.notes = [ex.notes, meta.notes].filter(Boolean).join('\n');
  ex.rating = Math.max(ex.rating || 0, Number(meta.rating) || 0);
  ex.favorite = !!(ex.favorite || meta.favorite);
  if (meta.platform === 'facebook' && meta.postUrl && /ads\/library/.test(meta.postUrl)) ex.libraryUrl = meta.postUrl;

  // Tambahkan media hanya untuk jenis yang belum punya file tersimpan
  const savedKinds = new Set((ex.media || []).filter((m) => !m.missing).map((m) => m.type));
  const needKinds = ['image', 'video'].filter((k) => !savedKinds.has(k));
  let blobs = [];
  if (needKinds.length) {
    const built = await buildMedia(items, parts, progress, needKinds);
    if (built.media.some((m) => !m.missing)) {
      // buang placeholder "missing" lama untuk jenis yang sekarang berhasil disimpan
      const gotKinds = new Set(built.media.filter((m) => !m.missing).map((m) => m.type));
      hist.removedMedia = (ex.media || []).filter((m) => m.missing && gotKinds.has(m.type));
      const added = built.media.filter((m) => !m.missing);
      ex.media = (ex.media || []).filter((m) => !(m.missing && gotKinds.has(m.type))).concat(added);
      hist.addedMedia = added.map((m) => m.id);
      blobs = built.blobs;
      hist.addedBlobs = blobs.map((b) => b.id);
      if (!ex.thumbId) ex.thumbId = await buildThumb(built.media, blobs);
    }
  }
  ex.intelHistory = [...(ex.intelHistory || []), hist].slice(-10);
  ex.updatedAt = Date.now();
  progress('Menyimpan…');
  await saveAdWithBlobs(ex, blobs);
  await chrome.storage.session.remove('pendingLink');
  return { id: ex.id, merged: true, missing: 0 };
}

/* ---------- Pencocokan iklan yang sudah ada ---------- */
const normText = (s) => (s || '').toLowerCase().replace(/https?:\S+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wordSet = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 2));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
const sameAdvertiser = (a, b) => {
  const x = normText(a).replace(/\s/g, '');
  const y = normText(b).replace(/\s/g, '');
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

/** Sidik jari visual iklan tersimpan; dihitung dari thumbnail lalu di-cache. */
async function adSignature(ad) {
  if (ad.visual) return ad.visual;
  const b = await getBlob(ad.thumbId);
  if (!b) return null;
  const sig = await visualSignature(b);
  if (sig) {
    ad.visual = sig;
    const fresh = await getAd(ad.id);
    if (fresh) { fresh.visual = sig; await putAd(fresh); }
  }
  return sig;
}

async function candidateSignature(visual) {
  if (!visual) return null;
  let blob = null;
  if (visual.dataUrl) {
    try { blob = await (await fetch(visual.dataUrl)).blob(); } catch {}
  } else if (visual.url) {
    blob = await fetchMedia(visual.url);
  }
  return blob ? visualSignature(blob) : null;
}

const isLibUrl = (u) => /ads\/library/.test(u || '');

/**
 * Cari iklan tersimpan yang kemungkinan SAMA dengan yang akan disimpan.
 * Aturan (v1.2):
 *  - ID Ad Library berbeda → pasti berbeda (dilewati).
 *  - ID sama / link postingan sama → sama (bukti kuat).
 *  - Visual bisa dibandingkan & berbeda → berbeda, semirip apa pun caption-nya.
 *  - Visual & caption cocok → bukti kuat (kotak gabung tercentang).
 *  - Selain itu hanya saran lemah (kotak TIDAK tercentang).
 */
async function findSimilar(msg) {
  const ads = await getAllAds();
  const pack = async (ad, reason, strong, vis) => ({
    id: ad.id,
    advertiser: ad.advertiser,
    savedAt: ad.savedAt,
    libraryId: ad.intel?.libraryId || '',
    reason,
    strong,
    visual: vis ? (vis.same ? 'same' : 'diff') : 'unknown',
    thumb: ad.thumbId ? await getBlob(ad.thumbId).then((b) => (b ? blobToDataUrl(b) : '')) : ''
  });

  for (const a of ads) {
    const aLib = a.intel?.libraryId;
    if (msg.libraryId && aLib === msg.libraryId) return pack(a, 'ID Ad Library sama', true, null);
    if (msg.postUrl && a.postUrl && a.postUrl === msg.postUrl && (!msg.libraryId || !aLib)) return pack(a, 'link postingan sama', true, null);
  }

  const cand = await candidateSignature(msg.visual);
  const wc = wordSet(msg.caption);
  const { pendingLink } = await chrome.storage.session.get('pendingLink');
  const linkedId = pendingLink && Date.now() - pendingLink.at < 30 * 60000 ? pendingLink.adId : null;
  let best = null;

  for (const a of ads) {
    const aLib = a.intel?.libraryId;
    if (msg.libraryId && aLib && aLib !== msg.libraryId) continue;
    const sim = jaccard(wc, wordSet(a.caption));
    const sameAdv = sameAdvertiser(a.advertiser, msg.advertiser);
    const linked = a.id === linkedId;
    if (!(sim >= 0.5 || linked || sameAdv)) continue;

    const vis = cand ? compareVisual(cand, await adSignature(a)) : null;
    if (vis && !vis.same) continue; // visual beda → iklan beda
    const bothPostsDiffer = msg.postUrl && a.postUrl && msg.postUrl !== a.postUrl && !isLibUrl(msg.postUrl) && !isLibUrl(a.postUrl);

    let strong = false;
    let reason = '';
    if (vis && vis.same && sim >= 0.5) { strong = true; reason = 'visual & caption cocok'; }
    else if (vis && vis.same) reason = 'visualnya mirip, caption berbeda';
    else if (!vis && !bothPostsDiffer && sim >= 0.8 && (sameAdv || linked)) reason = 'caption sama, tapi visual tidak bisa dibandingkan';
    else if (!vis && linked && sim >= 0.3) reason = 'dibuka dari AdStash, visual tidak bisa dibandingkan';
    else continue;

    const rank = (strong ? 10 : 0) + sim + (vis ? 1 - vis.dist / 256 : 0) + (linked ? 0.5 : 0);
    if (!best || rank > best.rank) best = { a, strong, reason, vis, rank };
  }
  return best ? pack(best.a, best.reason, best.strong, best.vis) : null;
}

/* ---------- Tugas refresh: buka postingan / Ad Library di tab latar ---------- */
const tasks = new Map(); // tabId → { adId, kind, libraryId, respond, timer }

async function startRefresh(adId, kind) {
  const ad = await getAd(adId);
  if (!ad) return { ok: false, reason: 'Iklan tidak ditemukan.' };
  let url = '';
  if (kind === 'library') {
    if (!ad.intel || !ad.intel.libraryId) return { ok: false, reason: 'ID Ad Library belum diketahui.' };
    url = `https://www.facebook.com/ads/library/?id=${ad.intel.libraryId}`;
  } else {
    url = /^https?:\/\//.test(ad.postUrl || '') ? ad.postUrl : '';
    if (!url) return { ok: false, reason: 'Link postingan kosong, jadi stats tidak bisa diperbarui otomatis.' };
  }
  const tab = await chrome.tabs.create({ url, active: false });
  return new Promise((resolve) => {
    const finish = (result) => {
      const t = tasks.get(tab.id);
      if (!t) return;
      clearTimeout(t.timer);
      tasks.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve(result);
    };
    tasks.set(tab.id, {
      adId,
      kind,
      libraryId: ad.intel?.libraryId || '',
      finish,
      timer: setTimeout(() => finish({ ok: false, reason: 'Halaman tidak merespons dalam 45 detik. Pastikan kamu sudah login, lalu coba lagi.' }), 45000)
    });
  });
}

async function applyTaskResult(task, msg) {
  if (!msg.ok) return { ok: false, reason: 'Angka tidak ditemukan di halaman. Buka postingannya dan simpan ulang untuk memperbarui.' };
  const ad = await getAd(task.adId);
  if (!ad) return { ok: false, reason: 'Iklan sudah dihapus.' };
  if (msg.stats) appendStats(ad, { ...msg.stats, source: 'refresh' });
  if (msg.intel) ad.intel = mergeIntel(ad.intel || {}, msg.intel);
  ad.updatedAt = Date.now();
  await putAd(ad);
  return { ok: true, stats: msg.stats || null, intel: msg.intel || null };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const t = tasks.get(tabId);
  if (t) t.finish({ ok: false, reason: 'Tab ditutup sebelum selesai.' });
});
