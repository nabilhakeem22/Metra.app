// Is this cookie-authenticated WRITE from one of this site's own pages? The
// browser always sends Origin on a POST, so a missing, opaque ('null') or
// foreign Origin is refused. PURE: reads two request headers only.
export function fromThisSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
