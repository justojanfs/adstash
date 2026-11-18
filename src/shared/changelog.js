// Catatan perubahan yang ikut terpasang di ekstensi (tampil setelah update, tanpa internet).
// Entri terbaru di atas. Skrip tools/release.mjs memakai entri ini untuk update/version.json.
export const CHANGELOG = [
  {
    version: '1.3.2',
    date: '2026-11-18',
    notes: [
      'Perbaikan: nama akun pengiklan Instagram kini terbaca di lebih banyak tampilan (tanpa header, tautan berparameter, hanya foto profil)',
      'Pesan error pengecekan update lebih jelas'
    ]
  },
  {
    version: '1.3.1',
    date: '2026-11-18',
    notes: [
      'Rilis uji alur pembaruan (tanpa perubahan fitur)',
      'Jika banner ini muncul, mekanisme update berfungsi'
    ]
  },
  {
    version: '1.3.0',
    date: '2026-11-18',
    notes: [
      'Notifikasi versi baru + changelog di dalam ekstensi',
      'Aturan baca Ad Library & Creative Center bisa diperbarui tanpa menunggu versi baru (remote config)',
      'Migrasi data otomatis antar versi dengan snapshot pengaman'
    ]
  },
  {
    version: '1.2.0',
    date: '2026-11-17',
    notes: [
      'Perbaikan: iklan beda visual tidak lagi dianggap sama dan menimpa data',
      'Tampilan Library: Grid, Grid ringkas, Daftar',
      'Penggabungan bisa dibatalkan'
    ]
  }
];
