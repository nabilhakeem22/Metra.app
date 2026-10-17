import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { OnboardingWizard } from './wizard';

// A new studio's market price book loads in a request of its own, fired once
// createOrg has answered: never awaited (the dashboard opens at once) and
// silent when it fails (the empty price book offers the same load).

const actions = vi.hoisted(() => ({ createOrg: vi.fn(), createLogoUpload: vi.fn(), setOrgLogo: vi.fn() }));
vi.mock('@/lib/org/actions', () => actions);
vi.mock('@/lib/org/logo-actions', () => actions);
const seed = vi.hoisted(() => ({ seedNewStudioPriceBook: vi.fn() }));
vi.mock('@/lib/market-book/actions', () => seed);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

async function createStudio(): Promise<void> {
  renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
  fireEvent.change(document.getElementById('nameAr')!, { target: { value: 'ستوديو النيل' } });
  const submit = screen.getByRole('button', { name: messageAt('ar-EG', 'onboarding.create') });
  await act(async () => {
    fireEvent.submit(submit.closest('form')!);
  });
}

beforeEach(() => {
  for (const mock of [actions.createOrg, seed.seedNewStudioPriceBook, toast, router.push]) mock.mockReset();
});

describe('the market price book after sign-up', () => {
  test('is fired once the studio exists, and the dashboard opens without waiting for it', async () => {
    actions.createOrg.mockResolvedValue({ ok: true });
    seed.seedNewStudioPriceBook.mockReturnValue(new Promise(() => {}));
    await createStudio();
    expect(seed.seedNewStudioPriceBook).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  test('says nothing when it fails', async () => {
    actions.createOrg.mockResolvedValue({ ok: true });
    seed.seedNewStudioPriceBook.mockRejectedValue(new Error('network'));
    await createStudio();
    await act(async () => {});
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(toast.mock.calls.map(([call]) => call.title)).toEqual([messageAt('ar-EG', 'onboarding.createdTitle')]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('is not fired when the studio was not created', async () => {
    actions.createOrg.mockResolvedValue({ ok: false, error: 'generic' });
    await createStudio();
    expect(seed.seedNewStudioPriceBook).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
