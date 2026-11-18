# AdStash — Distribusi & Update

Mekanisme untuk membagikan AdStash ke banyak orang (publik, gratis, lewat GitHub) dan memastikan pembaruan sampai ke pengguna.

## Gambaran

```
Kamu (publisher)                         GitHub (repo publik)                    Pengguna
─────────────────                        ─────────────────────                   ─────────────────────
node tools/release.mjs 1.4.0  ─ push ──▶ Release v1.4.0 + AdStash-v1.4.0.zip
                              ─ push ──▶ update/version.json   ◀── cek tiap ±6 jam ── ekstensi
                              ─ push ──▶ update/remote-config.json ◀─ (juga)          │
                                                                                      ▼
                                                              banner "AdStash 1.4.0 tersedia" + changelog
                                                              → unduh zip → timpa folder → Muat ulang ekstensi
                                                              → migrasi data otomatis (+ snapshot pengaman)
```

Tiga jalur pembaruan, dengan kecepatan dan biaya berbeda:

| Jalur | Isi | Butuh pengguna? | Kapan dipakai |
|---|---|---|---|
| **Remote config** (`update/remote-config.json`) | Daftar kata label Ad Library / Creative Center, rekomendasi aturan skor, pengumuman | Tidak, masuk otomatis | Situs mengubah teks/label dan parsing meleset |
| **Notifikasi versi** (`update/version.json`) | Info versi baru + changelog + tautan unduh | Ya: unduh, timpa folder, muat ulang | Kode berubah (fitur, perbaikan) |
| **Store** (opsional, nanti) | Zip yang sama diunggah ke Chrome Web Store / Edge Add-ons | Tidak, otomatis | Saat sudah stabil dan ingin update otomatis |

## Setup sekali jalan

1. Buat repo GitHub **publik**, mis. `fauzanfadli/adstash`. Taruh seluruh folder `adstash/` di dalamnya (folder `update/` ikut).
2. Buka `src/shared/config.js`, ganti `REPO = 'OWNER/REPO'` dengan repo-mu. Selama masih `OWNER/REPO`, pengecekan update dimatikan otomatis.
3. Ganti juga `OWNER/REPO` di `update/version.json` (atau biarkan; file itu ditimpa skrip rilis).
4. Push. Pengecekan membaca `https://raw.githubusercontent.com/<REPO>/main/update/*.json` (cache GitHub ±5 menit).

## Alur rilis (urutan penting)

1. Ubah kode. Tambahkan entri di `src/shared/changelog.js` (versi, tanggal, catatan). Entri ini juga tampil offline di pengguna setelah update.
2. `node tools/release.mjs 1.4.0` — memeriksa changelog, mengisi versi di `manifest.json`, membangun `dist/AdStash-v1.4.0.zip`, dan menulis `dist/version.json` (**belum** dipublikasikan). Opsi: `--important` (banner tidak bisa dilewati), `--min-supported 1.2.0` (versi di bawahnya ditandai tidak didukung).
3. Commit & push kode. Buat tag `v1.4.0` dan **GitHub Release**; unggah `dist/AdStash-v1.4.0.zip`.
4. `node tools/release.mjs --publish-json`, lalu commit & push `update/version.json`. **Baru langkah ini yang membuat pengguna melihat banner.** Jangan dibalik: kalau banner muncul sebelum zip tersedia, tombol Unduh mengarah ke 404.

Butuh Node 20.19+ atau 22+.

## Remote config: aturan main

`update/remote-config.json` hanya berisi **data**, bukan kode (MV3 melarang kode jarak jauh, dan itu juga pengaman kalau repo disusupi).

```json
{
  "schema": 1,
  "rev": "2026-12-03.1",
  "requires": "1.3.0",
  "labels": {
    "libraryId": ["Library ID", "Kode Iklan"],
    "startedRunning": ["started running on", "dimulai pada"],
    "cc": { "likes": ["likes", "suka"], "ctr": ["ctr"] }
  },
  "winRules": { "labelHigh": 55 },
  "announce": { "id": "n1", "text": "Teks pengumuman singkat", "url": "https://github.com/..." }
}
```

