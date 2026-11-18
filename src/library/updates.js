// UI pembaruan di Library: banner, modal langkah update, status di Pengaturan.
import { cmpVer } from '../shared/semver.js';
import { isPlaceholderRepo } from '../shared/config.js';
const storeManaged = () => !!chrome.runtime.getManifest().update_url;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cur = () => chrome.runtime.getManifest().version;
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, (x) => r(x)));
const fmtDT = (t) => new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let ctx = { toast: () => {}, getSettings: async () => ({}), saveSettings: async () => {} };

export async function initUpdates(c) {
  ctx = { ...ctx, ...c };
  $('#btnCheckUpd').addEventListener('click', async () => {
    $('#btnCheckUpd').disabled = true;
    $('#updStatus').textContent = 'Memeriksa…';
    const r = await send({ type: 'checkUpdate' });
    $('#btnCheckUpd').disabled = false;
    await drawSettings();
    await drawNotices();
    const { updateInfo } = await chrome.storage.local.get('updateInfo');
    if (r && r.error) ctx.toast('Gagal memeriksa: ' + r.error);
    else if (r && r.note && !(updateInfo && updateInfo.available)) ctx.toast(r.note);
    else if (updateInfo && updateInfo.available) openModal();
    else ctx.toast('Kamu sudah memakai versi terbaru.');
  });
  $('#btnShowUpd').addEventListener('click', openModal);
  $('#updClose').addEventListener('click', () => { $('#updModal').hidden = true; });
  $('#updModal').addEventListener('click', (e) => { if (e.target.id === 'updModal') $('#updModal').hidden = true; });
  $('#optCheck').addEventListener('change', async (e) => {
    const s = await ctx.getSettings();
    await ctx.saveSettings({ updates: { ...s.updates, check: e.target.checked } });
  });
  $('#optRemote').addEventListener('change', async (e) => {
    const s = await ctx.getSettings();
    await ctx.saveSettings({ updates: { ...s.updates, remote: e.target.checked } });
  });
  $('#btnRestoreSnap').addEventListener('click', async () => {
    if (!confirm('Pulihkan metadata iklan (caption, catatan, tag, dsb.) ke kondisi sebelum update? Perubahan yang kamu buat setelah update pada iklan-iklan itu akan hilang. Media tidak diubah.')) return;
    const r = await send({ type: 'restoreSnapshot' });
    ctx.toast(r && r.ok ? `${r.restored} iklan dipulihkan. Muat ulang halaman.` : (r && r.error) || 'Gagal memulihkan.');
    await drawNotices();
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.updateInfo || ch.updateState || ch.remoteConfig || ch.updateCheck || ch.migrationError || ch.schemaAhead) {
      drawNotices(); drawSettings();
    }
  });
  await drawNotices();
}

async function state() {
  return chrome.storage.local.get(['updateInfo', 'updateState', 'updateCheck', 'remoteConfig', 'migrationError', 'schemaAhead', 'preMigrationSnapshot', 'seenAnnounce']);
}

const X_BTN = (act, title, extra = '') => `<button class="x" data-act="${act}" ${extra} title="${title}" aria-label="${title}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
const notice = (cls, title, text, actions = '') =>
  `<div class="notice ${cls}"><div class="body">${title ? `<b>${title}</b>` : ''}${text ? `<span class="sp" title="${esc(text)}">${esc(text)}</span>` : ''}</div>${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;

export async function drawNotices() {
  const st = await state();
  const box = $('#notices');
  const out = [];
  const u = st.updateInfo;
  if (st.schemaAhead) {
    out.push(notice('err', 'Versi ekstensi ini lebih lama dari data kamu.', `Data dibuat oleh versi yang lebih baru (skema ${st.schemaAhead.found}). Pasang versi terbaru AdStash dan jangan menyimpan iklan dulu.`));
  }
  if (st.migrationError) {
    out.push(notice('err', 'Migrasi data gagal.', `${st.migrationError.message}. Data lamamu aman; kamu bisa memulihkan snapshot di Pengaturan → Pembaruan.`, '<button class="btn sm ghost" data-act="settings">Buka Pengaturan</button>'));
  }
  if (!storeManaged() && u && u.available && (u.mustUpdate || u.severity === 'important' || st.updateState?.dismissedVersion !== u.latest)) {
    const skip = u.mustUpdate || u.severity === 'important' ? '' : X_BTN('dismiss', 'Lewati versi ini');
    out.push(notice(u.mustUpdate ? 'err' : 'upd',
      u.mustUpdate ? 'Versi ini sudah tidak didukung.' : `AdStash ${esc(u.latest)} tersedia`,
      `Kamu memakai ${cur()}.${u.changelog[0] ? ' ' + u.changelog[0] : ''}`,
      `<button class="btn sm primary" data-act="upd">Lihat &amp; perbarui</button>${skip}`));
  }
  const ann = (st.remoteConfig && st.remoteConfig.announce) || (u && u.announce);
  if (ann && ann.text && st.seenAnnounce !== ann.id) {
    out.push(notice('info', '', ann.text,
      `${ann.url ? `<a class="btn sm ghost" href="${esc(ann.url)}" target="_blank" rel="noopener">Buka</a>` : ''}${X_BTN('annx', 'Tutup', `data-id="${esc(ann.id)}"`)}`));
  }
  box.innerHTML = out.join('');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'upd') openModal();
    else if (a === 'dismiss') await send({ type: 'dismissUpdate', version: u.latest });
    else if (a === 'annx') { await chrome.storage.local.set({ seenAnnounce: b.dataset.id }); drawNotices(); }
    else if (a === 'settings') $('#btnSettings').click();
  };
}

