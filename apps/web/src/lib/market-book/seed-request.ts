// The browser half of the new studio's seed: one POST to the seed route, fired
// and forgotten. A plain fetch, NOT a server action: the App Router queues a
// server action behind the pending ones and, once the wizard has navigated,
// posts it to the NEW page, where its action id is unknown, so it never ran.
// `keepalive` lets the request outlive the navigation. Client-safe.

export const MARKET_SEED_PATH = '/api/price-book/market-seed';

/** Ask the server to seed the signed-in studio's price book. Never throws; its answer is not awaited by anyone. */
export function requestMarketSeed(): void {
  fetch(MARKET_SEED_PATH, { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}
