import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ProjectForm } from './project-form';
import { todayIsoLocal } from './project-form-state';

const actions = vi.hoisted(() => ({ createProject: vi.fn(), updateProject: vi.fn() }));
vi.mock('@/lib/projects/actions', () => actions);
const toasts = vi.hoisted(() => [] as { variant?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { variant?: string }) => {
    toasts.push(raised);
  },
}));

const en = (path: string) => messageAt('en', path);
const CLIENTS = [{ id: 'c-1', nameEn: 'Acme', nameAr: null, city: 'Giza', country: null }];

describe('ProjectForm (new)', () => {
  test('no client chosen, today as start, no Status field, no required mark on the end date', () => {
    renderWithIntl(<ProjectForm open onOpenChange={() => {}} clientOptions={CLIENTS} />, {
      locale: 'en',
    });
    expect(screen.getByText(en('projects.form.clientPlaceholder'))).toBeTruthy();
    expect((document.getElementById('pr-start') as HTMLInputElement).value).toBe(
      todayIsoLocal(new Date()),
    );
    expect(document.getElementById('pr-status')).toBeNull();
    const end = document.getElementById('pr-end') as HTMLInputElement;
    expect(end.required).toBe(false);
    expect(end.getAttribute('aria-required')).toBeNull();
    expect((document.getElementById('pr-country') as HTMLInputElement).value).toBe(
      en('projects.form.countryDefault'),
    );
    // Save waits for a name and a client.
    expect(
      (screen.getByRole('button', { name: en('projects.form.save') }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test('with zero clients it links to /clients?new=1 for a role that may add one', () => {
    renderWithIntl(
      <ProjectForm open onOpenChange={() => {}} clientOptions={[]} canAddClient />,
      { locale: 'en' },
    );
    expect(
      screen.getByRole('link', { name: en('projects.empty.addClient') }).getAttribute('href'),
    ).toBe('/en/clients?new=1');
  });
});

describe('ProjectForm refusals', () => {
  const ITEM = {
    id: 'p-1',
    code: 'P-2026-0001',
    nameEn: 'Tower',
    nameAr: null,
    clientId: 'c-1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: null,
    city: null,
    country: null,
    address: null,
    notes: null,
  };
  const submitEdit = async (error: string) => {
    actions.updateProject.mockResolvedValue({ ok: false, error });
    renderWithIntl(
      <ProjectForm open onOpenChange={() => {}} clientOptions={CLIENTS} item={ITEM as never} />,
      { locale: 'en' },
    );
    await act(async () => {
      fireEvent.submit(document.getElementById('pr-nameEn')!.closest('form')!);
    });
  };

  test('start_date_required is said under the start date, which is marked invalid', async () => {
    await submitEdit('start_date_required');
    expect(document.getElementById('pr-start-error')?.textContent).toBe(
      en('errors.start_date_required'),
    );
    expect(document.getElementById('pr-start')?.getAttribute('aria-invalid')).toBe('true');
    expect(toasts.filter((raised) => raised.variant === 'destructive')).toHaveLength(0);
  });

  test('an end date before the start is said under the end date', async () => {
    await submitEdit('invalid_dates');
    expect(document.getElementById('pr-end-error')?.textContent).toBe(en('errors.invalid_dates'));
  });
});
