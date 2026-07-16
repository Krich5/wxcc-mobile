// One-off generator for placeholder PWA icons (flat brand-color squares).
// Swap client/public/icons/* for real branded artwork before this goes beyond a POC.
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Renders a flat background square with a lighter rounded "phone" glyph so it reads
// as more than a blank swatch, without needing an image library.
function renderPng(size, [r, g, b], maskable) {
  const rows = [];
  const pad = maskable ? Math.round(size * 0.16) : 0; // safe zone for maskable icons
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inSafeZone = x >= pad && x < size - pad && y >= pad && y < size - pad;
      const glyph =
        inSafeZone &&
        x > size * 0.34 &&
        x < size * 0.66 &&
        y > size * 0.22 &&
        y < size * 0.78;
      const o = 1 + x * 4;
      if (glyph) {
        row[o] = 255;
        row[o + 1] = 255;
        row[o + 2] = 255;
        row[o + 3] = 235;
      } else {
        row[o] = r;
        row[o + 1] = g;
        row[o + 2] = b;
        row[o + 3] = 255;
      }
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const idat = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BRAND = [0, 87, 216]; // #0057D8

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const t of targets) {
  const png = renderPng(t.size, BRAND, t.maskable);
  writeFileSync(path.join(outDir, t.name), png);
  console.log(`wrote ${t.name} (${png.length} bytes)`);
}
