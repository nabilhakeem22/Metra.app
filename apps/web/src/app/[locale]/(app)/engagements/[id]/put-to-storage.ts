// The browser half of a deliverable upload: PUT the file to its signed Storage
// URL through XMLHttpRequest, the one browser API that reports upload progress.
// PURE of React and of server actions.
//
// The deadline is a STALL deadline, not a total one: the PUT is abandoned only
// after UPLOAD_STALL_MS with no progress at all. A whole-transfer deadline failed
// every file larger than (uplink x deadline), 68% sent, again on every retry.

/** No byte sent (or, once all are sent, no answer) for this long: give up. */
export const UPLOAD_STALL_MS = 30_000;

/** Whole percent of the file sent so far, 0..100. */
export type UploadProgressListener = (percent: number) => void;

export type PutResult = 'ok' | 'failed' | 'aborted';

/**
 * Resolves 'ok' on a 2xx; 'failed' on an HTTP error, a dropped network or a
 * stall; 'aborted' when `signal` aborted it (the page that asked has gone). The
 * listener hears each whole percent once.
 */
export function putToStorage(
  signedUrl: string,
  file: File,
  options: { onProgress?: UploadProgressListener; signal?: AbortSignal } = {},
): Promise<PutResult> {
  const { onProgress, signal } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted');
      return;
    }
    const request = new XMLHttpRequest();
    let lastPercent = -1;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: PutResult) => {
      clearTimeout(stallTimer);
      signal?.removeEventListener('abort', onAbortSignal);
      resolve(result);
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => request.abort(), UPLOAD_STALL_MS);
    };
    function onAbortSignal() {
      request.abort();
    }
    request.onload = () => settle(request.status >= 200 && request.status < 300 ? 'ok' : 'failed');
    request.onerror = () => settle('failed');
    request.onabort = () => settle(signal?.aborted ? 'aborted' : 'failed');
    request.upload.onprogress = (event) => {
      armStall();
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      if (percent === lastPercent) return;
      lastPercent = percent;
      onProgress(percent);
    };
    // Every byte is out: the stall clock now waits for Storage's answer.
    request.upload.onload = armStall;
    signal?.addEventListener('abort', onAbortSignal, { once: true });
    try {
      request.open('PUT', signedUrl);
      request.setRequestHeader('content-type', file.type);
      request.setRequestHeader('x-upsert', 'true');
      request.send(file);
      armStall();
    } catch {
      // A malformed URL or a refused header: the same outcome as a dropped network.
      settle('failed');
    }
  });
}
