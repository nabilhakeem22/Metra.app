'use client';

import { Download, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import { formatDate } from '@/lib/format/date';

/**
 * Client Deliverables, Step 1 — "Your documents". Lists the files the studio has
 * released to this client, newest share first. Each row shows the friendly category
 * name (never the studio's internal label or the stored filename), the share date,
 * and a plain `<a>` Download link to the tokenized download route — a normal link,
 * so it works with no JavaScript and the browser handles the redirect to the
 * short-lived signed URL.
 *
 * The card ALWAYS renders: with nothing shared it shows the honest empty copy
 * rather than disappearing, so the client is never left wondering where their files
 * are. `documentUnavailable` surfaces the single, indistinguishable failure the
 * download route redirects back with. Dates use Western numerals; logical CSS only.
 */
/**
 * Wrap a value in Unicode FIRST-STRONG ISOLATE … POP DIRECTIONAL ISOLATE so the
 * bidi algorithm cannot reorder it inside RTL prose. Without this, a Western
 * DD/MM/YYYY date interpolated into the Arabic sentence renders reversed.
 */
function bidiIsolate(value: string): string {
  return `⁨${value}⁩`;
}

export function DocumentsCard({
  token,
  documents,
  documentUnavailable,
}: {
  token: string;
  documents: PublicDelivery['documents'];
  documentUnavailable: boolean;
}) {
  const t = useTranslations('delivery.documents');
  const locale = useLocale();

  return (
    <section className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>

      {documentUnavailable && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {t('unavailable')}
        </p>
      )}

      {documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((releasedDocument) => (
            <li
              key={releasedDocument.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {t(`category.${releasedDocument.category}`)}
                </p>
                {releasedDocument.sharedAt && (
                  <p className="text-xs text-muted-foreground">
                    {t('sharedOn', {
                      date: bidiIsolate(formatDate(releasedDocument.sharedAt, locale)),
                    })}
                  </p>
                )}
              </div>
              <a
                href={`/${locale}/d/${encodeURIComponent(token)}/documents/${releasedDocument.id}`}
                rel="noopener"
                className="ms-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Download className="size-3.5" aria-hidden />
                {t('download')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