export async function drawSettings() {
  const st = await state();
  const s = await ctx.getSettings();
  const u = st.updateInfo;
  $('#verLine').textContent = `Terpasang: v${cur()}` + (storeManaged() ? ' · dipasang dari store, diperbarui otomatis oleh browser' : (u ? ` · terbaru di GitHub: v${u.latest}` : ''));
  $('#optCheck').checked = s.updates.check !== false;
  $('#optRemote').checked = s.updates.remote !== false;
  $('#btnShowUpd').hidden = !(u && u.available);
  const bits = [];
  if (isPlaceholderRepo() && !st.updateCheck?.at) bits.push('Pengecekan belum aktif: repo distribusi belum diatur oleh pembuat ekstensi.');
  else if (st.updateCheck) bits.push(st.updateCheck.error ? `Cek terakhir ${fmtDT(st.updateCheck.at)} gagal (${st.updateCheck.error})` : `Cek terakhir ${fmtDT(st.updateCheck.at)}`);
  if (st.updateCheck && st.updateCheck.note) bits.push(st.updateCheck.note.replace(/\.$/, ''));
  if (st.remoteConfig) bits.push(`aturan jarak jauh aktif: rev ${st.remoteConfig.rev}`);
  $('#updStatus').textContent = bits.join(' · ') + (bits.length ? '.' : '');
  const snap = st.preMigrationSnapshot;
  $('#snapRow').hidden = !snap;
  if (snap) $('#snapTxt').textContent = `Snapshot pengaman: ${snap.ads.length} iklan, dibuat ${fmtDT(snap.at)} sebelum migrasi data ke skema ${snap.to} (ekstensi v${snap.appVersion || '?'}). Pakai hanya jika data terlihat rusak setelah update.`;
}

async function openModal() {
  const st = await state();
  const u = st.updateInfo;
  if (!u) return;
  const newer = cmpVer(u.latest, cur()) > 0;
  $('#updTitle').textContent = newer ? `AdStash ${u.latest} tersedia` : 'Kamu sudah di versi terbaru';
  $('#updBody').innerHTML = `
    <div class="ver"><span class="pill old">Terpasang v${esc(cur())}</span> → <span class="pill">Terbaru v${esc(u.latest)}</span>${u.released ? `<span class="muted-i">· ${esc(u.released)}</span>` : ''}</div>
    ${u.changelog.length ? `<ul class="log">${u.changelog.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <ol class="steps">
      <li><b>Ekspor backup</b> dulu (Pengaturan → Ekspor backup) — pengaman ekstra, terutama untuk update besar.</li>
      <li><b>Unduh</b> zip versi baru. ${u.download ? `<button class="btn sm primary" id="updDl">Unduh v${esc(u.latest)} (.zip)</button>` : u.page ? '<button class="btn sm primary" id="updPage">Buka halaman rilis</button>' : ''}${u.sha256 ? `<div class="hash">SHA-256: ${esc(u.sha256)}</div>` : ''}</li>
      <li><b>Ekstrak dan timpa</b> isi folder AdStash yang sekarang terpasang (folder yang sama, jangan folder baru — data iklanmu tetap aman karena tersimpan di browser, bukan di folder).</li>
      <li>Klik <button class="btn sm ghost" id="updReload">Muat ulang ekstensi</button> (atau ⟳ di <code>chrome://extensions</code> / <code>edge://extensions</code>).</li>
    </ol>
    <div class="foot">
      ${u.page ? '<button class="btn ghost sm" id="updNotes">Catatan rilis lengkap</button>' : ''}
      ${u.mustUpdate || u.severity === 'important' ? '' : '<button class="btn ghost sm" id="updSkip">Lewati versi ini</button>'}
      <button class="btn ghost sm" id="updLater">Nanti</button>
    </div>`;
  const open = (url) => url && window.open(url, '_blank', 'noopener');
  $('#updDl')?.addEventListener('click', () => open(u.download));
  $('#updPage')?.addEventListener('click', () => open(u.page));
  $('#updNotes')?.addEventListener('click', () => open(u.page));
  $('#updReload').addEventListener('click', async () => {
    if (!confirm('Muat ulang ekstensi sekarang? Pastikan file versi baru sudah menimpa folder lama. Tab ini akan tertutup/refresh.')) return;
    await send({ type: 'reloadExtension' });
  });
  $('#updSkip')?.addEventListener('click', async () => { await send({ type: 'dismissUpdate', version: u.latest }); $('#updModal').hidden = true; });
  $('#updLater').addEventListener('click', () => { $('#updModal').hidden = true; });
  $('#updModal').hidden = false;
}
