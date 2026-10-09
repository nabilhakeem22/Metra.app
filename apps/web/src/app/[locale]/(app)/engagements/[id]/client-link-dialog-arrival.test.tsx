import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { ClientLinkDialog } from './client-link-dialog';

// The dashboard's "Share with your client" step lands on `/engagements/{id}?share=1`.
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/engagements/e-1',
}));
const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(query.value),
}));
const actions = vi.hoisted(() => ({
  shareDeliveryLink: vi.fn(),
  revealDeliveryLink: vi.fn(),
  rotateDeliveryLink: vi.fn(),
  revokeDeliveryLink: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

beforeEach(() => {
  query.value = '';
  router.replace.mockReset();
});

describe('the client link dialog on arrival', () => {
  test('?share=1 opens it once, writes nothing, and drops the flag from the address', async () => {
    query.value = 'share=1';
    // A re-render (the refresh that follows the replace) must not open it again.
    function Page() {
      const [shared, setShared] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShared(true)}>
            refreshed
          </button>
          <ClientLinkDialog engagementId="e-1" initialShared={shared} />
        </>
      );
    }
    renderWithIntl(<Page />, { locale: 'en' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/engagements/e-1', { scroll: false });
    expect(actions.shareDeliveryLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'refreshed', hidden: true }));
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  test('without the flag it stays closed and leaves the address alone', () => {
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared={false} />, { locale: 'en' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
