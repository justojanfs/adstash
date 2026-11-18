// Pengecekan versi baru + remote config. Berjalan di service worker.
import { UPDATE_BASE, CHECK_EVERY_MIN, MIN_GAP_MS, isPlaceholderRepo } from './config.js';
import { validateVersionInfo, validateRemoteConfig } from './remote.js';
import { cmpVer } from './semver.js';

const cur = () => chrome.runtime.getManifest().version;
// Bila dipasang dari Chrome Web Store / Edge Add-ons, manifest otomatis berisi update_url
// dan store yang mengurus update → pengecekan versi manual tidak diperlukan.
export const storeManaged = () => !!chrome.runtime.getManifest().update_url;

async function base() {
  const { devUpdateBase } = await chrome.storage.local.get('devUpdateBase'); // hanya untuk pengujian
  return devUpdateBase || (isPlaceholderRepo() ? '' : UPDATE_BASE);
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if (txt.length > 200000) throw new Error('Respons terlalu besar');
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

export async function applyBadge() {
  if (storeManaged()) { await chrome.action.setBadgeText({ text: '' }); return; }
  const { updateInfo, updateState } = await chrome.storage.local.get(['updateInfo', 'updateState']);
  const show = updateInfo && updateInfo.available &&
    (updateInfo.severity === 'important' || updateInfo.mustUpdate || updateState?.dismissedVersion !== updateInfo.latest);
  await chrome.action.setBadgeText({ text: show ? '↑' : '' });
  if (show) await chrome.action.setBadgeBackgroundColor({ color: updateInfo.mustUpdate ? '#C62828' : '#1F9D55' });
}

export async function checkForUpdate({ force = false } = {}) {
  const { settings, updateCheck } = await chrome.storage.local.get(['settings', 'updateCheck']);
  const opt = { check: true, remote: true, ...((settings && settings.updates) || {}) };
  if (!force && !opt.check && !opt.remote) return { skipped: 'off' };
  if (!force && updateCheck && Date.now() - updateCheck.at < MIN_GAP_MS) return { skipped: 'recent' };
  const b = await base();
  if (!b) {
    await chrome.storage.local.set({ updateCheck: { at: Date.now(), error: 'Repo distribusi belum diatur (src/shared/config.js).' } });
    return { error: 'no-repo' };
  }
  const res = { at: Date.now(), error: '' };
  const tasks = [];
  if ((force || opt.check) && !storeManaged()) {
    tasks.push(fetchJson(b + 'version.json').then(async (raw) => {
      const info = validateVersionInfo(raw);
      if (!info) throw new Error('version.json tidak valid');
      info.available = cmpVer(info.latest, cur()) > 0;
      info.mustUpdate = !!info.minSupported && cmpVer(cur(), info.minSupported) < 0;
      info.checkedAt = Date.now();
      await chrome.storage.local.set({ updateInfo: info });
    }));
  }
  if (force || opt.remote) {
    tasks.push(fetchJson(b + 'remote-config.json').then(async (raw) => {
      if (raw && raw.requires && cmpVer(raw.requires, cur()) > 0) {
        // Bukan error: aturan baru itu hanya cocok untuk versi ekstensi yang lebih baru.
        res.note = `Aturan jarak jauh ${String(raw.rev || '').slice(0, 30)} butuh AdStash ≥ ${String(raw.requires).slice(0, 12)}; perbarui ekstensi.`;
        return;
      }
      const rc = validateRemoteConfig(raw, cur());
      if (!rc) throw new Error('remote-config.json tidak valid / butuh versi lebih baru');
      rc.fetchedAt = Date.now();
      await chrome.storage.local.set({ remoteConfig: rc });
    }));
  }
  const out = await Promise.allSettled(tasks);
  const bad = out.find((o) => o.status === 'rejected');
  if (bad) res.error = String(bad.reason && bad.reason.message || bad.reason);
  await chrome.storage.local.set({ updateCheck: res });
  await applyBadge();
  return res;
}

export function scheduleChecks() {
  chrome.alarms.get('adstash-update', (a) => {
    if (!a) chrome.alarms.create('adstash-update', { periodInMinutes: CHECK_EVERY_MIN, delayInMinutes: 1 });
  });
}

// Deteksi versi berubah (update manual lalu "Muat ulang") → simpan catatan "baru di versi X".
export async function noteVersionChange() {
  const { lastSeenVersion } = await chrome.storage.local.get('lastSeenVersion');
  const now = cur();
  if (lastSeenVersion && lastSeenVersion !== now) {
    await chrome.storage.local.set({ justUpdated: { from: lastSeenVersion, to: now, at: Date.now() } });
  }
  if (lastSeenVersion !== now) {
    await chrome.storage.local.set({ lastSeenVersion: now });
    // info versi lama bisa basi: hitung ulang "available" terhadap versi terpasang sekarang
    const { updateInfo } = await chrome.storage.local.get('updateInfo');
    if (updateInfo) {
      updateInfo.available = cmpVer(updateInfo.latest, now) > 0;
      updateInfo.mustUpdate = !!updateInfo.minSupported && cmpVer(now, updateInfo.minSupported) < 0;
      await chrome.storage.local.set({ updateInfo });
    }
  }
  await applyBadge();
}
