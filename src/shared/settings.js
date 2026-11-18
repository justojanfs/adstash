// Pengaturan kecil disimpan di chrome.storage.local (bukan IndexedDB)
import { DEFAULT_RULES } from './score.js';
export const DEFAULT_CATEGORIES = [
  'F&B',
  'Fashion',
  'Kecantikan & Skincare',
  'Kesehatan & Suplemen',
  'Pertanian',
  'Elektronik & Gadget',
  'Edukasi & Kursus',
  'Jasa',
  'Properti',
  'Otomotif',
  'Lainnya'
];

export const DEFAULT_SETTINGS = {
  categories: DEFAULT_CATEGORIES,
  enabled: { facebook: true, instagram: true, tiktok: true },
  lastCategory: '',
  view: 'grid',
  winRules: DEFAULT_RULES,
  winRulesCustom: false, // true bila pengguna mengubah aturan sendiri (remote tidak menimpa)
  updates: { check: true, remote: true }
};

export async function getSettings() {
  const { settings, remoteConfig } = await chrome.storage.local.get(['settings', 'remoteConfig']);
  const st = settings || {};
  const updates = { ...DEFAULT_SETTINGS.updates, ...(st.updates || {}) };
  // Aturan efektif: milik pengguna bila pernah diubah; kalau tidak, default + rekomendasi remote.
  const winRules = st.winRulesCustom
    ? { ...DEFAULT_RULES, ...(st.winRules || {}) }
    : { ...DEFAULT_RULES, ...((updates.remote && remoteConfig && remoteConfig.winRules) || {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...st,
    enabled: { ...DEFAULT_SETTINGS.enabled, ...(st.enabled || {}) },
    updates,
    winRules
  };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const PLATFORM_LABEL = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  other: 'Lainnya'
};

export const SOURCE_LABEL = {
  feed: 'Feed',
  meta_library: 'Meta Ad Library',
  tiktok_cc: 'TikTok Creative Center'
};
