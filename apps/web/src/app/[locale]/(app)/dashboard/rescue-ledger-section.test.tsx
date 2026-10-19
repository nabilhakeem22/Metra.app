import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { shapeRescueLedger } from '@/lib/dashboard/rescue-ledger/shape';
import { messageAt, renderWithIntl, TEST_NOW } from '@/test/render-with-intl';
import { RescueLedgerSection } from './rescue-ledger-section';

// The island: one GET of its own route on mount, a skeleton meanwhile, the
// ledger on success, and on a failure the failure line with a retry that works.

const en = (path: string) => messageAt('en', path);
const LEDGER = shapeRescueLedger([], 12, TEST_NOW);
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const render = () => renderWithIntl(<RescueLedgerSection range={12} orgId="org-1" />, { locale: 'en' });

describe('RescueLedgerSection', () => {
  test('asks its own route for the window, never cached, and shows a skeleton until it answers', async () => {
    fetchMock.mockReturnValue(json(200, { ok: true, ledger: LEDGER }));
    render();
    expect(screen.getByLabelText(en('dashboard.rescue.loading'))).toBeTruthy();
    expect(await screen.findByText(en('dashboard.rescue.title'))).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/dashboard/rescue-ledger?range=12&org=org-1');
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });

  test('a 500 shows the failure line, and retry fetches again and shows the ledger', async () => {
    fetchMock.mockReturnValueOnce(json(500, { ok: false, error: 'generic', reference: 'ABC123' }));
    fetchMock.mockReturnValueOnce(json(200, { ok: true, ledger: LEDGER }));
    render();
    expect((await screen.findByRole('alert')).textContent).toContain(en('dashboard.rescue.loadFailed'));
    fireEvent.click(screen.getByRole('button', { name: en('dashboard.rescue.retry') }));
    expect(await screen.findByText(en('dashboard.rescue.title'))).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a network failure or a body that is not JSON is a failure too', async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new TypeError('network')));
    render();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('<html>', { status: 502 })));
    fireEvent.click(screen.getByRole('button', { name: en('dashboard.rescue.retry') }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  test('past the read budget it says to wait, and retry asks again', async () => {
    fetchMock.mockReturnValueOnce(json(429, { ok: false, error: 'rate_limited' }));
    fetchMock.mockReturnValueOnce(json(200, { ok: true, ledger: LEDGER }));
    render();
    expect((await screen.findByRole('alert')).textContent).toContain(en('dashboard.rescue.rateLimited'));
    fireEvent.click(screen.getByRole('button', { name: en('dashboard.rescue.retry') }));
    expect(await screen.findByText(en('dashboard.rescue.title'))).toBeTruthy();
  });

  test('a workspace switched in another tab offers a reload, never the other figures', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    fetchMock.mockReturnValue(json(409, { ok: false, error: 'workspace_changed' }));
    render();
    expect((await screen.findByRole('alert')).textContent).toContain(en('dashboard.rescue.workspaceChanged'));
    fireEvent.click(screen.getByRole('button', { name: en('dashboard.rescue.reload') }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en('dashboard.rescue.title'))).toBeNull();
  });

  test('a refusal renders nothing at all', async () => {
    fetchMock.mockReturnValue(json(403, { ok: false, error: 'forbidden' }));
    const { container } = render();
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
