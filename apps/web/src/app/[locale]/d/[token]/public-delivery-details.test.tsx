import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { publicDeliveryFixture } from '@/test/public-delivery-fixture';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PublicDeliveryView } from './public-delivery';

// Round C, PR-C9 (AC 45 to 48): the studio bar's logo, WhatsApp and Call; how
// to pay while a payment is due; the claim's "sent on" date; what was received.

vi.mock('./actions', () => ({}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STUDIO = { nameAr: 'ديوان', nameEn: 'Diwan Studio', hasLogo: true, phone: '+201012345678', whatsappDigits: '201112345678' };
const DETAILS = { instapay: 'diwan@instapay', bankName: 'CIB', bankAccountHolder: 'Diwan LLC', bankAccountNumber: '100023456789', bankIban: null };

function renderPage(locale: TestLocale, overrides: Partial<PublicDelivery> = {}) {
  const delivery = publicDeliveryFixture({ firm: STUDIO, ...overrides });
  return renderWithIntl(<PublicDeliveryView token="tok-1" read={{ status: 'ok', delivery }} />, { locale });
}

describe('the studio bar (AC 45, 46)', () => {
  it('shows the logo from the logo route, and the initial when it fails', () => {
    // happy-dom loads no image: report a loaded one, as a browser would.
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(160);
    renderPage('en');
    const bar = screen.getByRole('banner');
    const logo = bar.querySelector('img')!;
    expect(logo.getAttribute('src')).toBe('/en/d/tok-1/logo');
    fireEvent.error(logo);
    expect(bar.querySelector('img')).toBeNull();
    expect(within(bar).getByText('D')).toBeTruthy();
  });

  it('WhatsApp and Call carry only the studio number and the delivery reference', () => {
    renderPage('ar-EG');
    const whatsapp = screen.getByRole('link', { name: messageAt('ar-EG', 'delivery.studioBar.whatsapp') });
    const href = whatsapp.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/201112345678?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1]!)).toBe(
      messageAt('ar-EG', 'delivery.studioBar.whatsappText').replace('{ref}', 'DE-2026-0007'),
    );
    expect(href).not.toContain(encodeURIComponent('أحمد'));
    expect(whatsapp.getAttribute('rel')).toBe('noopener noreferrer');
    const call = screen.getByRole('link', { name: messageAt('ar-EG', 'delivery.studioBar.call') });
    expect(call.getAttribute('href')).toBe('tel:+201012345678');
  });

  it('a logo that failed before hydration (no onError listener yet) still falls back to the initial', () => {
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    renderPage('en');
    expect(screen.getByRole('banner').querySelector('img')).toBeNull();
  });

  it('no logo, no numbers: the initial and no contact buttons', () => {
    renderPage('en', { firm: { ...STUDIO, hasLogo: false, phone: null, whatsappDigits: null } });
    expect(screen.getByRole('banner').querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: messageAt('en', 'delivery.studioBar.whatsapp') })).toBeNull();
    expect(screen.queryByRole('link', { name: messageAt('en', 'delivery.studioBar.call') })).toBeNull();
  });
});

describe('how to pay (AC 47)', () => {
  it('shows each instruction as text with a Copy button, never a link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderPage('en', { paymentDetails: DETAILS });
    const section = screen.getByRole('region', { name: messageAt('en', 'delivery.payments.instructions.title') });
    expect(within(section).getByText('diwan@instapay').closest('a')).toBeNull();
    expect(section.querySelectorAll('a')).toHaveLength(0);
    const copy = within(section).getByRole('button', { name: 'Copy InstaPay' });
    await act(async () => fireEvent.click(copy));
    expect(writeText).toHaveBeenCalledWith('diwan@instapay');
    expect(copy.textContent).toContain(messageAt('en', 'delivery.payments.instructions.copied'));
    // Four values set, four buttons; the IBAN was not set.
    expect(within(section).getAllByRole('button')).toHaveLength(4);
  });

  it('a refused clipboard selects the value and says so', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    renderPage('en', { paymentDetails: DETAILS });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy Account number' })));
    expect(screen.getByText(messageAt('en', 'delivery.payments.instructions.copyFailed'))).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe('100023456789');
  });

  it('is gone once the payment is claimed, and without details', () => {
    const claimed = { claimableMilestones: [{ milestoneKind: 'deposit', amountRemaining: '36000.0000', hasPendingClaim: true, claimedAt: '2026-10-01T06:00:00.000Z' }] };
    renderPage('en', { paymentDetails: DETAILS, paymentClaim: claimed });
    expect(screen.queryByText(messageAt('en', 'delivery.payments.instructions.title'))).toBeNull();
    // AC 48: the open claim is dated.
    expect(screen.getByText(/Sent on/).textContent).toContain('01/10/2026');
  });
});

describe('payments received (AC 48)', () => {
  it('lists each payment with its amount (Latin digits, LTR, mono) and the day it was received', () => {
    renderPage('ar-EG', {
      timeline: [
        { type: 'payment', kind: 'gate_a', amount: '20000.5000', at: '2026-09-02T10:00:00.000Z' },
        { type: 'stage', stageKey: 'visuals', at: '2026-09-01T10:00:00.000Z' },
        { type: 'payment', kind: 'deposit', amount: '30000.0000', at: '2026-08-01T10:00:00.000Z' },
      ],
    });
    const section = screen.getByRole('region', { name: messageAt('ar-EG', 'delivery.payments.receipts.title') });
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(messageAt('ar-EG', 'delivery.payments.kind.gate_a')),
      expect.stringContaining(messageAt('ar-EG', 'delivery.payments.kind.deposit')),
    ]);
    const amount = rows[0]!.querySelector('[dir="ltr"]')!;
    expect(amount.className).toContain('font-mono');
    expect(amount.textContent).toMatch(/^20,000\.50/);
    expect(rows[0]!.textContent).toContain('02/09/2026');
    expect(section.textContent).not.toMatch(/[٠-٩]/);
  });
});
