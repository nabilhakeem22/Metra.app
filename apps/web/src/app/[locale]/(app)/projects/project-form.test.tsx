import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ProjectForm } from './project-form';
import { todayIsoLocal } from './project-form-state';

vi.mock('@/lib/projects/actions', () => ({ createProject: vi.fn(), updateProject: vi.fn() }));

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
