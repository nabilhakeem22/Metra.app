import { describe, expect, it } from 'vitest';
import { whatsappDigits, whatsappUrl } from './whatsapp';

// Every case the B11 testers reported (F1, F7) is a row here, with the ones the
// first cut already handled.
describe('whatsappDigits', () => {
  it.each([
    // The ways an Egyptian mobile is written.
    ['01012345678', '201012345678'],
    ['+20 10 1234 5678', '201012345678'],
    ['0020 10 1234 5678', '201012345678'],
    ['010-1234-5678', '201012345678'],
    ['(010) 1234.5678', '201012345678'],
    ['+20-10-1234-5678', '201012345678'],
    // F1: the trunk 0 kept after +20, and dropped by a spreadsheet import.
    ['+20 010 1234 5678', '201012345678'],
    ['+20 (0)10 1234 5678', '201012345678'],
    ['00200 10 1234 5678', '201012345678'],
    ['1012345678', '201012345678'],
    ['1112345678', '201112345678'],
    ['1212345678', '201212345678'],
    ['1512345678', '201512345678'],
    // F7: Arabic-Indic and Extended Arabic-Indic digits.
    ['٠١٠١٢٣٤٥٦٧٨', '201012345678'],
    ['۰۱۰۱۲۳۴۵۶۷۸', '201012345678'],
    ['+٢٠ ١٠ ١٢٣٤ ٥٦٧٨', '201012345678'],
    // F7: bidi and format marks (WhatsApp's own "copy number" wraps it in LRE/PDF).
    ['‪+20 10 1234 5678‬', '201012345678'],
    ['‎01012345678', '201012345678'],
    ['‏+20‏ 10 1234 5678', '201012345678'],
    ['⁦+20 10 1234 5678⁩', '201012345678'],
    ['0101​234‍5678', '201012345678'],
    // Spaces of other widths.
    ['010 1234 5678', '201012345678'],
    ['010 1234 5678', '201012345678'],
    // Other countries keep their code.
    ['+971 50 123 4567', '971501234567'],
    ['+44 20 7946 0958', '442079460958'],
    ['00966 50 123 4567', '966501234567'],
    ['+1 (415) 555-0100', '14155550100'],
  ])('%j -> %j', (phone, digits) => {
    expect(whatsappDigits(phone)).toBe(digits);
  });

  it.each([
    [null],
    [''],
    ['   '],
    ['123'],
    // A landline we cannot place, and a number with no country code.
    ['0223456789'],
    ['1312345678'],
    // Over 15 digits, a country code starting with 0, letters, an extension.
    ['+1234567890123456'],
    ['+0012345678'],
    ['01012345678 ext 2'],
    ['call 01012345678'],
    ['+20 10 1234 5678#'],
    ['tel:+201012345678'],
    ['01012345678?x=1'],
  ])('%j -> null', (phone) => {
    expect(whatsappDigits(phone)).toBeNull();
  });
});

describe('whatsappUrl', () => {
  it('prefills the encoded text for the number', () => {
    const url = whatsappUrl('201012345678', 'مرحبًا أحمد\nhttps://metra.app/ar-EG/d/abc_-1');
    expect(url.startsWith('https://wa.me/201012345678?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(
      'مرحبًا أحمد\nhttps://metra.app/ar-EG/d/abc_-1',
    );
  });

  it('with no number, opens WhatsApp with the text and no chat', () => {
    expect(whatsappUrl(null, 'hi & bye')).toBe('https://wa.me/?text=hi%20%26%20bye');
  });
});
