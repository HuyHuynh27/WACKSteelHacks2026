#!/usr/bin/env node
/**
 * Generates the PWA icon PNGs with no image-library dependency.
 * Draws a rounded slate tile with a white bar-chart mark.
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";

const OUT_DIR = new URL("../public/icons/", import.meta.url);

const BG = [15, 23, 42]; // slate-900
const FG = [255, 255, 255];
const ACCENT = [56, 189, 248]; // sky-400

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** @param {number} size @param {boolean} maskable */
function drawIcon(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  // Maskable icons must survive a circular crop, so skip the rounded corners
  // and shrink the mark into the safe zone.
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.22 : size * 0.16;

  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  const insideRounded = (x, y) => {
    if (radius === 0) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRounded(x + 0.5, y + 0.5)) set(x, y, BG);
      else set(x, y, BG, 0);
    }
  }

  // Three ascending bars; the tallest is the accent colour.
  const area = size - inset * 2;
  const barW = area / 5;
  const gap = barW / 2;
  const heights = [0.38, 0.62, 0.95];
  const baseline = inset + area;

  heights.forEach((h, i) => {
    const x0 = Math.round(inset + i * (barW + gap));
    const x1 = Math.round(x0 + barW);
    const y0 = Math.round(baseline - area * h);
    const colour = i === heights.length - 1 ? ACCENT : FG;
    for (let y = y0; y < baseline; y++) {
      for (let x = x0; x < x1; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, colour);
      }
    }
  });

  return encodePng(size, size, px);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(new URL(name, OUT_DIR), drawIcon(size, maskable));
  console.log(`wrote public/icons/${name} (${size}x${size})`);
}
