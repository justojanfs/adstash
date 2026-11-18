import { getAllAds, getAd, putAd, deleteAd, getBlob, putBlob, deleteBlobs, blobIdsOf, saveAdWithBlobs, storageEstimate } from '../shared/db.js';
import { getSettings, saveSettings, PLATFORM_LABEL } from '../shared/settings.js';
import { makeZip, readZip } from '../shared/zip.js';
import { initUpdates, drawSettings as drawUpdSettings } from './updates.js';
import { computeScore, LABEL, CONF_LABEL, DEFAULT_RULES, latestStats, engagementTotal } from '../shared/score.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtBytes = (b) => b > 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

const ICON_HEART = '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 20.3s-7.8-4.6-7.8-10.3A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.8 2.6c0 5.7-7.8 10.3-7.8 10.3z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';

const state = {
  ads: [],
  settings: null,
  filtered: [],
  shown: 0,
  f: { q: '', platform: '', category: '', type: '', fav: false, sort: 'new', win: '' },
  view: 'grid',
  scores: new Map()
};
const scoreOf = (a) => {
  let sc = state.scores.get(a.id);
  if (!sc || sc.v !== a.updatedAt) {
    sc = { ...computeScore(a, state.settings?.winRules), v: a.updatedAt };
    state.scores.set(a.id, sc);
  }
  return sc;
};
const fmtN = (n) => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' jt' : n >= 1e4 ? Math.round(n / 1e3) + ' rb' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' rb' : String(n);
const PAGE = 60;

/* ---------- Object URL cache ---------- */
const urlCache = new Map();
async function blobUrl(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await getBlob(id);
  const u = b ? URL.createObjectURL(b) : '';
  urlCache.set(id, u);
  return u;
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- Load ---------- */
async function load() {
  [state.ads, state.settings] = await Promise.all([getAllAds(), getSettings()]);
  fillCategoryFilter();
  setView(state.settings.view || 'grid', false);
}

function allCategories() {
  const set = new Set(state.settings.categories);
  state.ads.forEach((a) => a.category && set.add(a.category));
  return [...set];
}

function fillCategoryFilter() {
  const sel = $('#fCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua kategori</option>' +
    allCategories().map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

/* ---------- Filter & render ---------- */
function matches(a) {
  const f = state.f;
  if (f.platform && a.platform !== f.platform) return false;
  if (f.category && a.category !== f.category) return false;
  if (f.fav && !a.favorite) return false;
  if (f.type && !(a.media || []).some((m) => m.type === f.type)) return false;
  if (f.win && scoreOf(a).label !== f.win) return false;
  if (f.q) {
    const hay = [a.advertiser, a.caption, a.notes, a.category, a.cta, a.landingUrl, ...(a.tags || [])].join(' ').toLowerCase();
    if (!f.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function applyFilters() {
  const list = state.ads.filter(matches);
  const s = state.f.sort;
  list.sort((a, b) =>
    s === 'old' ? a.savedAt - b.savedAt
    : s === 'rating' ? (b.rating - a.rating) || (b.savedAt - a.savedAt)
    : s === 'score' ? (scoreOf(b).score - scoreOf(a).score) || (scoreOf(b).max - scoreOf(a).max) || (b.savedAt - a.savedAt)
    : s === 'age' ? ((scoreOf(b).days ?? -1) - (scoreOf(a).days ?? -1)) || (b.savedAt - a.savedAt)
    : s === 'eng' ? ((scoreOf(b).eng ?? -1) - (scoreOf(a).eng ?? -1)) || (b.savedAt - a.savedAt)
    : s === 'az' ? (a.advertiser || '~').localeCompare(b.advertiser || '~', 'id')
    : b.savedAt - a.savedAt);
  state.filtered = list;
  state.shown = 0;
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.className = 'grid v-' + state.view;
  if (state.view === 'list' && list.length) grid.appendChild(listHeader());
  $('#count').textContent = `${list.length} iklan`;
  renderEmpty();
  renderMore();
}

function renderEmpty() {
  const empty = $('#empty');
  if (state.filtered.length) { empty.hidden = true; return; }
  empty.hidden = false;
  if (!state.ads.length) {
    empty.innerHTML = `<div class="big">🗂️</div><h2>Ad library-mu masih kosong</h2>
      <p>Simpan iklan pertama dalam 3 langkah:</p>
      <ol>
        <li>Buka <b>Facebook</b>, <b>Instagram</b>, atau <b>TikTok</b> seperti biasa.</li>
        <li>Arahkan kursor ke postingan iklan → klik tombol oranye <b>Simpan</b>.</li>
        <li>Cek caption, pilih kategori, lalu klik <b>Simpan</b>. Iklannya akan muncul di sini.</li>
      </ol>
      <p style="margin-top:14px;font-size:13px">Tombolnya tidak muncul? Muat ulang tab media sosial setelah memasang ekstensi.<br>Klik kanan → "Simpan postingan ini ke AdStash" juga bisa.</p>`;
  } else {
    empty.innerHTML = '<div class="big">🔍</div><h2>Tidak ada yang cocok</h2><p>Coba ubah kata kunci atau filter.</p>';
  }
}

/** Video yang disimpan tanpa poster (mis. TikTok lintas-domain): buat thumbnail
 *  dari file videonya sendiri, sekali saja, lalu simpan. */
async function backfillThumb(ad) {
  const vm = (ad.media || []).find((m) => m.type === 'video' && !m.missing);
  if (!vm) return '';
  const blob = await getBlob(vm.id);
  if (!blob) return '';
  const src = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = src;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 8000); });
    const t = isFinite(v.duration) ? Math.min(1, v.duration / 3) : 0.2;
    await new Promise((res) => { v.onseeked = res; v.currentTime = t; setTimeout(res, 3000); });
    const s = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(v.videoWidth * s);
    cv.height = Math.round(v.videoHeight * s);
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    const thumb = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
    if (!thumb) return '';
    ad.thumbId = 't_' + ad.id;
    await putBlob(ad.thumbId, thumb);
    await putAd(ad);
    return blobUrl(ad.thumbId);
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(src);
  }
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    const id = e.target.dataset.thumb;
    const ad = state.ads.find((a) => a.id === e.target.closest('[data-id]')?.dataset.id);
    (id ? blobUrl(id) : ad ? backfillThumb(ad) : Promise.resolve('')).then((u) => {
      if (u) e.target.innerHTML = `<img alt="" src="${u}">`;
      else if (id) e.target.innerHTML = '<div class="noimg">Tanpa pratinjau</div>';
    });
  }
}, { rootMargin: '400px' });

