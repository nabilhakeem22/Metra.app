import { getSiteUrl } from '@/lib/seo/site-url';

interface StructuredDataProps {
  locale: string;
  /** Localized one-line product description (shared with the meta description). */
  description: string;
}

/**
 * Server-rendered JSON-LD: an Organization plus the SoftwareApplication it
 * publishes. Prices are "0" during early access. URLs are absolute, built from
 * the public site URL. Emitted as a raw <script> so crawlers read it verbatim.
 */
export function StructuredData({ locale, description }: StructuredDataProps) {
  const siteUrl = getSiteUrl();
  const organizationId = `${siteUrl}/#organization`;

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'Metra',
        url: siteUrl,
        logo: `${siteUrl}/icon.svg`,
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Metra',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description,
        inLanguage: ['en', 'ar-EG'],
        url: `${siteUrl}/${locale}`,
        publisher: { '@id': organizationId },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EGP',
          availability: 'https://schema.org/InStock',
          description: 'Free during early access',
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; no user input is interpolated.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
