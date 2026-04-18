import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "icons");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function makePng(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const background = [10, 10, 15];
  const primary = [139, 92, 246];
  const accent = [6, 182, 212];

  const center = size / 2;
  const radius = size * 0.24;
  const innerRadius = size * 0.11;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const idx = row + 1 + x * 4;
      const gradientMix = (x + y) / (2 * size);
      const base = background.map((value, channel) => {
        const glow = primary[channel] * (0.12 * (1 - gradientMix)) + accent[channel] * (0.08 * gradientMix);
        return Math.round(Math.min(255, value + glow));
      });

      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const ray = radius * (Math.abs(Math.cos(angle * 4)) * 0.7 + 0.38);
      const starMask = distance <= ray ? 1 : 0;
      const coreMask = distance <= innerRadius ? 1 : 0;
      const orbDistance = Math.sqrt((x - size * 0.74) ** 2 + (y - size * 0.28) ** 2);
      const orbMask = orbDistance <= size * 0.08 ? 0.85 : 0;

      let rgb = base;
      if (starMask) {
        rgb = primary.map((value, channel) => Math.round(value * (1 - gradientMix) + accent[channel] * gradientMix));
      }
      if (coreMask) {
        rgb = [255, 255, 255];
      }
      if (orbMask) {
        rgb = rgb.map((value, channel) => Math.round(value * (1 - orbMask) + accent[channel] * orbMask));
      }

      pixels[idx] = rgb[0];
      pixels[idx + 1] = rgb[1];
      pixels[idx + 2] = rgb[2];
      pixels[idx + 3] = 255;
    }
  }

  const header = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(pixels);
  const png = Buffer.concat([header, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
  return png;
}

for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), makePng(size));
}