/** Rekaman MediaRecorder (webm) tidak menyimpan durasi → seekbar rusak. Trik standar: */
function fixWebmDuration(v) {
  v.addEventListener('loadedmetadata', () => {
    if (v.duration !== Infinity) return;
    v.currentTime = 1e101;
    v.addEventListener('timeupdate', function reset() {
      v.removeEventListener('timeupdate', reset);
      v.currentTime = 0;
    });
  }, { once: true });
}

const moreObserver = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) renderMore();
}, { rootMargin: '800px' });

function cardHTML(a) {
  const media = a.media || [];
  const vids = media.filter((m) => m.type === 'video').length;
  const stars = a.rating ? '★'.repeat(a.rating) : '';
  const cap = a.caption ? esc(a.caption) : '<span style="color:#A9A69E">Tanpa caption</span>';
  return `
    <div class="thumb">
      <div class="th" data-thumb="${esc(a.thumbId || '')}" style="position:absolute;inset:0">${a.thumbId ? '' : `<div class="noimg">${vids ? 'Video' : 'Tanpa media'}</div>`}</div>
      <span class="pbadge ${esc(a.platform)}">${esc(PLATFORM_LABEL[a.platform] || 'Web')}</span>
      ${media.length > 1 || vids ? `<span class="mcount">${vids ? ICON_PLAY : ''}${media.length > 1 ? media.length : ''}</span>` : ''}
      ${a.favorite ? `<span class="favmark">${ICON_HEART}</span>` : ''}
      ${winBadge(a)}
    </div>
    <div class="card-body">
      <div class="adv">${esc(a.advertiser || 'Pengiklan tidak diketahui')}</div>
      <div class="cap">${cap}</div>
      <div class="card-foot">
        ${a.category ? `<span class="cat">${esc(a.category)}</span>` : ''}
        ${stars ? `<span class="minis">${stars}</span>` : ''}
        <span class="date">${fmtDate(a.savedAt)}</span>
      </div>
    </div>`;
}

function winBadge(a) {
  const sc = scoreOf(a);
  if (sc.label === 'unknown') return '';
  const tip = `${LABEL[sc.label].text} · keyakinan ${CONF_LABEL[sc.conf]}`;
  return `<span class="wbadge ${sc.label}${sc.conf === 'low' ? ' lowconf' : ''}" title="${esc(tip)}"><b>${sc.score}</b> ${LABEL[sc.label].short}${sc.conf === 'low' ? '?' : ''}${sc.days != null ? ` · ${sc.days} hr` : ''}</span>`;
}

