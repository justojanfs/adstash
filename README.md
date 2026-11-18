# AdStash — Ad Library Pribadi

Ekstensi Chrome & Microsoft Edge untuk menyimpan iklan dari Facebook, Instagram, dan TikTok: gambar/video, caption, akun pengiklan, kategori, tag, catatan, link postingan, landing page, CTA, rating, dan favorit. Semua data tersimpan **lokal di browser** (tidak dikirim ke server mana pun).

## Pasang (load unpacked)

1. Ekstrak zip ini ke folder permanen (mis. `Documents/AdStash`). **Jangan hapus foldernya** setelah dipasang.
2. Buka `chrome://extensions` (Chrome) atau `edge://extensions` (Edge).
3. Aktifkan **Developer mode**.
4. Klik **Load unpacked** lalu pilih folder `adstash` (folder yang berisi `manifest.json`).
5. Pin ikon AdStash di toolbar. **Muat ulang** tab FB/IG/TikTok yang sudah terbuka.

## Cara pakai

- **Simpan:** arahkan kursor ke postingan → klik tombol oranye **Simpan** → cek isian → **Simpan** (atau `Ctrl+Enter`).
- **Alternatif:** klik kanan pada postingan → *Simpan postingan ini ke AdStash*, atau shortcut `Alt+Shift+S`.
- **Video FB/IG:** biasanya berupa streaming sehingga tidak bisa diunduh langsung. Klik **Rekam**: video diputar dari awal dan direkam sampai selesai. Biarkan tab tetap terbuka selama perekaman. Tanpa rekaman, yang tersimpan hanya thumbnail dan link.
- **Library:** klik ikon AdStash → **Buka Library**. Ada pencarian (`/`), filter platform/kategori/jenis media/favorit, urutan, edit langsung (tersimpan otomatis), salin caption, unduh media, dan hapus.
- **Backup:** Library → Pengaturan → **Ekspor backup (.zip)**. Impor di browser lain untuk memindahkan data. Iklan yang sudah ada dilewati, tidak diduplikasi.

## Sinyal winning (v1.1)

Setiap iklan punya **skor potensi winning 0–100** beserta tingkat keyakinannya. Skornya dihitung dari:

| Sinyal | Sumber | Poin maks |
|---|---|---|
| Umur iklan (tanggal mulai → sekarang/berhenti) | Meta Ad Library atau isi manual | 40 |
| Masih aktif | Meta Ad Library | 15 |
| Jumlah variasi ("X iklan menggunakan materi ini") | Meta Ad Library | 25 |
| Engagement (like + komentar + share + simpan) | Feed / Creative Center | 15 |
| Pertumbuhan engagement antar-catatan | Tombol "Perbarui stats" | 5 |
| CTR & budget | TikTok Creative Center | 10 + 5 |

Skor = poin yang didapat ÷ poin maksimal dari sinyal yang tersedia, lalu diperkecil kalau sinyalnya sedikit. Tanpa data umur dan variasi, label tertinggi yang bisa didapat adalah "Sedang?" (keyakinan rendah). Semua ambang batas bisa diubah di **Pengaturan → Aturan skor winning**.

**Cara melengkapi datanya:**
- **Meta Ad Library** (facebook.com/ads/library): tombol Simpan juga muncul di setiap kartu iklan dan otomatis mengambil tanggal mulai, status, variasi, dan ID Library. Kalau iklan yang sama sudah tersimpan dari feed, AdStash menawarkan untuk **menggabungkan** datanya, bukan membuat duplikat.
- Dari detail iklan di Library: **"Cek di Ad Library"** membuka pencarian berdasarkan nama pengiklan. Setelah ID Library-nya tersimpan, tombol ini berubah menjadi **"Perbarui dari Ad Library"**, yang mengecek ulang status aktif di tab latar.
- **"Perbarui stats"** membuka postingan di tab latar, mencatat angka terbaru, lalu menutup tab itu lagi. Grafik kecil di panel menampilkan pertumbuhannya.
- **TikTok Creative Center** (ads.tiktok.com/business/creativecenter): tombol Simpan di kartu Top Ads mengambil like, CTR, budget, tujuan, dan industri.
- Filter **Semua potensi** dan urutan **Skor winning / Tayang paling lama / Engagement tertinggi** tersedia di Library.

## v1.2: perbaikan "sudah tersimpan" & pilihan tampilan

