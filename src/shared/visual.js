// Sidik jari visual (perceptual hash) untuk membedakan kreatif iklan.
// - d: dHash 16×16 (256 bit) → struktur/komposisi gambar
// - c: warna rata-rata grid 4×4 (48 byte) → menangkap beda warna produk/latar
// Dua iklan dianggap visualnya sama hanya jika KEDUANYA dekat.

export const VISUAL_VERSION = 1;
const D_MAX = 26;      // ≈10% dari 256 bit
const C_MAX = 22;      // rata-rata selisih per kanal warna (0–255)

async function pixels(blob, w, h) {
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h).data;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));

export async function visualSignature(blob) {
  try {
    const p = await pixels(blob, 17, 16);
    const gray = new Float32Array(17 * 16);
    for (let i = 0; i < gray.length; i++) gray[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
    const bits = new Uint8Array(32);
    let k = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++, k++) {
        if (gray[y * 17 + x] < gray[y * 17 + x + 1]) bits[k >> 3] |= 1 << (k & 7);
      }
    }
    const c = await pixels(blob, 4, 4);
    const rgb = new Uint8Array(48);
    for (let i = 0; i < 16; i++) { rgb[i * 3] = c[i * 4]; rgb[i * 3 + 1] = c[i * 4 + 1]; rgb[i * 3 + 2] = c[i * 4 + 2]; }
    return { v: VISUAL_VERSION, d: toHex(bits), c: toHex(rgb) };
  } catch {
    return null;
  }
}

export function compareVisual(a, b) {
  if (!a || !b || a.v !== b.v) return null;
  const da = fromHex(a.d);
  const db = fromHex(b.d);
  let dist = 0;
  for (let i = 0; i < da.length; i++) {
    let x = da[i] ^ db[i];
    while (x) { dist += x & 1; x >>= 1; }
  }
  const ca = fromHex(a.c);
  const cb = fromHex(b.c);
  let sum = 0;
  for (let i = 0; i < ca.length; i++) sum += Math.abs(ca[i] - cb[i]);
  const colorDiff = Math.round(sum / ca.length);
  return { dist, colorDiff, same: dist <= D_MAX && colorDiff <= C_MAX };
}