function renderMore() {
  const grid = $('#grid');
  const old = grid.querySelector('.sentinel');
  if (old) { moreObserver.unobserve(old); old.remove(); }
  const slice = state.filtered.slice(state.shown, state.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (const a of slice) {
    const el = document.createElement('article');
    el.className = state.view === 'list' ? 'row-item' : 'card';
    el.tabIndex = 0;
    el.dataset.id = a.id;
    el.innerHTML = state.view === 'list' ? rowHTML(a) : cardHTML(a);
    const th = el.querySelector('.th');
    if (a.thumbId || (a.media || []).some((m) => m.type === 'video' && !m.missing)) thumbObserver.observe(th);
    frag.appendChild(el);
  }
  grid.appendChild(frag);
  state.shown += slice.length;
  if (state.shown < state.filtered.length) {
    const s = document.createElement('div');
    s.className = 'sentinel';
    s.style.cssText = 'grid-column:1/-1;height:1px';
    grid.appendChild(s);
    moreObserver.observe(s);
  }
}

$('#grid').addEventListener('click', (e) => {
  const sortBtn = e.target.closest('[data-sortkey]');
  if (sortBtn) return setSort(sortBtn.dataset.sortkey);
  const card = e.target.closest('[data-id]');
  if (card) openDetail(card.dataset.id);
});
$('#grid').addEventListener('keydown', (e) => {
  const card = e.target.closest('[data-id]');
  if (card && e.key === 'Enter') openDetail(card.dataset.id);
});

/* ---------- Tampilan: grid / ringkas / daftar ---------- */
const LIST_COLS = [
  ['', ''], ['Pengiklan', 'az'], ['Platform', ''], ['Kategori', ''],
  ['Skor', 'score'], ['Umur', 'age'], ['Engagement', 'eng'], ['Disimpan', 'new']
];

function listHeader() {
  const h = document.createElement('div');
  h.className = 'row-head';
  const s = state.f.sort;
  h.innerHTML = LIST_COLS.map(([label, key]) => {
    if (!key) return `<span>${label}</span>`;
    const on = key === s || (key === 'new' && s === 'old');
    const arrow = on ? (s === 'old' ? ' ↑' : key === 'az' ? ' ↓' : ' ↓') : '';
    return `<button type="button" data-sortkey="${key}" class="${on ? 'on' : ''}" title="Urutkan">${label}${arrow}</button>`;
  }).join('');
  return h;
}

function setSort(key) {
  // Klik "Disimpan" dua kali = balik urutan terbaru ↔ terlama
  state.f.sort = key === 'new' && state.f.sort === 'new' ? 'old' : key;
  $('#fSort').value = state.f.sort;
  applyFilters();
}

function rowHTML(a) {
  const sc = scoreOf(a);
  const vids = (a.media || []).some((m) => m.type === 'video');
  const plat = PLATFORM_LABEL[a.platform] || 'Web';
  return `
    <div class="r-th"><div class="th" data-thumb="${esc(a.thumbId || '')}">${a.thumbId ? '' : '<div class="noimg">—</div>'}</div>${vids ? `<span class="r-play">${ICON_PLAY}</span>` : ''}</div>
    <div class="r-main"><div class="adv">${esc(a.advertiser || 'Pengiklan tidak diketahui')}${a.favorite ? ` <span class="r-fav">${ICON_HEART}</span>` : ''}</div>
      <div class="r-cap">${a.caption ? esc(a.caption) : '<span class="muted-i">Tanpa caption</span>'}</div></div>
    <div><span class="pbadge inl ${esc(a.platform)}">${esc(plat)}</span></div>
    <div>${a.category ? `<span class="cat">${esc(a.category)}</span>` : '<span class="muted-i">—</span>'}</div>
    <div>${sc.label === 'unknown' ? '<span class="muted-i">—</span>' : `<span class="wbadge inl ${sc.label}${sc.conf === 'low' ? ' lowconf' : ''}"><b>${sc.score}</b> ${LABEL[sc.label].short}${sc.conf === 'low' ? '?' : ''}</span>`}</div>
    <div class="num">${sc.days != null ? `${sc.days} hr` : '<span class="muted-i">—</span>'}</div>
    <div class="num">${sc.eng != null ? fmtN(sc.eng) : '<span class="muted-i">—</span>'}</div>
    <div class="num date">${fmtDate(a.savedAt)}</div>`;
}

function setView(v, save = true) {
  if (!['grid', 'compact', 'list'].includes(v)) v = 'grid';
  state.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === v);
    b.setAttribute('aria-pressed', String(b.dataset.v === v));
  });
  if (save) saveSettings({ view: v });
  applyFilters();
}

$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b && b.dataset.v !== state.view) setView(b.dataset.v);
});

/* ---------- Filter controls ---------- */
let qTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.f.q = e.target.value.trim().toLowerCase(); applyFilters(); }, 150);
});
$('#platformSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#platformSeg button').forEach((x) => x.classList.toggle('on', x === b));
  state.f.platform = b.dataset.p;
  applyFilters();
});
$('#fCategory').addEventListener('change', (e) => { state.f.category = e.target.value; applyFilters(); });
$('#fType').addEventListener('change', (e) => { state.f.type = e.target.value; applyFilters(); });
$('#fSort').addEventListener('change', (e) => { state.f.sort = e.target.value; applyFilters(); });
$('#fWin').addEventListener('change', (e) => { state.f.win = e.target.value; applyFilters(); });
$('#fFav').addEventListener('click', (e) => {
  state.f.fav = !state.f.fav;
  e.currentTarget.setAttribute('aria-pressed', String(state.f.fav));
  applyFilters();
});

/* ---------- Detail ---------- */
const detail = { ad: null, idx: 0, dirty: false, saveTimer: null };