- Daftar kata **ditambahkan** ke kata bawaan (tidak menggantikan), di-escape, maksimal 40 kata × 60 karakter. Kunci tidak dikenal dibuang.
- `requires`: config diabaikan oleh ekstensi yang lebih lama dari versi itu (tampil sebagai catatan, bukan error). Pakai saat config butuh perilaku kode baru.
- `winRules` = rekomendasi default. Pengguna yang pernah mengubah aturan skor sendiri **tidak** ditimpa; tombol "Kembalikan default" mengikuti rekomendasi terbaru.
- Kunci label yang tersedia: `libraryId`, `startedRunning`, `active`, `inactive`, `variationsUse`, `cta`, dan `cc.{likes,comments,shares,ctr,budget,objective,industry,region}`.
- Selector DOM Facebook/Instagram/TikTok **tidak** bisa diubah lewat remote config; itu tetap lewat rilis versi baru.
- Naikkan `rev` setiap mengubah file supaya mudah dilacak di Pengaturan → Pembaruan.

## Migrasi data

- Struktur data punya nomor skema sendiri (`SCHEMA_VERSION` di `src/shared/config.js`), terpisah dari versi ekstensi.
- Bentuk data berubah → naikkan `SCHEMA_VERSION` dan tambahkan langkah di `src/shared/migrate.js` (idempoten, aditif, jangan hapus data pengguna).
- Sebelum langkah pertama, metadata semua iklan disalin ke **snapshot** (satu, yang terbaru). Kalau migrasi gagal: berhenti, data lama tidak disentuh, banner merah muncul, dan pengguna bisa memulihkan lewat Pengaturan → Pembaruan.
- Kalau pengguna memasang versi lama di atas data versi lebih baru, ekstensi tidak menurunkan skema dan menampilkan peringatan.
- Mengubah struktur IndexedDB (`DB_VERSION` di `db.js`) lebih berisiko daripada mengubah isi data. Hindari kecuali perlu; kalau perlu, uji dari data v1.2.

## Teks untuk halaman rilis / README publik

> **Pasang AdStash (Chrome / Edge)**
> 1. Unduh `AdStash-vX.Y.Z.zip` dari Releases, ekstrak ke folder **tetap** (mis. `Dokumen/AdStash`). Jangan dipindah atau dihapus.
> 2. Buka `chrome://extensions` (Edge: `edge://extensions`), aktifkan **Developer mode**, klik **Load unpacked**, pilih folder `adstash`.
> 3. Pin ikon AdStash di toolbar.
>
> **Update:** saat ada versi baru, AdStash menampilkan banner. Unduh zip baru, ekstrak dan **timpa isi folder yang sama**, lalu klik "Muat ulang ekstensi". Data iklanmu tersimpan di browser dan tidak ikut terhapus. Ekspor backup dulu untuk berjaga-jaga.

## Keterbatasan yang perlu dipahami

- **Pasang manual = ada gesekan.** Chrome/Edge menampilkan peringatan "ekstensi mode pengembang" saat browser dibuka, dan pengguna harus mengganti folder sendiri tiap update. Tingkat update akan lebih rendah daripada lewat store. Karena itu remote config dibuat sebagai jalur cepat yang tidak butuh aksi pengguna.
- **Tidak ada auto-update tanpa store.** `update_url` mandiri hanya berfungsi untuk perangkat yang dikelola kebijakan organisasi (Windows/Mac). Itu batas browser, bukan sesuatu yang bisa diakali dari ekstensi.
- **Migrasi ke store nanti tanpa ubah kode:** unggah zip yang sama. Ekstensi mendeteksi `update_url` dari store dan otomatis mematikan banner versi manual (remote config tetap jalan). Peninjauan store untuk ekstensi yang membaca Facebook/Instagram/TikTok bisa ketat; siapkan penjelasan penggunaan izin dan kebijakan privasi.
- **Privasi:** pengecekan hanya mengunduh dua file JSON publik; tidak ada data iklan atau data pengguna yang dikirim. GitHub tetap melihat alamat IP pengguna. Pengguna bisa mematikannya di Pengaturan → Pembaruan.
- **Integritas unduhan:** `version.json` memuat SHA-256 zip dan ditampilkan di modal update. Akses tulis ke repo = kemampuan mengubah apa yang dilihat semua pengguna; aktifkan 2FA di akun GitHub-mu.
