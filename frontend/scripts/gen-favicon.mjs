// Generates the favicon set for the dashboard with no external deps —
// a white 3-bar bar-chart glyph on a Xero-blue (#13B5EA) background.
//
// Outputs into ../public:
//   favicon.svg, favicon-16x16.png, favicon-32x32.png,
//   apple-touch-icon.png (180), favicon.ico (embeds the 16 + 32 PNGs)
//
// Run from the frontend dir:  node scripts/gen-favicon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

const BG = [0x13, 0xb5, 0xea]; // #13B5EA Xero blue
const FG = [0xff, 0xff, 0xff]; // white

// --- pixel canvas: solid bg, then 3 bottom-aligned bars of rising height ---
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = BG[0];
    px[i * 4 + 1] = BG[1];
    px[i * 4 + 2] = BG[2];
    px[i * 4 + 3] = 0xff;
  }
  const pad = Math.round(size * 0.19);
  const inner = size - pad * 2;
  const gap = Math.max(1, Math.round(inner * 0.12));
  const barW = Math.max(1, Math.floor((inner - gap * 2) / 3));
  const used = barW * 3 + gap * 2;
  const x0 = pad + Math.floor((inner - used) / 2);
  const bottom = size - pad;
  const heights = [0.45, 0.72, 1.0].map((f) => Math.max(1, Math.round(inner * f)));
  const setPx = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    px[o] = FG[0];
    px[o + 1] = FG[1];
    px[o + 2] = FG[2];
    px[o + 3] = 0xff;
  };
  for (let b = 0; b < 3; b++) {
    const bx = x0 + b * (barW + gap);
    const top = bottom - heights[b];
    for (let y = top; y < bottom; y++) for (let x = bx; x < bx + barW; x++) setPx(x, y);
  }
  return px; // RGBA, row-major, top-to-bottom
}

// --- minimal PNG encoder (truecolour + alpha, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  // 10,11,12 = compression, filter, interlace = 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO that embeds PNG-compressed entries (supported by all current browsers) ---
function buildIco(entries /* [{size, png}] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size; // width  (0 == 256)
    dir[o + 1] = e.size >= 256 ? 0 : e.size; // height
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

// --- SVG (crisp at any size for modern browsers) ---
function svg() {
  // 32-unit viewBox, same geometry as the raster render at size 32
  const size = 32;
  const pad = Math.round(size * 0.19);
  const inner = size - pad * 2;
  const gap = Math.max(1, Math.round(inner * 0.12));
  const barW = Math.max(1, Math.floor((inner - gap * 2) / 3));
  const used = barW * 3 + gap * 2;
  const x0 = pad + Math.floor((inner - used) / 2);
  const bottom = size - pad;
  const heights = [0.45, 0.72, 1.0].map((f) => Math.max(1, Math.round(inner * f)));
  const rects = heights
    .map((h, b) => {
      const x = x0 + b * (barW + gap);
      return `<rect x="${x}" y="${bottom - h}" width="${barW}" height="${h}" rx="0.5" fill="#fff"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="6" fill="#13B5EA"/>${rects}</svg>\n`;
}

const png16 = encodePng(16, render(16));
const png32 = encodePng(32, render(32));
const png180 = encodePng(180, render(180));

writeFileSync(join(OUT, "favicon-16x16.png"), png16);
writeFileSync(join(OUT, "favicon-32x32.png"), png32);
writeFileSync(join(OUT, "apple-touch-icon.png"), png180);
writeFileSync(join(OUT, "favicon.ico"), buildIco([{ size: 16, png: png16 }, { size: 32, png: png32 }]));
writeFileSync(join(OUT, "favicon.svg"), svg());

console.log("favicon set written to", OUT);