async function openDetail(id) {
  const ad = await getAd(id);
  if (!ad) return toast('Iklan tidak ditemukan.');
  detail.ad = ad;
  detail.idx = 0;
  detail.dirty = false;
  const m = $('#detail');
  m.hidden = false;
  $('#dPlatform').className = 'badge ' + ad.platform;
  $('#dPlatform').textContent = PLATFORM_LABEL[ad.platform] || 'Web';
  $('#dDate').textContent = 'Disimpan ' + new Date(ad.savedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  $('#autosave').textContent = '';

  const cats = allCategories();
  if (ad.category && !cats.includes(ad.category)) cats.push(ad.category);
  $('#dCategory').innerHTML = '<option value="">— Tanpa kategori —</option>' +
    cats.map((c) => `<option ${c === ad.category ? 'selected' : ''}>${esc(c)}</option>`).join('');

  m.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    el.value = k === 'tags' ? (ad.tags || []).join(', ') : (ad[k] ?? '');
  });
  updateLinks();
  drawStars();
  $('#dFav').classList.toggle('on', !!ad.favorite);
  fillIntelInputs();
  renderWin();
  await drawStrip();
  await showMedia(0);
  history.replaceState(null, '', `?open=${encodeURIComponent(id)}`);
}

function setLink(a, url) {
  const ok = /^https?:\/\//i.test(url || '');
  a.href = ok ? url : '#';
  a.classList.toggle('off', !ok);
}
function updateLinks() {
  const ad = detail.ad;
  setLink($('#dAdvLink'), ad.advertiserUrl);
  setLink($('#dPostLink'), ad.postUrl);
  setLink($('#dLandLink'), ad.landingUrl);
}

