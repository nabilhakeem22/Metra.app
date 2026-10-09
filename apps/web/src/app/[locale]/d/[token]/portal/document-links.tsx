'use client';

import { Download, Eye, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { DocumentAccess } from '@/lib/engagements/document-access';
import { documentUrl } from './document-url';

const LINK_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill border px-3 text-caption font-semibold hover:bg-muted';

/**
 * What one released document OFFERS, as the database decided (`access`):
 *   - `download`: View (opens in the browser, a new tab) and Download;
 *   - `preview`: View only (the downscaled rendition: the full-resolution file
 *     stays in the bucket while money is outstanding);
 *   - `withheld`: a plain locked note, no link at all.
 * The links are a REFLECTION of the rule, never the rule: the route re-reads the
 * same verdict, so an old URL is refused exactly like a forged one. Plain
 * `<a>`s, so they work with no JavaScript; 44 px targets.
 */
export function DocumentLinks({
  token,
  documentId,
  access,
}: {
  token: string;
  documentId: string;
  access: DocumentAccess;
}) {
  const t = useTranslations('delivery.documents');
  const locale = useLocale();

  if (access === 'withheld') {
    return (
      <span className="ms-auto inline-flex items-center gap-1.5 rounded-pill border border-dashed px-3 py-1.5 text-caption font-medium text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        {t('afterPayment')}
      </span>
    );
  }

  return (
    <div className="ms-auto flex items-center gap-2">
      <a
        href={documentUrl(locale, token, documentId, 'view')}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        <Eye className="size-3.5" aria-hidden />
        {t('view')}
      </a>
      {access === 'download' && (
        <a href={documentUrl(locale, token, documentId)} className={LINK_CLASS}>
          <Download className="size-3.5" aria-hidden />
          {t('download')}
        </a>
      )}
    </div>
  );
}
