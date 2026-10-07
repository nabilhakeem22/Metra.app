import { describe, expect, it } from 'vitest';
import { whatsappDigits, whatsappUrl } from './whatsapp';

describe('whatsappDigits', () => {
  it.each([
    ['01012345678', '201012345678'],
    ['+20 10 1234 5678', '201012345678'],
    ['0020 10 1234 5678', '201012345678'],
    ['010-1234-5678', '201012345678'],
    ['(010) 1234.5678', '201012345678'],
    ['+971 50 123 4567', '971501234567'],
    ['+44 20 7946 0958', '442079460958'],
  ])('%j -> %j', (phone, digits) => {
    expect(whatsappDigits(phone)).toBe(digits);
  });

  it.each([
    [null],
    [''],
    ['123'],
    ['0223456789'],
    ['+1234567890123456'],
    ['01012345678 ext 2'],
    ['٠١٠١٢٣٤٥٦٧٨'],
    ['+0012345678'],
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