function drawStars() {
  const box = $('#dStars');
  box.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${i} bintang`;
    b.className = i <= (detail.ad.rating || 0) ? 'on' : '';
    b.innerHTML = ICON_STAR;
    b.addEventListener('click', () => {
      detail.ad.rating = detail.ad.rating === i ? 0 : i;
      drawStars();
      scheduleSave(0);
    });
    box.appendChild(b);
  }
}

async function drawStrip() {
  const media = detail.ad.media || [];
  const strip = $('#strip');
  strip.innerHTML = '';
  strip.hidden = media.length <= 1;
  $('#prev').hidden = $('#next').hidden = media.length <= 1;
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    const b = document.createElement('button');
    b.dataset.i = i;
    const src = m.type === 'image' && !m.missing ? await blobUrl(m.id) : await blobUrl(m.posterId);
    b.innerHTML = src ? `<img alt="" src="${src}">` : (m.type === 'video' ? 'VIDEO' : '—');
    b.addEventListener('click', () => showMedia(i));
    strip.appendChild(b);
  }
}

async function showMedia(i) {
  const media = detail.ad.media || [];
  const stage = $('#stage');
  stage.querySelectorAll('video').forEach((v) => v.pause());
  if (!media.length) {
    stage.innerHTML = '<div class="missing">Iklan ini disimpan tanpa media.</div>';
    return;
  }
  detail.idx = (i + media.length) % media.length;
  const m = media[detail.idx];
  document.querySelectorAll('#strip button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === detail.idx));
  if (m.type === 'image' && !m.missing) {
    stage.innerHTML = `<img alt="" src="${await blobUrl(m.id)}">`;
  } else if (m.type === 'video' && !m.missing) {
    const poster = await blobUrl(m.posterId);
    stage.innerHTML = `<video controls playsinline ${poster ? `poster="${poster}"` : ''} src="${await blobUrl(m.id)}"></video>`;
    fixWebmDuration(stage.querySelector('video'));
  } else {
    const poster = await blobUrl(m.posterId);
    const link = /^https?:/.test(detail.ad.postUrl || '') ? `<br><a href="${esc(detail.ad.postUrl)}" target="_blank" rel="noopener">Buka postingan asli ↗</a>` : '';
    stage.innerHTML = `<div style="position:relative;display:flex;align-items:center;justify-content:center;height:100%;width:100%">
      ${poster ? `<img alt="" src="${poster}" style="opacity:.45">` : ''}
      <div class="missing" style="position:absolute">File ${m.type === 'video' ? 'video' : 'media'} tidak tersimpan (streaming/terproteksi). Yang tersimpan hanya thumbnail.${link}</div></div>`;
  }
}

/* ---------- Panel sinyal winning ---------- */
function fillIntelInputs() {
  const i = detail.ad.intel || {};
  $('#iStart').value = i.startDate || '';
  $('#iActive').value = i.active === true ? '1' : i.active === false ? '0' : '';
  $('#iVar').value = i.variations ?? '';
}

function renderWin() {
  const ad = detail.ad;
  const sc = computeScore(ad, state.settings.winRules);
  const ring = $('#winScore');
  ring.className = 'win-score ' + sc.label;
  ring.querySelector('b').textContent = sc.label === 'unknown' ? '—' : sc.score;
  $('#winLabel').textContent = LABEL[sc.label].text;
  const sub = [];
  if (sc.days != null) sub.push(`Tayang ${sc.days} hari`);
  if (ad.intel?.active === true) sub.push('masih aktif');
  if (ad.intel?.active === false) sub.push('sudah berhenti');
  if (ad.intel?.variations) sub.push(`${ad.intel.variations} variasi`);
  if (sc.conf) sub.push(`keyakinan ${CONF_LABEL[sc.conf]}`);
  $('#winSub').textContent = sub.join(' · ') || 'Lengkapi tanggal mulai tayang, status, atau variasi dari Ad Library.';
  const hint = sc.conf === 'low' || (sc.conf && sc.days == null)
    ? `<li class="hint">Sinyal terkuat (umur iklan & jumlah variasi) belum ada. ${['facebook', 'instagram'].includes(ad.platform) ? 'Klik "Cek di Ad Library" untuk melengkapinya.' : 'Isi manual jika kamu tahu tanggal mulai tayangnya.'}</li>`
    : '';
  $('#winWhy').innerHTML = sc.reasons.length
    ? sc.reasons.map((r) => `<li><span>${esc(r.text)}</span><span class="p ${r.pts ? '' : 'z'}">${r.pts}/${r.max}</span></li>`).join('') +
      `<li class="tot"><span>Total ${sc.pts} dari ${sc.max} poin yang tersedia</span><span class="p">${sc.score}/100</span></li>` + hint
    : '<li>Belum ada sinyal yang tercatat.</li>';

  // CC
  const cc = ad.intel?.cc || {};
  $('#ccLine').textContent = [cc.ctr && `CTR ${cc.ctr}`, cc.budget && `Budget ${cc.budget}`, cc.objective && `Tujuan: ${cc.objective}`, cc.industry && `Industri: ${cc.industry}`, cc.region && `Wilayah: ${cc.region}`]
    .filter(Boolean).join(' · ');

  // Stat tiles
  const stats = ad.stats || [];
  const last = latestStats(ad);
  const first = stats[0];
  const tile = (k, label) => {
    const v = last?.[k];
    let d = '';
    if (stats.length > 1 && typeof v === 'number' && typeof first?.[k] === 'number' && first[k] > 0) {
      const pct = Math.round(((v - first[k]) / first[k]) * 100);
      d = pct === 0 ? '<span class="d flat">tetap</span>' : `<span class="d ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct}%</span>`;
    }
    return `<div class="stat"><span class="k">${label}</span><span class="v">${fmtN(v)}</span> ${d}</div>`;
  };
  $('#statRow').innerHTML = tile('likes', 'Like') + tile('comments', 'Komentar') + tile('shares', 'Share') + tile('views', 'Views');

  // Sparkline engagement
  const pts = stats.map((x) => ({ at: x.at, v: engagementTotal(x) })).filter((x) => x.v != null);
  if (pts.length >= 2) {
    const W = 300, H = 40;
    const min = Math.min(...pts.map((p) => p.v));
    const max = Math.max(...pts.map((p) => p.v));
    const t0 = pts[0].at, t1 = pts[pts.length - 1].at || t0 + 1;
    const xy = pts.map((p) => [((p.at - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4, H - 4 - ((p.v - min) / Math.max(1, max - min)) * (H - 8)]);
    const fd = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    $('#spark').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline fill="none" stroke="#F2542D" stroke-width="2" vector-effect="non-scaling-stroke" points="${xy.map((p) => p.join(',')).join(' ')}"/>
      ${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#F2542D"><title>${fd(pts[i].at)}: ${fmtN(pts[i].v)}</title></circle>`).join('')}
    </svg><div class="cap"><span>${fd(t0)}</span><span>Engagement · ${pts.length} catatan</span><span>${fd(t1)}</span></div>`;
  } else {
    $('#spark').innerHTML = '';
  }

  // Riwayat penggabungan → bisa dibatalkan
  const hist = ad.intelHistory || [];
  const hbox = $('#winHist');
  if (hist.length) {
    const h = hist[hist.length - 1];
    const from = h.from?.libraryId ? `ID Library ${h.from.libraryId}` : (h.from?.advertiser || 'iklan lain');
    hbox.hidden = false;
    hbox.innerHTML = `<span>Data iklan ini digabung dengan <b>${esc(from)}</b> pada ${esc(new Date(h.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))}${hist.length > 1 ? ` (${hist.length}× digabung)` : ''}.</span><button type="button" id="btnUnmerge">Batalkan penggabungan ini</button>`;
    $('#btnUnmerge').addEventListener('click', undoLastMerge);
  } else {
    hbox.hidden = true;
  }

  const checked = Math.max(ad.intel?.checkedAt || 0, last?.at || 0);
  $('#winChecked').textContent = checked ? 'Dicek ' + new Date(checked).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  $('#btnRefresh').disabled = !/^https?:/.test(ad.postUrl || '');
  const lib = $('#btnLib');
  lib.hidden = !['facebook', 'instagram'].includes(ad.platform);
  lib.textContent = ad.intel?.libraryId ? '↻ Perbarui dari Ad Library' : 'Cek di Ad Library';
}

$('#winWhyBtn').addEventListener('click', () => { $('#winWhy').hidden = !$('#winWhy').hidden; });

function onIntelEdit() {
  if (!detail.ad || $('#detail').hidden) return;
  const i = { ...(detail.ad.intel || { source: 'feed' }) };
  i.startDate = $('#iStart').value || '';
  i.active = $('#iActive').value === '1' ? true : $('#iActive').value === '0' ? false : null;
  const v = $('#iVar').value.trim();
  i.variations = v === '' ? null : Math.max(0, parseInt(v, 10));
  detail.ad.intel = i;
  renderWin();
  scheduleSave(300);
}
['#iStart', '#iActive', '#iVar'].forEach((sel) => $(sel).addEventListener('change', onIntelEdit));

async function undoLastMerge() {
  const ad = detail.ad;
  const h = (ad.intelHistory || []).slice(-1)[0];
  if (!h) return;
  if (!confirm('Kembalikan data iklan ini ke kondisi sebelum penggabungan terakhir?')) return;
  ad.intel = h.intel;
  ad.stats = (ad.stats || []).slice(0, h.statsLen);
  for (const [k, v] of Object.entries(h.fields || {})) {
    if (v === null) delete ad[k]; else ad[k] = v;
  }
  if (h.addedMedia?.length) {
    ad.media = (ad.media || []).filter((m) => !h.addedMedia.includes(m.id)).concat(h.removedMedia || []);
  }
  const dropBlobs = [...(h.addedBlobs || [])];
  if (ad.thumbId !== h.prevThumbId) {
    if (ad.thumbId && !blobIdsOf({ media: ad.media }).includes(ad.thumbId)) dropBlobs.push(ad.thumbId);
    ad.thumbId = h.prevThumbId;
  }
  ad.intelHistory = ad.intelHistory.slice(0, -1);
  ad.updatedAt = Date.now();
  await putAd(ad);
  await deleteBlobs(dropBlobs.filter((id) => id !== ad.thumbId));
  for (const id of dropBlobs) { const u = urlCache.get(id); if (u) URL.revokeObjectURL(u); urlCache.delete(id); }
  detail.dirty = true;
  await openDetail(ad.id);
  detail.dirty = true;
  toast('Penggabungan dibatalkan. Data sebelumnya dipulihkan.');
}

async function reloadDetailAd() {
  if (!detail.ad) return;
  const fresh = await getAd(detail.ad.id);
  if (!fresh) return;
  detail.ad = fresh;
  const idx = state.ads.findIndex((a) => a.id === fresh.id);
  if (idx >= 0) state.ads[idx] = fresh;
  detail.dirty = true;
  fillIntelInputs();
  renderWin();
}

async function runRefresh(btn, kind) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = kind === 'library' ? 'Membaca Ad Library…' : 'Membuka postingan…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'refresh', adId: detail.ad.id, kind });
    if (res?.ok) {
      await reloadDetailAd();
      toast(kind === 'library' ? 'Data Ad Library diperbarui.' : 'Stats terbaru tercatat.');
    } else {
      toast(res?.reason || 'Gagal memperbarui.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    if (detail.ad) renderWin();
  }
}

$('#btnRefresh').addEventListener('click', (e) => runRefresh(e.currentTarget, 'stats'));
$('#btnLib').addEventListener('click', async (e) => {
  if (detail.ad.intel?.libraryId) return runRefresh(e.currentTarget, 'library');
  await chrome.runtime.sendMessage({ type: 'openAdLibrarySearch', adId: detail.ad.id, query: detail.ad.advertiser || '' });
  toast('Cari iklan yang sama di Ad Library, lalu klik Simpan. Datanya akan digabung ke iklan ini.');
});

$('#prev').addEventListener('click', () => showMedia(detail.idx - 1));
$('#next').addEventListener('click', () => showMedia(detail.idx + 1));

function scheduleSave(delay = 500) {
  detail.dirty = true;
  clearTimeout(detail.saveTimer);
  $('#autosave').textContent = 'Menyimpan…';
  detail.saveTimer = setTimeout(async () => {
    detail.ad.updatedAt = Date.now();
    await putAd(detail.ad);
    const idx = state.ads.findIndex((a) => a.id === detail.ad.id);
    if (idx >= 0) state.ads[idx] = detail.ad;
    $('#autosave').textContent = 'Tersimpan ✓';
  }, delay);
}

$('#detail').querySelectorAll('[data-k]').forEach((el) => {
  el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    if (!detail.ad) return;
    const k = el.dataset.k;
    detail.ad[k] = k === 'tags' ? el.value.split(',').map((t) => t.trim()).filter(Boolean) : el.value;
    if (/Url$/.test(k)) updateLinks();
    scheduleSave(el.tagName === 'SELECT' ? 0 : 600);
  });
});

$('#dFav').addEventListener('click', (e) => {
  detail.ad.favorite = !detail.ad.favorite;
  e.currentTarget.classList.toggle('on', detail.ad.favorite);
  scheduleSave(0);
});

$('#copyCaption').addEventListener('click', async () => {
  await navigator.clipboard.writeText(detail.ad.caption || '');
  toast('Caption disalin.');
});

$('#dDownload').addEventListener('click', async () => {
  const media = (detail.ad.media || []).filter((m) => !m.missing);
  if (!media.length) return toast('Tidak ada file media yang tersimpan.');
  const base = (detail.ad.advertiser || 'iklan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'iklan';
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    const ext = (m.mime.split('/')[1] || (m.type === 'video' ? 'mp4' : 'jpg')).split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
    const a = document.createElement('a');
    a.href = await blobUrl(m.id);
    a.download = `${base}_${i + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 250));
  }
});

