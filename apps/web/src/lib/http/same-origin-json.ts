import { fromThisSite } from './same-site';

// The JSON body of a cookie-setting POST from one of this site's own pages:
// the same-origin gate server actions gave the sign-in form. A missing or
// foreign Origin, or a body not declared JSON (a cross-site form can send only
// text/plain, urlencoded or multipart without a preflight), is refused before
// the body is read.

export type SameOriginJson = { kind: 'ok'; body: unknown } | { kind: 'forbidden' } | { kind: 'malformed' };

function declaresJson(request: Request): boolean {
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0] ?? '';
  return mediaType.trim().toLowerCase() === 'application/json';
}

export async function readSameOriginJson(request: Request): Promise<SameOriginJson> {
  if (!fromThisSite(request) || !declaresJson(request)) return { kind: 'forbidden' };
  try {
    return { kind: 'ok', body: await request.json() };
  } catch {
    return { kind: 'malformed' };
  }
}
