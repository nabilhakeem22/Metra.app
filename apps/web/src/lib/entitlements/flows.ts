// Flow registry (Epic A2). CLIENT-SAFE: a plain constants module with NO
// `server-only` and NO `@metra/db` value import, so it can be shared by client
// components (the type + the list) and server code alike. Each vertical guided
// flow is data here — `interior` is registered; `construction` is a later stub.
// Adding a vertical later = extend FLOWS + grant the entitlement, no restructure.
export const FLOWS = ['interior'] as const;

export type Flow = (typeof FLOWS)[number];
