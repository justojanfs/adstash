import { getAllAds, getBlob } from '../shared/db.js';
import { getSettings, saveSettings, PLATFORM_LABEL } from '../shared/settings.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('#open').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'openLibrary' });
  window.close();
});

(async () => {
  await new Promise((r) => chrome.runtime.sendMessage({ type: 'ensureMigrated' }, () => r()));
  const { updateInfo: ui, updateState: us } = await chrome.storage.local.get(['updateInfo', 'updateState']);
  if (!chrome.runtime.getManifest().update_url && ui && ui.available && (ui.mustUpdate || ui.severity === 'important' || us?.dismissedVersion !== ui.latest)) {
    $('#upd').hidden = false;
    $('#upd').classList.toggle('must', !!ui.mustUpdate);
    $('#updTxt').textContent = ui.mustUpdate ? `Versi ini tidak didukung lagi. Perbarui ke ${ui.latest}.` : `Versi ${ui.latest} tersedia.`;
    $('#updGo').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openLibrary' });
      window.close();
    });
  }
  const [ads, settings, [tab]] = await Promise.all([
    getAllAds(),
    getSettings(),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  $('#sub').textContent = `${ads.length} iklan tersimpan`;

  // Toggle per situs aktif
  let site = '';
  try {
    const h = new URL(tab.url).hostname;
    site = /facebook\.com$/.test(h) ? 'facebook' : /instagram\.com$/.test(h) ? 'instagram' : /tiktok\.com$/.test(h) ? 'tiktok' : '';
  } catch {}
  if (site) {
    $('#site').hidden = false;
    $('#siteName').textContent = PLATFORM_LABEL[site];
    const cb = $('#siteToggle');
    cb.checked = settings.enabled[site] !== false;
    cb.addEventListener('change', async () => {
      settings.enabled[site] = cb.checked;
      await saveSettings({ enabled: settings.enabled });
    });
  }

  const recent = ads.slice(0, 3);
  if (recent.length) $('#recentTitle').hidden = false;
  for (const a of recent) {
    const li = document.createElement('li');
    const b = a.thumbId ? await getBlob(a.thumbId) : null;
    const src = b ? URL.createObjectURL(b) : '';
    li.innerHTML = `${src ? `<img class="t" src="${src}" alt="">` : '<div class="t"></div>'}
      <div class="m"><div class="a">${esc(a.advertiser || 'Tanpa nama')}</div>
      <div class="c">${esc([PLATFORM_LABEL[a.platform], a.category].filter(Boolean).join(' · '))}</div></div>`;
    li.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openLibrary', adId: a.id });
      window.close();
    });
    $('#recent').appendChild(li);
  }
})();
