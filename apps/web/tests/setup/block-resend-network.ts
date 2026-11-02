// Tests must NEVER call Resend. Every email test mocks the SDK, and a mock that
// silently fails to apply sends a real request with a fake key: CI once got a
// 401 back from api.resend.com. This setup file wraps the global fetch so such a
// request is refused before it leaves the process, and fails the test that made
// it even when the code under test swallows the refusal (a send never throws).
import { afterEach } from 'vitest';

const RESEND_API_HOST = 'api.resend.com';
const realFetch = globalThis.fetch;
let blockedResendUrl: string | undefined;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function isResendApi(url: string): boolean {
  return URL.canParse(url) && new URL(url).hostname === RESEND_API_HOST;
}

globalThis.fetch = (input, init) => {
  const url = requestUrl(input);
  if (isResendApi(url)) {
    blockedResendUrl = url;
    return Promise.reject(new Error(`Blocked a test request to ${url}: tests must never call Resend.`));
  }
  return realFetch(input, init);
};

afterEach(() => {
  if (blockedResendUrl === undefined) return;
  const url = blockedResendUrl;
  blockedResendUrl = undefined;
  throw new Error(`This test tried to reach the real Resend API (${url}); the request was blocked. Mock 'resend' so that it applies.`);
});