$('#dDelete').addEventListener('click', async () => {
  if (!confirm('Hapus iklan ini beserta medianya? Tindakan ini tidak bisa dibatalkan.')) return;
  const id = detail.ad.id;
  for (const bid of blobIdsOf(detail.ad)) {
    const u = urlCache.get(bid);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(bid);
  }
  await deleteAd(id);
  state.ads = state.ads.filter((a) => a.id !== id);
  detail.dirty = false;
  closeDetail();
  applyFilters();
  toast('Iklan dihapus.');
});

async function closeDetail() {
  if (detail.saveTimer && detail.dirty) {
    clearTimeout(detail.saveTimer);
    await putAd(detail.ad);
    const idx = state.ads.findIndex((a) => a.id === detail.ad.id);
    if (idx >= 0) state.ads[idx] = detail.ad;
  }
  $('#stage').querySelectorAll('video').forEach((v) => v.pause());
  $('#detail').hidden = true;
  history.replaceState(null, '', location.pathname);
  if (detail.dirty) {
    const y = window.scrollY;
    fillCategoryFilter();
    applyFilters();
    while (state.shown < state.filtered.length && document.body.scrollHeight < y + innerHeight) renderMore();
    window.scrollTo(0, y);
  }
  detail.ad = null;
}

$('#dClose').addEventListener('click', closeDetail);
$('#detail').addEventListener('mousedown', (e) => { if (e.target.id === 'detail') closeDetail(); });

