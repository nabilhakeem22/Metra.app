import { describe, expect, it } from 'vitest';
import { mayOpenInline } from './inline-view';

describe('mayOpenInline', () => {
  it.each([
    ['drawing.pdf', 'application/pdf'],
    ['render.png', 'image/png'],
    ['render.jpg', 'image/jpeg'],
    ['render.JPEG', 'image/jpeg; charset=binary'],
  ])('%s stored as %s opens', (name, type) => {
    expect(mayOpenInline(name, type)).toBe(true);
  });

  it.each([
    ['drawing.pdf', 'image/svg+xml'],
    ['drawing.pdf', 'text/html'],
    ['render.png', 'image/jpeg'],
    ['render.svg', 'image/svg+xml'],
    ['render.webp', 'image/webp'],
    ['drawing.dwg', 'application/acad'],
    ['drawing', 'application/pdf'],
    ['drawing.pdf', null],
  ])('%s stored as %s is saved instead', (name, type) => {
    expect(mayOpenInline(name, type)).toBe(false);
  });
});
