#!/usr/bin/env node
// Skrip rilis AdStash. Butuh Node 20.19+ / 22+.
//
//   node tools/release.mjs 1.3.0 [--important] [--min-supported 1.1.0]
//        → cek changelog, set versi di manifest, bangun dist/AdStash-v1.3.0.zip,
//          tulis dist/version.json (BELUM dipublikasikan).
//   node tools/release.mjs --publish-json
//        → salin dist/version.json ke update/version.json. Jalankan HANYA setelah
//          zip sudah diunggah ke GitHub Release (kalau tidak, pengguna melihat
//          "update tersedia" tapi unduhannya belum ada).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const dist = path.join(root, 'dist');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

if (flag('--publish-json')) {
  const src = path.join(dist, 'version.json');
  if (!fs.existsSync(src)) die('dist/version.json belum ada. Jalankan rilis dulu.');
  fs.mkdirSync(path.join(root, 'update'), { recursive: true });
  fs.copyFileSync(src, path.join(root, 'update', 'version.json'));
  console.log('✓ update/version.json diperbarui. Commit & push file ini untuk memberi tahu pengguna.');
  process.exit(0);
}

const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!version) die('Pakai: node tools/release.mjs <x.y.z> [--important] [--min-supported x.y.z]');

const imp = (p) => import(pathToFileURL(path.join(root, p)).href + '?t=' + Date.now());
const { CHANGELOG } = await imp('src/shared/changelog.js');
const cfgSrc = fs.readFileSync(path.join(root, 'src/shared/config.js'), 'utf8');
const REPO = (cfgSrc.match(/export const REPO = '([^']+)'/) || [])[1];
if (!REPO || REPO.startsWith('OWNER/')) die('Isi REPO di src/shared/config.js dulu (mis. fauzanfadli/adstash).');

const entry = CHANGELOG.find((c) => c.version === version);
if (!entry) die(`Tambahkan entri ${version} di src/shared/changelog.js sebelum rilis.`);

const manPath = path.join(root, 'manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const prev = man.version;
man.version = version;
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');

// --- bangun zip (root folder "adstash/" supaya "timpa folder lama" jelas) ---
const { makeZip } = await imp('src/shared/zip.js');
const EXCLUDE = new Set(['.git', 'node_modules', 'dist', 'tools', 'docs', 'update', 'test', '.github']);
const files = [];
(function walk(dir, rel = '') {
  for (const n of fs.readdirSync(dir)) {
    if (!rel && EXCLUDE.has(n)) continue;
    if (n.endsWith('.zip') || n === '.DS_Store') continue;
    const full = path.join(dir, n);
    const r = rel ? rel + '/' + n : n;
    if (fs.statSync(full).isDirectory()) walk(full, r);
    else files.push({ name: 'adstash/' + r, blob: new Blob([fs.readFileSync(full)]) });
  }
})(root);
const zipBlob = await makeZip(files);
const buf = Buffer.from(await zipBlob.arrayBuffer());
fs.mkdirSync(dist, { recursive: true });
const zipName = `AdStash-v${version}.zip`;
fs.writeFileSync(path.join(dist, zipName), buf);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const info = {
  latest: version,
  released: entry.date,
  severity: flag('--important') ? 'important' : 'normal',
  ...(opt('--min-supported') ? { minSupported: opt('--min-supported') } : {}),
  download: `https://github.com/${REPO}/releases/download/v${version}/${zipName}`,
  page: `https://github.com/${REPO}/releases/tag/v${version}`,
  sha256,
  size: buf.length,
  changelog: entry.notes
};
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify(info, null, 2) + '\n');

console.log(`✓ manifest ${prev} → ${version}`);
console.log(`✓ dist/${zipName}  (${(buf.length / 1024).toFixed(0)} KB, ${files.length} file)`);
console.log(`✓ sha256 ${sha256}`);
console.log(`
Langkah berikut (URUTAN PENTING):
  1. git add -A && git commit -m "release v${version}" && git push
  2. git tag v${version} && git push origin v${version}
  3. Buat GitHub Release v${version}, unggah dist/${zipName}
       (gh release create v${version} dist/${zipName} --title "AdStash ${version}" --notes-file <catatan>)
  4. node tools/release.mjs --publish-json   ← baru sekarang pengguna diberi tahu
  5. git add update/version.json && git commit -m "announce v${version}" && git push`);
