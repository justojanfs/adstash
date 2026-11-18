// Konfigurasi distribusi. SATU-SATUNYA tempat yang perlu diisi sebelum rilis publik.
// REPO = repo GitHub PUBLIK tempat folder /update/ dan file zip rilis di-host.
export const REPO = 'justojanfs/adstash';
export const BRANCH = 'main';

export const UPDATE_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/update/`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

// Tautan unduhan/changelog dari version.json hanya boleh mengarah ke host ini.
export const ALLOWED_LINK_HOSTS = ['github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'];

export const CHECK_EVERY_MIN = 360;   // cek tiap 6 jam
export const MIN_GAP_MS = 5 * 3600e3; // tidak cek ulang kalau terakhir <5 jam (kecuali manual)

// Versi struktur data lokal (bukan versi ekstensi). Naikkan saat bentuk data berubah
// dan tambahkan langkahnya di migrate.js.
export const SCHEMA_VERSION = 2;

export const isPlaceholderRepo = () => REPO.startsWith('OWNER/');
