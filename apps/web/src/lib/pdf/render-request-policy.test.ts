import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDF_CONTENT_SECURITY_POLICY, PDF_CSP_META, isAllowedRenderRequest, requestSchemeOf } from './render-request-policy';

describe('isAllowedRenderRequest', () => {
  it.each(['data:font/ttf;base64,AA', 'about:blank'])('allows %s', (url) => {
    expect(isAllowedRenderRequest(url)).toBe(true);
  });

  it.each([
    'https://x',
    'http://localhost',
    'file:///etc/passwd',
    'blob:x',
    'ws://x',
    'https://metra-web.nabil-hakeem22.workers.dev/en/dashboard',
  ])('refuses %s', (url) => {
    expect(isAllowedRenderRequest(url)).toBe(false);
  });
});

describe('requestSchemeOf', () => {
  it('keeps the scheme and nothing else', () => {
    expect(requestSchemeOf('https://storage.test/object/sign/x?token=SECRET')).toBe('https');
    expect(requestSchemeOf('FILE:///etc/passwd')).toBe('file');
  });

  it('names a URL without a scheme unknown', () => {
    expect(requestSchemeOf('//x/y')).toBe('unknown');
  });
});

describe('the PDF template CSP (T7)', () => {
  it('lets nothing load but inline styles and data: fonts and images', () => {
    expect(PDF_CONTENT_SECURITY_POLICY).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:");
    expect(PDF_CSP_META).toBe(`<meta http-equiv="Content-Security-Policy" content="${PDF_CONTENT_SECURITY_POLICY}" />`);
  });

  it.each(['boq-template.ts', 'contract-template.ts', 'proposal-template.ts'])('%s puts it right after the charset', (file) => {
    const lines = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').split(/\r?\n/);
    const charset = lines.indexOf('<meta charset="utf-8" />');
    expect(lines.slice(charset, charset + 3)).toEqual(['<meta charset="utf-8" />', '${PDF_CSP_META}', '<style>']);
  });
});
