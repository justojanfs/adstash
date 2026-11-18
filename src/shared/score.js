// Skor "potensi winning" — dihitung saat ditampilkan, tidak disimpan,
// supaya perubahan aturan langsung berlaku ke semua iklan.

export const DEFAULT_RULES = {
  daysHigh: 30, // tayang >= 30 hari  → +40
  daysMid: 14,  // >= 14 hari         → +25
  daysLow: 7,   // >= 7 hari          → +10
  activeBonus: 15,
  varHigh: 5,   // >= 5 variasi       → +25
  varMid: 2,    // >= 2 variasi       → +12
  engHigh: 1000, // total engagement  → +15
  engMid: 100,   //                   → +8
  growthPct: 20, // naik >= 20% antar snapshot → +5
  labelHigh: 60,
  labelMid: 35
};

export const LABEL = {
  high: { text: 'Potensi tinggi', short: 'Tinggi' },
  mid: { text: 'Potensi sedang', short: 'Sedang' },
  low: { text: 'Potensi rendah', short: 'Rendah' },
  unknown: { text: 'Data belum cukup', short: '—' }
};

const DAY = 86400000;

export function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Umur iklan dalam hari, atau null jika tanggal mulai tidak diketahui. */
export function adAgeDays(ad, now = Date.now()) {
  const intel = ad.intel || {};
  const start = parseISODate(intel.startDate);
  if (!start) return null;
  const end = intel.active === false && parseISODate(intel.endDate) ? parseISODate(intel.endDate) : new Date(now);
  return Math.max(0, Math.floor((end - start) / DAY) + 1);
}

export function engagementTotal(s) {
  if (!s) return null;
  const vals = ['likes', 'comments', 'shares', 'saves'].map((k) => s[k]).filter((v) => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export function latestStats(ad) {
  const st = ad.stats || [];
  return st.length ? st[st.length - 1] : null;
}

export function engagementGrowth(ad) {
  const st = (ad.stats || []).filter((s) => engagementTotal(s) != null);
  if (st.length < 2) return null;
  const a = engagementTotal(st[0]);
  const b = engagementTotal(st[st.length - 1]);
  if (!a) return null;
  return Math.round(((b - a) / a) * 100);
}

const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' jt' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' rb' : String(n);

export const CONF_LABEL = { high: 'tinggi', mid: 'sedang', low: 'rendah' };

/**
 * Skor = poin didapat ÷ poin maksimal dari sinyal yang TERSEDIA × 100,
 * lalu diperkecil (maks. 40%) bila cakupan sinyalnya sedikit.
 * Jadi iklan TikTok (tanpa data umur) tetap bisa dinilai adil, tapi
 * "keyakinan" ikut turun bila sinyalnya sedikit — dan label "Tinggi"
 * tidak diberikan kalau keyakinannya rendah.
 */
export function computeScore(ad, rules = DEFAULT_RULES, now = Date.now()) {
  const r = { ...DEFAULT_RULES, ...(rules || {}) };
  const intel = ad.intel || {};
  const reasons = [];
  let pts = 0;
  let max = 0;
  const add = (got, outOf, text) => { pts += got; max += outOf; reasons.push({ pts: got, max: outOf, text }); };

  const days = adAgeDays(ad, now);
  if (days != null) {
    const got = days >= r.daysHigh ? 40 : days >= r.daysMid ? 25 : days >= r.daysLow ? 10 : 0;
    add(got, 40, `Tayang ${days} hari${intel.active === false ? ' (sudah berhenti)' : ''}`);
  }
  if (intel.active === true) add(r.activeBonus, r.activeBonus, 'Masih aktif saat terakhir dicek');
  else if (intel.active === false) add(0, r.activeBonus, 'Sudah tidak aktif');

  if (typeof intel.variations === 'number' && intel.variations > 0) {
    const got = intel.variations >= r.varHigh ? 25 : intel.variations >= r.varMid ? 12 : 0;
    add(got, 25, `${intel.variations} variasi iklan memakai materi ini`);
  }

  const eng = engagementTotal(latestStats(ad));
  if (eng != null) {
    const got = eng >= r.engHigh ? 15 : eng >= r.engMid ? 8 : 0;
    add(got, 15, `Engagement ${fmtN(eng)} (like + komentar + share + simpan)`);
  }
  const growth = engagementGrowth(ad);
  if (growth != null) {
    add(growth >= r.growthPct ? 5 : 0, 5, `Engagement ${growth >= 0 ? 'naik' : 'turun'} ${Math.abs(growth)}% sejak pertama dicatat`);
  }

  const cc = intel.cc || {};
  if (cc.ctr) {
    const m = String(cc.ctr).match(/(\d+(?:[.,]\d+)?)\s*%/);
    const top = /top/i.test(cc.ctr) && m ? parseFloat(m[1].replace(',', '.')) : null;
    add(top != null ? (top <= 10 ? 10 : top <= 30 ? 5 : 0) : 0, 10, `CTR ${cc.ctr} (Creative Center)`);
  }
  if (cc.budget) add(/high|tinggi/i.test(cc.budget) ? 5 : 0, 5, `Budget ${cc.budget} (Creative Center)`);

  if (!max) return { score: 0, label: 'unknown', conf: null, reasons, days, eng, growth, pts, max };
  // Diperkecil bila sinyalnya sedikit: 100% dari 20 poin ≠ 100% dari 95 poin
  const full = 40 + r.activeBonus + 25 + 15;
  const coverage = Math.min(1, max / full);
  const score = Math.round((pts / max) * 100 * (0.6 + 0.4 * coverage));
  const conf = max >= 60 ? 'high' : max >= 30 ? 'mid' : 'low';
  let label = score >= r.labelHigh ? 'high' : score >= r.labelMid ? 'mid' : 'low';
  if (label === 'high' && conf === 'low') label = 'mid';
  return { score, label, conf, reasons, days, eng, growth, pts, max };
}
