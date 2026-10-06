import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ClientCreatedHandoff } from './client-created-handoff';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams('created=1'),
}));
vi.mock('@/lib/projects/actions', () => ({ createProject: vi.fn(), updateProject: vi.fn() }));

const en = (path: string) => messageAt('en', path);
const CLIENT = { id: 'c-1', nameEn: 'Acme', nameAr: null, city: 'Giza', country: 'Egypt' };

describe('ClientCreatedHandoff', () => {
  test('opens the project form in place, for this client, with its location', () => {
    renderWithIntl(<ClientCreatedHandoff client={CLIENT} clientName="Acme" canCreateProject />, {
      locale: 'en',
    });
    expect(screen.queryAllByRole('link').some((link) => link.getAttribute('href')?.includes('newFor'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: en('clients.handoff.client.confirm') }));
    expect(screen.getByText(en('projects.form.newTitle'), { selector: 'h2' })).toBeTruthy();
    expect((document.getElementById('pr-city') as HTMLInputElement).value).toBe('Giza');
    expect(document.getElementById('pr-client')?.textContent).toContain('Acme');
  });
});