/* ---------- Settings ---------- */
async function openSettings() {
  state.settings = await getSettings();
  $('#settings').hidden = false;
  drawCatList();
  drawRules();
  document.querySelectorAll('[data-site]').forEach((cb) => { cb.checked = state.settings.enabled[cb.dataset.site] !== false; });
  $('#usage').textContent = `Total ${state.ads.length} iklan · penyimpanan terpakai ± ${fmtBytes(await storageEstimate())}`;
  $('#backupStatus').textContent = '';
  drawUpdSettings();
}

const RULE_FIELDS = [
  ['daysHigh', 'Tayang ≥ … hari (+40)'],
  ['daysMid', 'Tayang ≥ … hari (+25)'],
  ['daysLow', 'Tayang ≥ … hari (+10)'],
  ['activeBonus', 'Bonus masih aktif'],
  ['varHigh', 'Variasi ≥ … (+25)'],
  ['varMid', 'Variasi ≥ … (+12)'],
  ['engHigh', 'Engagement ≥ … (+15)'],
  ['engMid', 'Engagement ≥ … (+8)'],
  ['growthPct', 'Engagement naik ≥ …% (+5)'],
  ['labelHigh', 'Skor ≥ … = Tinggi'],
  ['labelMid', 'Skor ≥ … = Sedang']
];

function drawRules() {
  const r = state.settings.winRules;
  $('#rules').innerHTML = RULE_FIELDS.map(([k, label]) =>
    `<label>${esc(label)}<input type="number" min="0" data-rule="${k}" value="${r[k]}"></label>`).join('');
  $('#rules').querySelectorAll('input').forEach((inp) => inp.addEventListener('change', async () => {
    const v = parseInt(inp.value, 10);
    if (isNaN(v) || v < 0) { inp.value = state.settings.winRules[inp.dataset.rule]; return; }
    state.settings.winRules = { ...state.settings.winRules, [inp.dataset.rule]: v };
    await saveSettings({ winRules: state.settings.winRules, winRulesCustom: true });
    state.scores.clear();
    applyFilters();
  }));
}

$('#rulesReset').addEventListener('click', async () => {
  await saveSettings({ winRules: { ...DEFAULT_RULES }, winRulesCustom: false });
  state.settings = await getSettings(); // aturan efektif = default (+ rekomendasi remote)
  state.scores.clear();
  drawRules();
  applyFilters();
  toast('Aturan skor dikembalikan ke default.');
});

