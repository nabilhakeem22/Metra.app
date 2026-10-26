import { describe, expect, it } from 'vitest';
import { codeBoxValue, typedCode } from './code-answers';

describe('codeBoxValue: what the code box holds', () => {
  it('keeps Latin digits only, Arabic-Indic ones folded, at most six', () => {
    expect(codeBoxValue('٠٤٢ ٩١٧')).toBe('042917');
    expect(codeBoxValue('04-29-17-55')).toBe('042917');
    expect(codeBoxValue('abc')).toBe('');
  });
});

describe('typedCode: the code a client sent', () => {
  it('is six digits after folding and dropping spaces, or null', () => {
    expect(typedCode('042917')).toBe('042917');
    expect(typedCode(' ۰۴۲ ۹۱۷ ')).toBe('042917');
    for (const sent of ['04291', '0429170', '04a917', '', null, 42917, { code: '042917' }]) expect(typedCode(sent)).toBeNull();
  });
});
