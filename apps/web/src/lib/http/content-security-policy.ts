import { TURNSTILE_ORIGIN } from '@/lib/auth/turnstile';

// The Content Security Policy, as data (S6, go-live security). PURE, no Next
// import: lib/http/security-headers.ts decides who gets it, public/_headers
// carries the static-asset copy (src/test/static-headers.test.ts keeps them equal).
//
// TWO POLICIES, on purpose (owner decision D1):
// - ENFORCED: the four directives that cannot break a Next app with inline
//   scripts. frame-ancestors is IGNORED in a Report-Only policy, so it only
//   counts when enforced.
// - REPORT-ONLY: the full fetch policy. Nonces are impossible (the landing and
//   login pages are static assets), and there is no report endpoint (one would
//   cost Worker CPU and be an unauthenticated write sink): a violation shows in
//   the browser console. It is enforced once a console walk and a week of use
//   show none.
//
// Why each extra source: the Supabase origin in connect-src is the browser PUT to
// a signed upload URL, in img-src a paid client's lightbox 302 to a signed URL;
// blob: images are logo previews; data: fonts are the proposal preview's srcDoc
// iframe, which inherits this policy; 'unsafe-inline' scripts are the Next RSC
// payload and the public/index.html locale redirector. The Turnstile origin in
// script-src and frame-src is the sign-in widget's api.js and its iframe; only
// the login pages use it, so only their policy carries it ({ turnstile: true }).

/** Enforced now: cannot break a Next app with inline scripts. frame-ancestors only works when enforced. */
export const ENFORCED_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

interface Directive {
  name: string;
  sources: string;
  /** Takes the extra origins (the Supabase project) after its own sources. */
  extraOrigins?: true;
  /** Takes the Turnstile origin, for the login pages only. */
  turnstile?: true;
}

const REPORT_ONLY_DIRECTIVES: readonly Directive[] = [
  { name: 'default-src', sources: "'self'" },
  { name: 'script-src', sources: "'self' 'unsafe-inline'", turnstile: true },
  { name: 'style-src', sources: "'self' 'unsafe-inline'" },
  { name: 'img-src', sources: "'self' data: blob:", extraOrigins: true },
  { name: 'font-src', sources: "'self' data:" },
  { name: 'connect-src', sources: "'self'", extraOrigins: true },
  { name: 'frame-src', sources: "'self'", turnstile: true },
  { name: 'worker-src', sources: "'self'" },
  { name: 'manifest-src', sources: "'self'" },
  { name: 'base-uri', sources: "'self'" },
  { name: 'object-src', sources: "'none'" },
  { name: 'form-action', sources: "'self'" },
];

/** Report-Only until D1 flips it. extraOrigins = [Supabase origin] on Worker pages, [] on static assets. */
export function reportOnlyCsp(extraOrigins: readonly string[], { turnstile = false }: { turnstile?: boolean } = {}): string {
  return REPORT_ONLY_DIRECTIVES.map(({ name, sources, extraOrigins: takesExtra, turnstile: takesTurnstile }) =>
    [name, sources, ...(takesTurnstile && turnstile ? [TURNSTILE_ORIGIN] : []), ...(takesExtra ? extraOrigins : [])].join(' '),
  ).join('; ');
}
