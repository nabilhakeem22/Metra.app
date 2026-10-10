// Where the studio's own Settings page loads its saved logo from: the
// /settings/logo route. PURE and CLIENT-SAFE. `v` is the logo's file id, a
// cache key only: a new upload is a new file id, so the browser's private copy
// of the old logo (max-age 240) is never shown in its place.
export function ownLogoPath(locale: string, logoFileId: string): string {
  return `/${locale}/settings/logo?v=${encodeURIComponent(logoFileId)}`;
}
