// Shared validation constants for the contract-core operations. Internal to the
// `core/` folder — NOT part of the `@/lib/contracts/core` public surface.

/** Canonical UUID shape used to reject malformed ids before hitting the DB. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
