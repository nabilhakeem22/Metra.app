import { act, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { SettingsLogoField } from './settings-logo-field';

// The owner's report: "the company logo didn't save at all". It had saved;
// Settings only ever showed a freshly picked file, so after a reload the saved
// logo looked lost. These pin the saved logo on load, the preview while a new
// one uploads, and the saved logo again once the upload is attached.

const upload = vi.hoisted(() => ({ uploadOrgLogo: vi.fn() }));
vi.mock('@/lib/org/upload-org-logo', () => upload);
const toasts = vi.hoisted(() => [] as Array<{ title: string; variant?: string }>);
vi.mock('@/hooks/use-toast', () => ({ toast: (raised: { title: string; variant?: string }) => toasts.push(raised) }));
// router.refresh re-renders the server page; here it hands the field the id the
// page would now read (the harness below plays the page).
const page = vi.hoisted(() => ({ nextSavedLogoId: 'file-2', refresh: () => {} }));
const router = vi.hoisted(() => ({ refresh: vi.fn(() => page.refresh()) }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

function SettingsPage({ savedLogoId }: { savedLogoId: string | null }) {
  const [saved, setSaved] = useState(savedLogoId);
  useEffect(() => {
    page.refresh = () => setSaved(page.nextSavedLogoId);
  }, []);
  return <SettingsLogoField savedLogoId={saved} disabled={false} />;
}

const logoImage = () => document.querySelector('img');
const logoInput = () => document.getElementById('logo') as HTMLInputElement;
const pick = (name = 'new.png') =>
  fireEvent.change(logoInput(), { target: { files: [new File([new Uint8Array([1])], name, { type: 'image/png' })] } });

/** happy-dom loads no image: every <img> reads as complete with no pixels,
 *  i.e. as one that already FAILED. A browser mid-load reads incomplete. */
function imagesLoad(state: 'loading' | 'failed') {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(state === 'failed');
}

beforeEach(() => {
  imagesLoad('loading');
  upload.uploadOrgLogo.mockReset();
  router.refresh.mockClear();
  toasts.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the Settings logo', () => {
  test('a saved logo shows on load, from the studio logo route keyed by its file id', () => {
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });
    expect(logoImage()?.getAttribute('src')).toBe('/en/settings/logo?v=file-1');
    expect(logoInput().accept).toBe('image/png,image/jpeg,image/webp');
  });

  test('no saved logo: the upload icon, no image', () => {
    renderWithIntl(<SettingsPage savedLogoId={null} />, { locale: 'ar-EG' });
    expect(logoImage()).toBeNull();
  });

  test('a saved logo that fails to load falls back to the upload icon', () => {
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });
    fireEvent.error(logoImage()!);
    expect(logoImage()).toBeNull();
  });

  test('a saved logo that failed before hydration (no onError listener yet) falls back too', () => {
    imagesLoad('failed');
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });
    expect(logoImage()).toBeNull();
  });

  test('a new pick shows its preview while it uploads, then the NEW saved logo once attached', async () => {
    let finishUpload: (attached: { ok: boolean }) => void = () => {};
    upload.uploadOrgLogo.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });

    await act(async () => pick());
    expect(logoImage()?.getAttribute('src')).toBe('blob:preview');
    expect(logoInput().disabled).toBe(true);
    expect(upload.uploadOrgLogo).toHaveBeenCalledWith(expect.objectContaining({ name: 'new.png' }));

    await act(async () => finishUpload({ ok: true }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([{ title: messageAt('en', 'settings.logoUpdated') }]);
    expect(logoImage()?.getAttribute('src')).toBe('/en/settings/logo?v=file-2');
    expect(logoInput().disabled).toBe(false);
  });

  test('a refused upload says why under the picker, drops the preview and shows the saved logo again', async () => {
    upload.uploadOrgLogo.mockResolvedValue({ ok: false, error: 'logo_image_unsupported' });
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });
    await act(async () => pick());
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
    expect(document.getElementById('logo-error')?.textContent).toBe(messageAt('en', 'errors.logo_image_unsupported'));
    expect(logoInput().getAttribute('aria-describedby')).toBe('logo-error');
    expect(logoImage()?.getAttribute('src')).toBe('/en/settings/logo?v=file-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  test('an upload that never answered says Metra could not be reached', async () => {
    upload.uploadOrgLogo.mockRejectedValue(new TypeError('fetch failed'));
    renderWithIntl(<SettingsPage savedLogoId="file-1" />, { locale: 'en' });
    await act(async () => pick());
    expect(document.getElementById('logo-error')?.textContent).toBe(messageAt('en', 'errors.unreachable'));
  });

  test('a read-only member cannot pick a logo', () => {
    renderWithIntl(<SettingsLogoField savedLogoId="file-1" disabled />, { locale: 'en' });
    expect(logoInput().disabled).toBe(true);
  });
});
