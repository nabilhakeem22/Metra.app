import { describe, expect, it } from 'vitest';
import { holdsUrlLikeText } from './url-like';

// H7 S4: what "URL-like" means, pinned both ways. A hit costs the email one word
// of the studio's name; a miss carries a lure under the platform's From.

describe('holdsUrlLikeText', () => {
  it.each([
    'https://evil.example',
    'HTTP://EVIL.EXAMPLE',
    'http:evil',
    'Pay at https://x',
    'www.evil',
    'WWW.EVIL.EXAMPLE',
    'evil.com',
    'EVIL.COM',
    'Evil.Com',
    'evil.xyz',
    'pay-now.evil.co.uk',
    'evil.com/pay',
    'evil.com.',
    '(evil.com)',
    'sales@evil.com',
    'Noon Studio evil.com',
    'xn--80ak6aa92e.com',
    'evil.xn--wgbh1c',
    't.me/evil',
    'x.com',
    'co.uk',
    'eng.xyz',
    'A.Bc.Design',
  ])('a link in English text: %j', (text) => {
    expect(holdsUrlLikeText(text)).toBe(true);
  });

  it.each([
    'استوديو نون evil.com',
    'زوروا evil.com، الآن',
    'زورواevil.com',
    'استوديو https://evil.example',
    'www.evil.example للتصميم',
    'سجل.مصر',
    'evil.مصر',
    'استوديو نون evil.كوم',
  ])('a link in Arabic text: %j', (text) => {
    expect(holdsUrlLikeText(text)).toBe(true);
  });

  it.each([
    ['fullwidth letters and dot', '\uff45\uff56\uff49\uff4c\uff0e\uff43\uff4f\uff4d'],
    ['an ideographic full stop', 'evil\u3002com'],
    ['a zero-width space', 'evil\u200b.com'],
    ['a bidi control', 'evil.\u202ecom'],
    ['a soft hyphen', 'ww\u00adw.evil'],
  ])('a link behind %s', (_case, text) => {
    expect(holdsUrlLikeText(text)).toBe(true);
  });

  it.each([
    'Diwan Studio',
    'A.B. Design',
    'A.B.Design',
    'A.B.C Studio',
    'J.P.Morgan Interiors',
    'M.A. Interiors',
    'Design Co.',
    'Design Co. Ltd.',
    'Design Co.Ltd',
    'St. Regis Design',
    'St.Regis Design',
    'Dr. Ahmed Design',
    'Dr.Ahmed Design',
    'Eng.Ahmed Studio',
    'No.5 Design',
    'Studio 3.14',
    'HTTP Design',
    'Studio WWW',
    'WWW. Design',
    'AT&T Interiors',
    'Noon, Inc.',
    'Ahmed & Sons',
    'Studio-3',
  ])('an English name stays: %j', (text) => {
    expect(holdsUrlLikeText(text)).toBe(false);
  });

  it.each([
    'استوديو نون',
    'استوديو ديوان للتصميم',
    'م. أحمد للتصميم',
    'م.أحمد للتصميم',
    'د.محمد علي',
    'شركة م.محمد وشركاه',
    'م.مصر',
    'ديوان، للتصميم الداخلي.',
    'ن.ع للتصميم',
    'مصر للتصميم',
    'استوديو A.B. للتصميم',
  ])('an Arabic name stays: %j', (text) => {
    expect(holdsUrlLikeText(text)).toBe(false);
  });

  it('nothing at all holds nothing', () => {
    expect(holdsUrlLikeText('')).toBe(false);
    expect(holdsUrlLikeText('   ')).toBe(false);
  });
});
