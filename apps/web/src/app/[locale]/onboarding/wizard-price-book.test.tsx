import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MARKET_SEED_PATH } from '@/lib/market-book/seed-request';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { OnboardingWizard } from './wizard';

// A new studio's market price book loads in a request of its own, fired once
// createOrg (and the logo) answered: a keepalive POST to the seed route, NOT a
// server action (the router would queue it behind the pending ones and, once
// the wizard navigated, post it to the dashboard, where it never ran). Never
// awaited, silent when it fails.

const actions = vi.hoisted(() => ({ createOrg: vi.fn(), createLogoUpload: vi.fn(), setOrgLogo: vi.fn() }));
vi.mock('@/lib/org/actions', () => actions);
vi.mock('@/lib/org/logo-actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
const order = vi.hoisted(() => [] as string[]);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

const fetchMock = vi.fn();

async function createStudio(): Promise<void> {
  renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
  fireEvent.change(document.getElementById('nameAr')!, { target: { value: 'ستوديو النيل' } });
  const submit = screen.getByRole('button', { name: messageAt('ar-EG', 'onboarding.create') });
  await act(async () => {
    fireEvent.submit(submit.closest('form')!);
  });
}

beforeEach(() => {
  for (const mock of [actions.createOrg, toast, router.push, fetchMock]) mock.mockReset();
  order.length = 0;
  router.push.mockImplementation(() => void order.push('navigate'));
  fetchMock.mockImplementation(() => {
    order.push('seed');
    return new Promise(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('the market price book after sign-up', () => {
  test('is one keepalive POST to the seed route, before the navigation and not waited for', async () => {
    actions.createOrg.mockResolvedValue({ ok: true });
    await createStudio();
    expect(fetchMock.mock.calls).toEqual([[MARKET_SEED_PATH, { method: 'POST', keepalive: true, credentials: 'same-origin' }]]);
    expect(order).toEqual(['seed', 'navigate']);
  });

  test('says nothing when it fails', async () => {
    actions.createOrg.mockResolvedValue({ ok: true });
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('network')));
    await createStudio();
    await act(async () => {});
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(toast.mock.calls.map(([call]) => call.title)).toEqual([messageAt('ar-EG', 'onboarding.createdTitle')]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('is not sent when the studio was not created', async () => {
    actions.createOrg.mockResolvedValue({ ok: false, error: 'generic' });
    await createStudio();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
