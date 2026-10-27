import { describe, expect, it } from 'vitest';
import { renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractSigningLine } from './contract-signing-line';

// H6.2 re-check N1: an unbroken 120-character signer name breaks inside the
// studio's signing line (overflow-wrap:anywhere, which also lowers the line's
// min-content width in a flex row), never past the page or the cockpit card.

describe.each<TestLocale>(['en', 'ar-EG'])('the studio signing line (%s)', (locale) => {
  it('may break anywhere, keeping the caller classes, with the whole name in it', () => {
    const name = locale === 'en' ? 'Abdelrahman'.repeat(11).slice(0, 120) : 'ع'.repeat(120);
    const { container } = renderWithIntl(
      <ContractSigningLine signed={{ on: '2026-10-25', via: 'online', signerName: name }} className="text-muted-foreground" />,
      { locale },
    );
    const line = container.querySelector('[data-contract-signed]')!;
    expect(line.className.split(' ')).toEqual(expect.arrayContaining(['[overflow-wrap:anywhere]', 'text-muted-foreground']));
    expect(line.textContent).toContain(name);
  });
});
