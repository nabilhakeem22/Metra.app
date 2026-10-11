// PURE and CLIENT-SAFE. The seconds a refused portal read is told to wait: the
// period of the portal's Rate Limiting bindings (apps/web/wrangler.jsonc). The
// document and logo routes send it as Retry-After, and a refused gallery tile
// waits this long before its one retry.
export const PORTAL_RETRY_AFTER_SECONDS = 60;
