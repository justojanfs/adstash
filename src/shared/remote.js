// Validasi remote config & info versi. HANYA DATA (teks/angka), tidak pernah kode:
// MV3 melarang kode jarak jauh, dan data tak tepercaya tidak boleh jadi regex mentah.
import { parseVer, cmpVer } from './semver.js';
import { ALLOWED_LINK_HOSTS } from './config.js';
import { DEFAULT_RULES } from './score.js';

export const LABEL_KEYS = ['libraryId', 'startedRunning', 'active', 'inactive', 'variationsUse', 'cta'];
export const CC_KEYS = ['likes', 'comments', 'shares', 'ctr', 'budget', 'objective', 'industry', 'region'];

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
function wordList(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const w of v.slice(0, 40)) {
    const s = str(w, 60);
    if (s.length >= 2) out.push(s);
  }
  return out.length ? out : null;
}

export function safeLink(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && ALLOWED_LINK_HOSTS.includes(x.hostname) ? x.href : '';
  } catch { return ''; }
}

export function validateVersionInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!parseVer(raw.latest)) return null;
  const notes = Array.isArray(raw.changelog) ? raw.changelog.slice(0, 12).map((x) => str(x, 220)).filter(Boolean) : [];
  return {
    latest: String(raw.latest).replace(/^v/, ''),
    minSupported: parseVer(raw.minSupported) ? String(raw.minSupported).replace(/^v/, '') : '',
    released: str(raw.released, 20),
    severity: raw.severity === 'important' ? 'important' : 'normal',
    download: safeLink(raw.download),
    page: safeLink(raw.page),
    sha256: /^[a-f0-9]{64}$/i.test(raw.sha256 || '') ? raw.sha256.toLowerCase() : '',
    size: Number.isFinite(raw.size) ? raw.size : 0,
    changelog: notes,
    announce: raw.announce && typeof raw.announce === 'object'
      ? { id: str(raw.announce.id, 40), text: str(raw.announce.text, 240), url: safeLink(raw.announce.url) }
      : null
  };
}

// Mengembalikan config bersih, atau null bila tak valid / butuh versi ekstensi lebih baru.
export function validateRemoteConfig(raw, currentVersion) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 1) return null;
  if (raw.requires && parseVer(raw.requires) && cmpVer(raw.requires, currentVersion) > 0) return null;
  const labels = {};
  const rl = raw.labels && typeof raw.labels === 'object' ? raw.labels : {};
  for (const k of LABEL_KEYS) {
    const l = wordList(rl[k]);
    if (l) labels[k] = l;
  }
  const cc = {};
  const rcc = rl.cc && typeof rl.cc === 'object' ? rl.cc : {};
  for (const k of CC_KEYS) {
    const l = wordList(rcc[k]);
    if (l) cc[k] = l;
  }
  if (Object.keys(cc).length) labels.cc = cc;
  const winRules = {};
  if (raw.winRules && typeof raw.winRules === 'object') {
    for (const k of Object.keys(DEFAULT_RULES)) {
      const v = raw.winRules[k];
      if (Number.isFinite(v) && v >= 0 && v <= 1e7) winRules[k] = Math.round(v);
    }
  }
  return {
    rev: str(raw.rev, 40) || 'tanpa-rev',
    labels,
    winRules,
    announce: raw.announce && typeof raw.announce === 'object'
      ? { id: str(raw.announce.id, 40), text: str(raw.announce.text, 240), url: safeLink(raw.announce.url) }
      : null
  };
}
