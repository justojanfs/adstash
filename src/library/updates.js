// UI pembaruan di Library: banner, modal langkah update, status di Pengaturan.
import { CHANGELOG } from '../shared/changelog.js';
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
    if (ch.updateInfo || ch.updateState || ch.remoteConfig || ch.updateCheck || ch.justUpdated || ch.migrationError || ch.schemaAhead) {
      drawNotices(); drawSettings();
    }
  });
  await drawNotices();
}

async function state() {
  return chrome.storage.local.get(['updateInfo', 'updateState', 'updateCheck', 'remoteConfig', 'justUpdated', 'migrationError', 'schemaAhead', 'preMigrationSnapshot', 'seenAnnounce']);
}

export async function drawNotices() {
  const st = await state();
  const box = $('#notices');
  const out = [];
  const u = st.updateInfo;
  if (st.schemaAhead) {
    out.push(`<div class="notice err"><b>Versi ekstensi ini lebih lama dari data kamu.</b><span class="sp">Data dibuat oleh versi yang lebih baru (skema ${esc(st.schemaAhead.found)}). Pasang versi terbaru AdStash dan jangan menyimpan iklan dulu.</span></div>`);
  }
  if (st.migrationError) {
    out.push(`<div class="notice err"><b>Migrasi data gagal.</b><span class="sp">${esc(st.migrationError.message)}. Data lamamu aman; kamu bisa memulihkan snapshot di Pengaturan → Pembaruan.</span><button class="btn sm ghost" data-act="settings">Buka Pengaturan</button></div>`);
  }
  if (!storeManaged() && u && u.available && (u.mustUpdate || u.severity === 'important' || st.updateState?.dismissedVersion !== u.latest)) {
    const cls = u.mustUpdate ? 'err' : 'upd';
    out.push(`<div class="notice ${cls}"><b>${u.mustUpdate ? 'Versi ini sudah tidak didukung.' : `AdStash ${esc(u.latest)} tersedia`}</b><span class="sp">Kamu memakai ${esc(cur())}.${u.changelog[0] ? ' ' + esc(u.changelog[0]) : ''}</span><button class="btn sm primary" data-act="upd">Lihat &amp; perbarui</button>${u.mustUpdate || u.severity === 'important' ? '' : '<button class="x" data-act="dismiss" title="Lewati versi ini">×</button>'}</div>`);
  }
  if (st.justUpdated && st.justUpdated.to === cur()) {
    const entry = CHANGELOG.find((c) => c.version === st.justUpdated.to);
    out.push(`<div class="notice info"><b>AdStash diperbarui ke ${esc(st.justUpdated.to)}.</b><span class="sp">${entry ? esc(entry.notes.join(' · ')) : 'Lihat catatan perubahan di rilis.'}</span><button class="x" data-act="ack" title="Tutup">×</button></div>`);
  }
  const ann = (st.remoteConfig && st.remoteConfig.announce) || (u && u.announce);
  if (ann && ann.text && st.seenAnnounce !== ann.id) {
    out.push(`<div class="notice info"><span class="sp">${esc(ann.text)}</span>${ann.url ? `<a class="btn sm ghost" href="${esc(ann.url)}" target="_blank" rel="noopener">Buka</a>` : ''}<button class="x" data-act="annx" data-id="${esc(ann.id)}" title="Tutup">×</button></div>`);
  }
  box.innerHTML = out.join('');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'upd') openModal();
    else if (a === 'dismiss') await send({ type: 'dismissUpdate', version: u.latest });
    else if (a === 'ack') { await chrome.storage.local.remove('justUpdated'); drawNotices(); }
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
