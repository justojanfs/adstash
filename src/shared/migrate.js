// Migrasi data antar versi. Aturan:
//  - langkah bersifat idempoten & aditif (jangan menghapus data pengguna),
//  - snapshot metadata iklan disimpan SEBELUM langkah pertama,
//  - bila gagal: berhenti, simpan error, data lama tetap ada + bisa dipulihkan dari snapshot.
import { getAllAds, putAd } from './db.js';
import { SCHEMA_VERSION } from './config.js';
import { DEFAULT_RULES } from './score.js';

const MIGRATIONS = [
  {
    to: 2,
    name: 'v1.3: tandai aturan skor kustom + rapikan metadata iklan',
    async up() {
      const { settings } = await chrome.storage.local.get('settings');
      if (settings && settings.winRulesCustom === undefined) {
        const w = settings.winRules || {};
        const custom = Object.keys(DEFAULT_RULES).some((k) => w[k] !== undefined && w[k] !== DEFAULT_RULES[k]);
        await chrome.storage.local.set({ settings: { ...settings, winRulesCustom: custom } });
      }
      for (const ad of await getAllAds()) {
        let ch = false;
        if (!ad.updatedAt) { ad.updatedAt = ad.savedAt || Date.now(); ch = true; }
        if (!Array.isArray(ad.tags)) { ad.tags = []; ch = true; }
        if (ch) await putAd(ad);
      }
    }
  }
];

let running = null;
export function ensureMigrated() {
  if (!running) running = run().catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  return running;
}

async function run() {
  const st = await chrome.storage.local.get(['schemaVersion']);
  const cur = Number.isInteger(st.schemaVersion) ? st.schemaVersion : 1; // v1.0–1.2 belum menulis versi skema
  if (cur > SCHEMA_VERSION) {
    await chrome.storage.local.set({ schemaAhead: { found: cur, supported: SCHEMA_VERSION, at: Date.now() } });
    return { ok: true, ahead: true };
  }
  await chrome.storage.local.remove('schemaAhead');
  const todo = MIGRATIONS.filter((m) => m.to > cur).sort((a, b) => a.to - b.to);
  if (!todo.length) {
    if (st.schemaVersion !== SCHEMA_VERSION) await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION });
    return { ok: true, ran: 0 };
  }
  const ads = await getAllAds();
  if (ads.length) {
    await chrome.storage.local.set({
      preMigrationSnapshot: { from: cur, to: SCHEMA_VERSION, at: Date.now(), appVersion: chrome.runtime.getManifest().version, ads }
    });
  }
  for (const m of todo) {
    try {
      await m.up();
      await chrome.storage.local.set({ schemaVersion: m.to });
    } catch (e) {
      await chrome.storage.local.set({ migrationError: { step: m.to, name: m.name, message: String(e && e.message || e), at: Date.now() } });
      return { ok: false, step: m.to, error: String(e && e.message || e) };
    }
  }
  await chrome.storage.local.remove('migrationError');
  return { ok: true, ran: todo.length };
}

// Pulihkan metadata iklan dari snapshot (media tidak disentuh). Dipakai hanya bila migrasi bermasalah.
export async function restoreSnapshot() {
  const { preMigrationSnapshot: snap } = await chrome.storage.local.get('preMigrationSnapshot');
  if (!snap || !Array.isArray(snap.ads)) return { ok: false, error: 'Tidak ada snapshot.' };
  for (const ad of snap.ads) await putAd(ad);
  await chrome.storage.local.remove('migrationError');
  return { ok: true, restored: snap.ads.length, at: snap.at };
}
