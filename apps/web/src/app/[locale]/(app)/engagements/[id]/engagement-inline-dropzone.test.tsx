import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementInlineDropzone } from './engagement-inline-dropzone';
import { UploadQueueList } from './upload-queue-list';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/en/engagements/e-1',
}));
vi.mock('@/lib/engagements/actions', () => ({ getDeliverableUrl: vi.fn() }));
const toasts = vi.hoisted(() => [] as { title?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string }) => {
    toasts.push(raised);
  },
}));

/** Every upload as a start/end event, so the test can prove they never overlap. */
const timeline = vi.hoisted(() => [] as string[]);
const upload = vi.hoisted(() => vi.fn());
vi.mock('./upload-deliverable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./upload-deliverable')>()),
  uploadDeliverableFile: upload,
}));

afterEach(() => {
  upload.mockReset();
  router.refresh.mockReset();
  timeline.length = 0;
  toasts.length = 0;
});

const en = (path: string) => messageAt('en', path);
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

function deferredUploads() {
  upload.mockImplementation(async (_engagementId: string, _category: string, file: File) => {
    timeline.push(`start ${file.name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    timeline.push(`end ${file.name}`);
    return { ok: true };
  });
}

function renderDropzone(maxFiles?: number) {
  renderWithIntl(
    <EngagementInlineDropzone
      engagementId="e-1"
      category="conceptOption"
      canUpload
      maxFiles={maxFiles}
      label="Attach the concept options"
    />,
    { locale: 'en' },
  );
  return screen.getByRole('button', { name: 'Attach the concept options' });
}

describe('EngagementInlineDropzone', () => {
  test('dropping 3 files with 1 remaining uploads 1 and marks 2 skipped', async () => {
    deferredUploads();
    const zone = renderDropzone(1);
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][2].name).toBe('a.pdf');
    expect(screen.getAllByText(en('engagements.files.status.skipped'))).toHaveLength(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(toasts.at(-1)?.title).toBe('1 of 3 uploaded');
  });

  test('picked files upload strictly one after another', async () => {
    deferredUploads();
    renderDropzone();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(timeline).toEqual([
      'start a.pdf',
      'end a.pdf',
      'start b.pdf',
      'end b.pdf',
      'start c.pdf',
      'end c.pdf',
    ]);
    expect(screen.getAllByText(en('engagements.files.status.done'))).toHaveLength(3);
  });

  test('a refused file says why beside it, never uploads, and the page still refreshes', async () => {
    const zone = renderDropzone();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.exe')] } });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByText(en('engagements.files.status.failed'))).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(en('engagements.files.wrongType'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test('only files that land use a capped slot: [notes.txt, option.pdf] with 1 left uploads option.pdf', async () => {
    deferredUploads();
    const zone = renderDropzone(1);
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('notes.txt'), pdf('option.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][2].name).toBe('option.pdf');
    expect(screen.queryByText(en('engagements.files.status.skipped'))).toBeNull();
  });

  test('a failed upload gives its slot to the next file', async () => {
    upload
      .mockResolvedValueOnce({ ok: false, reason: 'put_failed' })
      .mockResolvedValueOnce({ ok: true });
    const zone = renderDropzone(1);
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf'), pdf('b.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.getByText(en('engagements.files.status.done'))).toBeTruthy();
  });
});

describe('EngagementInlineDropzone retry', () => {
  test('a failed PUT shows Retry, and Retry uploads that one file only', async () => {
    upload
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'put_failed' })
      .mockResolvedValueOnce({ ok: true });
    const zone = renderDropzone();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf'), pdf('b.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const retry = screen.getByRole('button', { name: 'Retry b.pdf' });
    expect(screen.queryByRole('button', { name: en('engagements.files.retryFailed') })).toBeNull();
    await act(async () => {
      fireEvent.click(retry);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2][2].name).toBe('b.pdf');
    expect(screen.getAllByText(en('engagements.files.status.done'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry b.pdf' })).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(toasts.at(-1)?.title).toBe('1 of 1 uploaded');
  });

  test('a refused file (wrong type) and a coded refusal offer no Retry', async () => {
    upload.mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    const zone = renderDropzone();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.exe'), pdf('b.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getAllByText(en('engagements.files.status.failed'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  test('"Retry failed" re-runs the failed transfers in order, against the current cap', async () => {
    upload
      .mockResolvedValueOnce({ ok: false, reason: 'put_failed' })
      .mockResolvedValueOnce({ ok: false, reason: 'generic' })
      .mockResolvedValueOnce({ ok: true });
    const zone = renderDropzone(1);
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf'), pdf('b.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getAllByRole('button', { name: /^Retry [ab]\.pdf$/ })).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en('engagements.files.retryFailed') }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2][2].name).toBe('a.pdf');
    expect(screen.getByText(en('engagements.files.status.done'))).toBeTruthy();
    expect(screen.getByText(en('engagements.files.status.skipped'))).toBeTruthy();
  });

  test('a file uploading shows its progress as a progressbar', async () => {
    let finish: (value: { ok: true }) => void = () => {};
    upload.mockImplementationOnce(
      (_engagementId: string, _category: string, _file: File, onProgress: (percent: number) => void) => {
        onProgress(40);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const zone = renderDropzone();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [pdf('a.pdf')] } });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const bar = screen.getByRole('progressbar', { name: 'a.pdf' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    await act(async () => {
      finish({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('UploadQueueList', () => {
  test('every status has its label in the catalog', () => {
    const statuses = ['queued', 'uploading', 'done', 'failed', 'skipped'] as const;
    renderWithIntl(
      <UploadQueueList
        queue={statuses.map((status) => ({
          key: status,
          name: `${status}.pdf`,
          status,
          message: null,
          progress: null,
          retryable: false,
        }))}
        pending={false}
        onRetry={() => {}}
        onRetryFailed={() => {}}
      />,
      { locale: 'ar-EG' },
    );
    for (const status of statuses) {
      expect(screen.getByText(messageAt('ar-EG', `engagements.files.status.${status}`))).toBeTruthy();
    }
  });
});
