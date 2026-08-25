import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/seo/site-url';

// Metra is an auth-gated SaaS: the only genuinely public surface is the
// landing/login page at `/<locale>`. Everything else is private — the authed
// `(app)` trees, onboarding, the `(auth)` OTP step, and the tokenized share
// links (`p`/`c`/`v`/`invite`). Route groups don't appear in the URL, so the
// disallow patterns target the real locale-prefixed paths via a `*` wildcard
// that matches both `en` and `ar-EG`.
export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        // Authed (app) shell
        '/*/dashboard',
        '/*/clients',
        '/*/contracts',
        '/*/projects',
        '/*/proposals',
        '/*/price-book',
        '/*/engagements',
        '/*/team',
        '/*/settings',
        '/*/notifications',
        // Onboarding + auth OTP steps
        '/*/onboarding',
        '/*/login',
        // Tokenized public share links
        '/*/p/',
        '/*/c/',
        '/*/v/',
        '/*/invite/',
      ],
    },
    host: baseUrl,
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