**Pencocokan iklan yang sama (diperbaiki).** Sebelumnya iklan dari pengiklan yang sama dengan caption mirip dianggap iklan yang sama, walaupun visualnya berbeda, dan datanya ikut tertimpa. Aturannya sekarang:
- ID Ad Library berbeda → **pasti iklan berbeda**. Ini juga dijaga di background, jadi tidak mungkin tergabung.
- ID Ad Library atau link postingan sama → iklan sama.
- Visual dibandingkan lewat sidik jari gambar (struktur + warna). **Kalau visualnya beda, iklan tidak akan disarankan untuk digabung**, semirip apa pun caption-nya.
- Kotak "perbarui iklan tersimpan" hanya **otomatis tercentang** kalau buktinya kuat: ID atau link sama, atau visual dan caption sama-sama cocok. Kalau buktinya lemah, kotaknya tidak tercentang dan ditampilkan dengan warna kuning.
- Banner menampilkan **thumbnail iklan tersimpan di samping iklan sekarang** supaya bisa kamu bandingkan sendiri.
- Setiap penggabungan menyimpan riwayat. Di panel Sinyal winning ada tombol **"Batalkan penggabungan ini"** untuk mengembalikan data sebelumnya.

**Tampilan Library:** tombol di kanan atas daftar untuk memilih **Grid**, **Grid ringkas** (kartu kecil, fokus ke visual), atau **Daftar** (tabel). Di tampilan Daftar, klik judul kolom Pengiklan, Skor, Umur, Engagement, atau Disimpan untuk mengurutkan. Klik "Disimpan" sekali lagi untuk membalik urutan. Tampilan terakhir yang kamu pakai diingat.

## Batasan yang perlu diketahui

- Kalau iklan yang sama tampil dengan crop berbeda (misalnya 4:5 di feed dan 1:1 di Ad Library), sidik jari visualnya bisa dianggap berbeda. Akibatnya iklan itu tersimpan sebagai entri baru, bukan digabung. Ini sengaja: lebih aman ada duplikat daripada data tertimpa.

- Engagement iklan bisa tinggi hanya karena budget besar. Jadikan umur iklan dan jumlah variasi sebagai patokan utama.
- Pembacaan halaman Meta Ad Library dan TikTok Creative Center dibuat berdasarkan teks label ("Library ID", "Started running on", "CTR", dan seterusnya, dalam bahasa Inggris maupun Indonesia). Kalau label di sana berubah, perbaiki fungsi `libraryIntel` atau `ccMetrics` di `content.js`.

- FB/IG/TikTok sering mengubah struktur halaman. Kalau isian otomatis (nama pengiklan, caption) kosong atau salah, isi atau koreksi manual di form. Media tetap bisa disimpan.
- Carousel: hanya slide yang sudah dimuat halaman yang ikut terdeteksi. Geser semua slide dulu sebelum klik Simpan.
- Hasil rekaman berformat `.webm`. Kalau rekaman tidak bersuara, nyalakan suara video lalu rekam ulang.
- Data hilang jika ekstensi di-*uninstall* atau data browser dihapus. Ekspor backup secara berkala.

## Struktur kode

```
manifest.json            Manifest V3
src/background.js        Service worker: context menu, shortcut, penerimaan & pengunduhan media, thumbnail
src/content/content.js   Tombol Simpan, ekstraksi FB/IG/TikTok, modal simpan, perekam video (Shadow DOM)
src/library/*            Halaman library: grid, filter, detail/edit, pengaturan, backup
src/popup/*              Popup toolbar
src/shared/db.js         IndexedDB (ads + blobs)
src/shared/settings.js   Kategori & pengaturan (chrome.storage.local)
src/shared/zip.js        ZIP writer/reader untuk backup
```

Kalau ekstraksi di salah satu platform rusak setelah update, perbaiki selector di fungsi `extractFacebook`, `extractInstagram`, atau `extractTikTok` di `content.js`.

## Distribusi & update (v1.3)

Mekanisme membagikan AdStash ke banyak orang dan menyampaikan pembaruan ada di **[docs/DISTRIBUSI.md](docs/DISTRIBUSI.md)**: notifikasi versi baru + changelog, remote config untuk label parsing & aturan skor, migrasi data berversi dengan snapshot pengaman, dan skrip rilis `tools/release.mjs`.

Sebelum rilis publik, isi `REPO` di `src/shared/config.js`.