function drawCatList() {
  const ul = $('#catList');
  const counts = {};
  state.ads.forEach((a) => { if (a.category) counts[a.category] = (counts[a.category] || 0) + 1; });
  ul.innerHTML = '';
  state.settings.categories.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<input type="text" value="${esc(c)}"><span class="n">${counts[c] || 0} iklan</span>
      <button class="icon-btn" title="Hapus kategori"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>`;
    const inp = li.querySelector('input');
    inp.addEventListener('change', async () => {
      const name = inp.value.trim();
      if (!name || name === c) { inp.value = c; return; }
      if (state.settings.categories.includes(name)) { inp.value = c; return toast('Kategori itu sudah ada.'); }
      state.settings.categories[i] = name;
      await saveSettings({ categories: state.settings.categories });
      await bulkUpdateCategory(c, name);
      drawCatList();
      toast(`Kategori diganti menjadi "${name}".`);
    });
    li.querySelector('button').addEventListener('click', async () => {
      const n = counts[c] || 0;
      if (n && !confirm(`${n} iklan memakai kategori "${c}". Kategorinya akan dikosongkan. Lanjut?`)) return;
      state.settings.categories.splice(i, 1);
      await saveSettings({ categories: state.settings.categories });
      if (n) await bulkUpdateCategory(c, '');
      drawCatList();
    });
    ul.appendChild(li);
  });
}

async function bulkUpdateCategory(from, to) {
  for (const a of state.ads) {
    if (a.category === from) { a.category = to; await putAd(a); }
  }
  if (state.f.category === from) state.f.category = to;
  fillCategoryFilter();
  applyFilters();
}

$('#catAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#catNew').value.trim();
  if (!name) return;
  if (state.settings.categories.includes(name)) return toast('Kategori itu sudah ada.');
  state.settings.categories.push(name);
  await saveSettings({ categories: state.settings.categories });
  $('#catNew').value = '';
  drawCatList();
  fillCategoryFilter();
});

document.querySelectorAll('[data-site]').forEach((cb) => cb.addEventListener('change', async () => {
  state.settings.enabled[cb.dataset.site] = cb.checked;
  await saveSettings({ enabled: state.settings.enabled });
}));

$('#btnSettings').addEventListener('click', openSettings);
$('#sClose').addEventListener('click', () => { $('#settings').hidden = true; });
$('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; });

/* ---------- Backup ---------- */
$('#btnExport').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const status = $('#backupStatus');
  btn.disabled = true;
  try {
    const ads = await getAllAds();
    const settings = await getSettings();
    const entries = [];
    const types = {};
    for (const ad of ads) {
      for (const id of blobIdsOf(ad)) {
        const b = await getBlob(id);
        if (b) { entries.push({ name: `media/${id}`, blob: b }); types[id] = b.type; }
      }
    }
    const json = JSON.stringify({ app: 'adstash', version: 1, exportedAt: new Date().toISOString(), settings, types, ads }, null, 1);
    entries.unshift({ name: 'adstash-backup.json', blob: new Blob([json], { type: 'application/json' }) });
    const zip = await makeZip(entries, (i, n) => { status.textContent = `Mengemas ${i}/${n} file…`; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `adstash-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    status.textContent = `Backup selesai: ${ads.length} iklan, ${fmtBytes(zip.size)}.`;
  } catch (err) {
    status.textContent = 'Gagal ekspor: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('#backupStatus');
  try {
    status.textContent = 'Membaca backup…';
    const zip = await readZip(file);
    const jsonEntry = zip.get('adstash-backup.json');
    if (!jsonEntry) throw new Error('File ini bukan backup AdStash.');
    const data = JSON.parse(await (await jsonEntry.blob()).text());
    const existing = new Set(state.ads.map((a) => a.id));
    let added = 0;
    let skipped = 0;
    for (let i = 0; i < data.ads.length; i++) {
      const ad = data.ads[i];
      status.textContent = `Memulihkan ${i + 1}/${data.ads.length}…`;
      if (existing.has(ad.id)) { skipped++; continue; }
      const blobs = [];
      for (const id of blobIdsOf(ad)) {
        const entry = zip.get(`media/${id}`);
        if (entry) blobs.push({ id, blob: await entry.blob((data.types || {})[id] || '') });
      }
      await saveAdWithBlobs(ad, blobs);
      added++;
    }
    if (data.settings?.categories) {
      const s = await getSettings();
      const merged = [...s.categories];
      data.settings.categories.forEach((c) => { if (!merged.includes(c)) merged.push(c); });
      state.settings = await saveSettings({ categories: merged });
      drawCatList();
    }
    status.textContent = `Impor selesai: ${added} iklan ditambahkan${skipped ? `, ${skipped} dilewati karena sudah ada` : ''}.`;
    await load();
  } catch (err) {
    status.textContent = 'Gagal impor: ' + err.message;
  }
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (!$('#detail').hidden) closeDetail();
    else if (!$('#settings').hidden) $('#settings').hidden = true;
    return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  if (!$('#detail').hidden) {
    if (e.key === 'ArrowLeft') showMedia(detail.idx - 1);
    if (e.key === 'ArrowRight') showMedia(detail.idx + 1);
  }
});

/* ---------- Sinkron saat tab kembali aktif ---------- */
let lastCount = -1;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !$('#detail').hidden) return;
  const ads = await getAllAds();
  if (ads.length !== lastCount || ads[0]?.id !== state.ads[0]?.id) {
    state.ads = ads;
    fillCategoryFilter();
    applyFilters();
  }
  lastCount = ads.length;
});
chrome.storage.onChanged.addListener(async (ch) => {
  if (ch.settings || ch.remoteConfig) {
    state.settings = await getSettings();
    state.scores.clear();
    fillCategoryFilter();
    if (ch.remoteConfig) { applyFilters(); drawRules(); }
  }
});

/* ---------- Start ---------- */
(async () => {
  // Pastikan migrasi data (bila ada) selesai sebelum membaca iklan.
  await new Promise((r) => chrome.runtime.sendMessage({ type: 'ensureMigrated' }, () => r()));
  await load();
  initUpdates({ toast, getSettings, saveSettings }).then(drawUpdSettings).catch(() => {});
  lastCount = state.ads.length;
  const open = new URLSearchParams(location.search).get('open');
  if (open) openDetail(open);
})();
