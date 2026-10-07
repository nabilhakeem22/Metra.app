import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UPLOAD_STALL_MS } from './put-to-storage';
import { uploadDeliverableFile } from './upload-deliverable';
import { isRetryableOutcome } from './upload-queue-item';

const actions = vi.hoisted(() => ({
  createDeliverableUpload: vi.fn(),
  renewDeliverableUpload: vi.fn(),
  attachDeliverable: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

/** A stand-in XMLHttpRequest the test drives by hand: progress, load, error. */
class FakeRequest {
  static last: FakeRequest | null = null;
  method = '';
  url = '';
  status = 0;
  aborted = false;
  headers: Record<string, string> = {};
  body: unknown = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  answer(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const pdf = new File(['x'.repeat(10)], 'plan.pdf', { type: 'application/pdf' });

/** Lets the awaited signed-URL action settle so the PUT has been sent. */
async function untilSent(): Promise<FakeRequest> {
  await vi.waitFor(() => expect(FakeRequest.last?.body).toBe(pdf));
  const request = FakeRequest.last as FakeRequest;
  FakeRequest.last = null;
  return request;
}

beforeEach(() => {
  FakeRequest.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
  actions.createDeliverableUpload.mockResolvedValue({ signedUrl: 'https://storage.test/put', fileId: 'f-1' });
  actions.renewDeliverableUpload.mockResolvedValue({ signedUrl: 'https://storage.test/again', fileId: 'f-1' });
  actions.attachDeliverable.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('uploadDeliverableFile', () => {
  test('PUTs the file with its headers, reporting each whole percent once', async () => {
    const heard: number[] = [];
    const pending = uploadDeliverableFile('e-1', 'layout', pdf, {
      onProgress: (percent) => heard.push(percent),
    });
    const request = await untilSent();
    expect(request.method).toBe('PUT');
    expect(request.url).toBe('https://storage.test/put');
    expect(request.headers).toEqual({ 'content-type': 'application/pdf', 'x-upsert': 'true' });
    request.progress(2, 5);
    request.progress(2, 5);
    request.progress(5, 5);
    request.answer(200);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(heard).toEqual([40, 100]);
    expect(actions.attachDeliverable).toHaveBeenCalledWith({
      engagementId: 'e-1',
      category: 'layout',
      fileId: 'f-1',
      label: 'plan.pdf',
    });
  });

  test('R3: a slow upload that keeps moving is never cut off; only 30 s with no progress is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = uploadDeliverableFile('e-1', 'layout', pdf);
    const request = await untilSent();
    // Ten minutes of slow but steady progress: no deadline fires.
    for (let second = 20; second <= 600; second += 20) {
      await vi.advanceTimersByTimeAsync(20_000);
      request.progress(second, 600);
    }
    expect(request.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS);
    expect(request.aborted).toBe(true);
    const outcome = await pending;
    expect(outcome).toEqual({ ok: false, reason: 'put_failed', resume: { fileId: 'f-1', stage: 'put' } });
    expect(isRetryableOutcome(outcome)).toBe(true);
    expect(actions.attachDeliverable).not.toHaveBeenCalled();
  });

  test('R3: a retry after a failed PUT reuses the same files row (renew, never a new create)', async () => {
    const pending = uploadDeliverableFile('e-1', 'layout', pdf, {
      resume: { fileId: 'f-1', stage: 'put' },
    });
    (await untilSent()).answer(200);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(actions.createDeliverableUpload).not.toHaveBeenCalled();
    expect(actions.renewDeliverableUpload).toHaveBeenCalledWith({ engagementId: 'e-1', fileId: 'f-1' });
    expect(actions.attachDeliverable).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f-1' }));
  });

  test('R3: a renewal Storage could not sign is retryable on the SAME row', async () => {
    actions.renewDeliverableUpload.mockResolvedValueOnce({ ok: false, error: 'generic' });
    const outcome = await uploadDeliverableFile('e-1', 'layout', pdf, { resume: { fileId: 'f-1', stage: 'put' } });
    expect(outcome).toEqual({ ok: false, reason: 'generic', resume: { fileId: 'f-1', stage: 'put' } });
    expect(isRetryableOutcome(outcome)).toBe(true);
    expect(actions.createDeliverableUpload).not.toHaveBeenCalled();
  });

  test('F5: an attach lost in transport resumes AT the attach, with the same file and no second upload', async () => {
    actions.attachDeliverable.mockRejectedValueOnce(new Error('fetch failed'));
    const first = uploadDeliverableFile('e-1', 'conceptOption', pdf);
    (await untilSent()).answer(200);
    const outcome = await first;
    expect(outcome).toEqual({ ok: false, reason: 'generic', resume: { fileId: 'f-1', stage: 'attach' } });

    const retried = await uploadDeliverableFile('e-1', 'conceptOption', pdf, {
      resume: outcome.ok ? undefined : outcome.resume,
    });
    expect(retried).toEqual({ ok: true });
    expect(actions.createDeliverableUpload).toHaveBeenCalledTimes(1);
    expect(actions.renewDeliverableUpload).not.toHaveBeenCalled();
    expect(actions.attachDeliverable.mock.calls.map((call) => call[0].fileId)).toEqual(['f-1', 'f-1']);
  });

  test('a page that leaves aborts the PUT: aborted, not retryable, nothing attached', async () => {
    const leaving = new AbortController();
    const pending = uploadDeliverableFile('e-1', 'layout', pdf, { signal: leaving.signal });
    const request = await untilSent();
    leaving.abort();
    expect(request.aborted).toBe(true);
    const outcome = await pending;
    expect(outcome).toEqual({ ok: false, reason: 'aborted' });
    expect(isRetryableOutcome(outcome)).toBe(false);
    expect(actions.attachDeliverable).not.toHaveBeenCalled();
  });

  test('an HTTP error status and a network error are both put_failed', async () => {
    const refused = uploadDeliverableFile('e-1', 'layout', pdf);
    (await untilSent()).answer(403);
    await expect(refused).resolves.toMatchObject({ ok: false, reason: 'put_failed' });

    const dropped = uploadDeliverableFile('e-1', 'layout', pdf);
    (await untilSent()).onerror?.();
    await expect(dropped).resolves.toMatchObject({ ok: false, reason: 'put_failed' });
  });

  test('a refused file never asks for a signed URL and is not retryable', async () => {
    const outcome = await uploadDeliverableFile('e-1', 'layout', new File(['x'], 'run.exe'));
    expect(outcome).toEqual({ ok: false, reason: 'wrong_type' });
    expect(isRetryableOutcome(outcome)).toBe(false);
    expect(actions.createDeliverableUpload).not.toHaveBeenCalled();
  });

  test('a coded server refusal is not retryable; a transport rejection before any row is a fresh retry', async () => {
    actions.createDeliverableUpload.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    const coded = await uploadDeliverableFile('e-1', 'layout', pdf);
    expect(coded).toEqual({ ok: false, reason: 'forbidden' });
    expect(isRetryableOutcome(coded)).toBe(false);

    actions.createDeliverableUpload.mockRejectedValueOnce(new Error('network'));
    const transport = await uploadDeliverableFile('e-1', 'layout', pdf);
    expect(transport).toEqual({ ok: false, reason: 'generic', resume: undefined });
    expect(isRetryableOutcome(transport)).toBe(true);
  });
});
