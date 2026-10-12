import { describe, expect, it } from 'vitest';
import { CLIENT_PAGE_CHECKS } from '../../../../../packages/db/src/schema/organizations-checks';
import { reachableOnWhatsapp, studioPhoneOf } from './studio-phone';

// Round E (AC P1): the 0060 phone and WhatsApp CHECKs refuse `+200` (Egypt's
// code with its trunk 0 kept). They may be looser than the app, never
// stricter, so no number the app stores may start `+200`, and every number it
// stores must pass the CHECK. Fed thousands of seeded +20 numbers written with
// their trunk zeros, every way people type them, and checked against the
// CHECK's OWN text, read as a JavaScript expression.

/**
 * A client-page CHECK on one column, as a predicate: `IS NULL`, `~ '<re>'` and
 * `!~ '<re>'` joined by AND, OR and brackets. Anything else throws, so a CHECK
 * this reader does not understand fails the test instead of passing it.
 */
function checkOf(expression: string, column: string): (value: string) => boolean {
  const tokens = expression.match(new RegExp(String.raw`\(|\)|AND|OR|${column} IS NULL|${column} !?~ '[^']*'|\S+`, 'g')) ?? [];
  let at = 0;
  const value = { current: '' };
  const term = (): boolean => {
    const token = tokens[at++];
    if (token === '(') {
      const inner = either();
      if (tokens[at++] !== ')') throw new Error(`no ) in ${expression}`);
      return inner;
    }
    if (token === `${column} IS NULL`) return false;
    const match = token?.match(new RegExp(String.raw`^${column} (!?)~ '([^']*)'$`));
    if (!match) throw new Error(`unread token ${token}`);
    return new RegExp(match[2]).test(value.current) !== (match[1] === '!');
  };
  const both = (): boolean => {
    let result = term();
    while (tokens[at] === 'AND') {
      at += 1;
      result = term() && result;
    }
    return result;
  };
  const either = (): boolean => {
    let result = both();
    while (tokens[at] === 'OR') {
      at += 1;
      result = both() || result;
    }
    return result;
  };
  return (input) => {
    [at, value.current] = [0, input];
    const result = either();
    if (at !== tokens.length) throw new Error(`unread tail in ${expression}`);
    return result;
  };
}

const PHONE_CHECK = checkOf(CLIENT_PAGE_CHECKS.organizations_studio_phone_format, 'studio_phone');
const WHATSAPP_CHECK = checkOf(CLIENT_PAGE_CHECKS.organizations_studio_whatsapp_format, 'studio_whatsapp');

/** A seeded generator (mulberry32), so a failing case is reproducible from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIXES = ['+20', '0020', '+0020', '00 20'];
const SEPARATORS = ['', '', '', ' ', '-', '(', ')'];

/** `count` +20 numbers: a prefix, 0 to 4 trunk zeros, then 8 to 10 digits, typed with separators and Arabic-Indic digits. */
function egyptianNumbers(count: number, seed: number): string[] {
  const random = seededRandom(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const typed = (digit: number) => (random() < 0.2 ? String.fromCodePoint(0x660 + digit) : String(digit));
  return Array.from({ length: count }, () => {
    const digits = [...'0'.repeat(Math.floor(random() * 5))].map(() => 0);
    const tail = 8 + Math.floor(random() * 3);
    for (let index = 0; index < tail; index += 1) digits.push(Math.floor(random() * 10));
    return pick(PREFIXES) + digits.map((digit) => pick(SEPARATORS) + typed(digit)).join('');
  });
}

describe('P1: what the app stores passes the 0060 phone and WhatsApp CHECKs', () => {
  const inputs = egyptianNumbers(5000, 60);
  const stored = inputs.map((input) => ({ input, phone: studioPhoneOf(input) }));

  it('reads the CHECK it is checking against', () => {
    expect(PHONE_CHECK('+201012345678')).toBe(true);
    expect(PHONE_CHECK('+2001012345678')).toBe(false);
    expect(PHONE_CHECK('0223456789')).toBe(true);
    expect(WHATSAPP_CHECK('0223456789')).toBe(false);
    expect(WHATSAPP_CHECK('+2001012345678')).toBe(false);
  });

  it('stores many of them, never one starting +200', () => {
    const kept = stored.filter(({ phone }) => phone !== null);
    expect(kept.length).toBeGreaterThan(2500);
    expect(kept.filter(({ input }) => /^(\+|00 ?)(00)?20 ?[0٠]/.test(input)).length).toBeGreaterThan(500);
    expect(kept.filter(({ phone }) => /^\+200/.test(phone!))).toEqual([]);
  });

  it('every stored number passes the phone CHECK, and every WhatsApp one the WhatsApp CHECK', () => {
    const phoneRefused = stored.filter(({ phone }) => phone !== null && !PHONE_CHECK(phone));
    expect(phoneRefused).toEqual([]);
    const whatsapp = stored.filter(({ phone }) => phone !== null && reachableOnWhatsapp(phone));
    expect(whatsapp.length).toBeGreaterThan(500);
    expect(whatsapp.filter(({ phone }) => !WHATSAPP_CHECK(phone!))).toEqual([]);
  });
});
