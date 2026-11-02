import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import arEG from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { WEB_ROOT } from './wrangler-rate-limits';

// The committed icon and share-card binaries (plan C12, C13). Dimensions come
// from the PNG header bytes, so no image library is needed.

const PNG_SIGNATURE = '89504e470d0a1a0a';

/** Width and height from a PNG's IHDR chunk (bytes 16 to 23). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function publicFile(path: string): Buffer {
  return readFileSync(resolve(WEB_ROOT, 'public', path));
}

describe('icons', () => {
  it('favicon.ico is one 48x48 PNG in an ICO container', () => {
    const ico = publicFile('favicon.ico');
    expect(ico.subarray(0, 6).toString('hex')).toBe('000001000100');
    expect([ico[6], ico[7]]).toEqual([48, 48]);
    const imageSize = ico.readUInt32LE(14);
    const imageOffset = ico.readUInt32LE(18);
    expect(imageOffset).toBe(22);
    expect(imageOffset + imageSize).toBe(ico.length);
    expect(pngSize(ico.subarray(imageOffset))).toEqual({ width: 48, height: 48 });
  });

  it.each<[string, number]>([
    ['apple-touch-icon.png', 180],
    ['icon-512.png', 512],
  ])('%s is %i square', (file, side) => {
    expect(pngSize(publicFile(file))).toEqual({ width: side, height: side });
  });
});

describe('share cards', () => {
  it.each([['ar-EG'], ['en']])('og.%s.png is 1200x630 and at most 300 KB', (locale) => {
    const path = `og/og.${locale}.png`;
    expect(pngSize(publicFile(path))).toEqual({ width: 1200, height: 630 });
    expect(statSync(resolve(WEB_ROOT, 'public', path)).size).toBeLessThanOrEqual(300_000);
  });

  it('the card source carries each catalog headline verbatim', () => {
    const source = readFileSync(resolve(WEB_ROOT, 'scripts/og-image/og-card.html'), 'utf8');
    for (const catalog of [arEG, en]) expect(source).toContain(`headline: '${catalog.landing.seo.ogHeadline}'`);
  });
});
