import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileApi } from './turnstile-loader';

// AC16: one Turnstile script per page, however often it is asked for. A DOM
// test (.tsx, happy-dom). The script is captured at document.head.appendChild
// and never really inserted, so no test reaches challenges.cloudflare.com; its
// load and error events are fired by hand. Each test loads a fresh module.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const fakeApi: TurnstileApi = { render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() };

let appended: HTMLScriptElement[];
beforeEach(() => {
  vi.resetModules();
  delete window.turnstile;
  appended = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    appended.push(node as unknown as HTMLScriptElement);
    return node;
  });
});
afterEach(() => vi.restoreAllMocks());

const freshLoader = async () => (await import('./turnstile-loader')).loadTurnstile;

describe('loadTurnstile', () => {
  it('injects one async script at the exact Cloudflare URL for two calls, and resolves both on load', async () => {
    const loadTurnstile = await freshLoader();
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(appended).toHaveLength(1);
    expect(appended[0]!.src).toBe(SCRIPT_URL);
    expect(appended[0]!.async).toBe(true);
    window.turnstile = fakeApi;
    appended[0]!.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(fakeApi);
    await expect(second).resolves.toBe(fakeApi);
  });

  it('a remount after the load asks for no second script', async () => {
    const loadTurnstile = await freshLoader();
    const first = loadTurnstile();
    window.turnstile = fakeApi;
    appended[0]!.dispatchEvent(new Event('load'));
    await first;
    await expect(loadTurnstile()).resolves.toBe(fakeApi);
    expect(appended).toHaveLength(1);
  });

  it('reuses a turnstile already on the page without injecting', async () => {
    window.turnstile = fakeApi;
    const loadTurnstile = await freshLoader();
    await expect(loadTurnstile()).resolves.toBe(fakeApi);
    expect(appended).toHaveLength(0);
  });

  it('rejects when the script fails to load, and stays rejected without a second script', async () => {
    const loadTurnstile = await freshLoader();
    const first = loadTurnstile();
    appended[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('turnstile script failed to load');
    await expect(loadTurnstile()).rejects.toThrow('turnstile script failed to load');
    expect(appended).toHaveLength(1);
  });

  it('rejects when the script loads without window.turnstile', async () => {
    const loadTurnstile = await freshLoader();
    const first = loadTurnstile();
    appended[0]!.dispatchEvent(new Event('load'));
    await expect(first).rejects.toThrow('without window.turnstile');
  });
});
