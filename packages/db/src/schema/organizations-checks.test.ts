import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_PAGE_CHECKS, NOT_VISIBLE } from './organizations-checks';

// The 0059 CHECKs may be looser than the app's normaliser, never stricter. The
// app keeps free text only when it holds a letter, digit, punctuation mark or
// symbol other than the five blank-looking ones; so the CHECK's "one visible
// character" rule is safe exactly when NOT_VISIBLE holds none of those.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/schema

/** Every code point a bracket class spelled with backslash-u / backslash-U escapes covers. */
function codePointsOf(characterClass: string): number[] {
  const escape = new RegExp(String.raw`\\[uU]([0-9A-Fa-f]{8}|[0-9A-Fa-f]{4})(?:-\\[uU]([0-9A-Fa-f]{8}|[0-9A-Fa-f]{4}))?`, 'g');
  const covered: number[] = [];
  let consumed = '';
  for (const match of characterClass.matchAll(escape)) {
    consumed += match[0];
    const first = Number.parseInt(match[1], 16);
    const last = match[2] ? Number.parseInt(match[2], 16) : first;
    for (let codePoint = first; codePoint <= last; codePoint += 1) covered.push(codePoint);
  }
  expect(consumed, 'the class is escapes only').toBe(characterClass);
  return covered;
}

/** The Braille blank and the Hangul fillers: letters and symbols that draw nothing. */
const BLANK_LOOKING = [0x2800, 0x115f, 0x1160, 0x3164, 0xffa0];
const SEEN_BY_THE_APP = /[\p{L}\p{N}\p{P}\p{S}]/u;
const DRAWS_NOTHING = /[\p{Z}\p{Cc}\p{Cf}\p{M}]/u;

describe('NOT_VISIBLE (0059)', () => {
  const covered = codePointsOf(NOT_VISIBLE);

  it('covers the white space, NEL, the blank-looking characters and the Arabic marks', () => {
    expect(covered).toEqual(expect.arrayContaining([0x20, 0xa0, 0x3000, 0x85, ...BLANK_LOOKING, 0x651, 0x64b, 0x670]));
  });

  it('holds no letter, digit, punctuation mark or symbol but the five blank-looking ones', () => {
    const visible = covered.filter(
      (codePoint) => SEEN_BY_THE_APP.test(String.fromCodePoint(codePoint)) && !BLANK_LOOKING.includes(codePoint),
    );
    expect(visible.map((codePoint) => codePoint.toString(16))).toEqual([]);
  });

  it('holds only white space, controls, format characters and marks besides them', () => {
    const other = covered.filter(
      (codePoint) => !DRAWS_NOTHING.test(String.fromCodePoint(codePoint)) && !BLANK_LOOKING.includes(codePoint),
    );
    expect(other.map((codePoint) => codePoint.toString(16))).toEqual([]);
  });
});

describe('the migration and the schema say the same thing', () => {
  const migration = readFileSync(resolve(here, '../../migrations/0059_client_page_checks_tightened.sql'), 'utf8')
    .replace(/\r\n/g, '\n');

  for (const name of [
    'organizations_studio_phone_format',
    'organizations_studio_whatsapp_format',
    'organizations_payment_text_printable',
  ] as const) {
    it(`0059 adds ${name} with the schema's exact text`, () => {
      expect(migration).toContain(`ADD CONSTRAINT ${name}\n    CHECK (${CLIENT_PAGE_CHECKS[name]});`);
    });
  }
});
