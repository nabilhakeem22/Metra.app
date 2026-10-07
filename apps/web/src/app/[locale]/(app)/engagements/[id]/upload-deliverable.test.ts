import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UPLOAD_TIMEOUT_MS, uploadDeliverableFile } from './upload-deliverable';
import { isRetryableOutcome } from './upload-queue-item';

const actions = vi.hoisted(() => ({
  createDeliverableUpload: vi.fn(),
  attachDeliverable: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

/** A stand-in XMLHttpRequest the test drives by hand: progress, load, timeout. */
class FakeRequest {
  static last: FakeRequest | null = null;
  method = '';
  url = '';
  timeout = 0;
  status = 0;
  headers: Record<string, string> = {};
  body: unknown = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
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
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
}

const pdf = new File(['x'.repeat(10)], 'plan.pdf', { type: 'application/pdf' });

/** Lets the awaited signed-URL action settle so the PUT has been sent. */
async function untilSent(): Promise<FakeRequest> {
  await vi.waitFor(() => expect(FakeRequest.last?.body).toBe(pdf));
  return FakeRequest.last as FakeRequest;
}

beforeEach(() => {
  FakeRequest.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
  actions.createDeliverableUpload.mockResolvedValue({ signedUrl: 'https://storage.test/put', fileId: 'f-1' });
  actions.attachDeliverable.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('uploadDeliverableFile', () => {
  test('PUTs the file with its headers and the deadline, reporting each whole percent once', async () => {
    const heard: number[] = [];
    const pending = uploadDeliverableFile('e-1', 'layout', pdf, (percent) => heard.push(percent));
    const request = await untilSent();
    expect(request.method).toBe('PUT');
    expect(request.url).toBe('https://storage.test/put');
    expect(request.timeout).toBe(UPLOAD_TIMEOUT_MS);
    expect(request.headers).toEqual({ 'content-type': 'application/pdf', 'x-upsert': 'true' });
    request.progress(2, 5);
    request.progress(2, 5);
    request.progress(5, 5);
    request.status = 200;
    request.onload?.();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(heard).toEqual([40, 100]);
    expect(actions.attachDeliverable).toHaveBeenCalledWith({
      engagementId: 'e-1',
      category: 'layout',
      fileId: 'f-1',
      label: 'plan.pdf',
    });
  });

  test('a timed-out PUT is put_failed, never attached, and retryable', async () => {
    const pending = uploadDeliverableFile('e-1', 'layout', pdf);
    (await untilSent()).ontimeout?.();
    const outcome = await pending;
    expect(outcome).toEqual({ ok: false, reason: 'put_failed' });
    expect(isRetryableOutcome(outcome)).toBe(true);
    expect(actions.attachDeliverable).not.toHaveBeenCalled();
  });

  test('an HTTP error status and a network error are both put_failed', async () => {
    const refused = uploadDeliverableFile('e-1', 'layout', pdf);
    const request = await untilSent();
    request.status = 403;
    request.onload?.();
    await expect(refused).resolves.toEqual({ ok: false, reason: 'put_failed' });

    FakeRequest.last = null;
    const dropped = uploadDeliverableFile('e-1', 'layout', pdf);
    (await untilSent()).onerror?.();
    await expect(dropped).resolves.toEqual({ ok: false, reason: 'put_failed' });
  });

  test('a refused file never asks for a signed URL and is not retryable', async () => {
    const outcome = await uploadDeliverableFile('e-1', 'layout', new File(['x'], 'run.exe'));
    expect(outcome).toEqual({ ok: false, reason: 'wrong_type' });
    expect(isRetryableOutcome(outcome)).toBe(false);
    expect(actions.createDeliverableUpload).not.toHaveBeenCalled();
  });

  test('a coded server refusal is not retryable; a transport rejection is', async () => {
    actions.createDeliverableUpload.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    const coded = await uploadDeliverableFile('e-1', 'layout', pdf);
    expect(coded).toEqual({ ok: false, reason: 'forbidden' });
    expect(isRetryableOutcome(coded)).toBe(false);

    actions.createDeliverableUpload.mockRejectedValueOnce(new Error('network'));
    const transport = await uploadDeliverableFile('e-1', 'layout', pdf);
    expect(transport).toEqual({ ok: false, reason: 'generic' });
    expect(isRetryableOutcome(transport)).toBe(true);
  });
});
