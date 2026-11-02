import type { MetadataRoute } from 'next';
import { signedInDisallows, tokenDisallows } from '@/lib/seo/private-paths';
import { getSiteUrl } from '@/lib/seo/site-url';

// Pre-rendered at build time and served as a static asset (emit-static-pages),
// so a crawler never spends Worker CPU on it.
//
// Two groups (owner decision D5). Every crawler, AI crawlers included (D7), may
// read the landing pages and none may read a signed-in section. Googlebot and
// Bingbot may also FETCH the token links (/c /d /invite /p /v): they then see
// the noindex header and meta and drop a leaked link from the index, which a
// disallow alone would not do. The login pages stay crawlable for the same
// reason: their noindex has to be seen.
const SEARCH_BOTS = ['Googlebot', 'Bingbot'];

const API_DISALLOW = '/api/';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: [API_DISALLOW, ...signedInDisallows(), ...tokenDisallows()] },
      { userAgent: SEARCH_BOTS, allow: '/', disallow: [API_DISALLOW, ...signedInDisallows()] },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
