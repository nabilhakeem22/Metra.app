'use client';

import { FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import { galleryImages, listedDocuments } from '@/lib/engagements/portal-gallery';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { DocumentLinks } from './document-links';
import { DocumentThread } from './document-thread';
import { Gallery } from './gallery';

/**
 * Client Deliverables — "Your documents" (anchor `#documents`). The pictures
 * first, as a gallery (./gallery.tsx; Round C), then every other released file,
 * newest share first. Each row shows the friendly category name (never the
 * studio's internal label or the stored filename), the share date, and plain
 * `<a>` links to the tokenized document route (./document-links.tsx): View
 * opens the file in the browser, Download saves it. Normal links, so they work
 * with no JavaScript and the browser follows the redirect to the short-lived
 * signed URL.
 *
 * The card ALWAYS renders: with nothing shared it shows the honest empty copy
 * rather than disappearing, so the client is never left wondering where their files
 * are. `documentUnavailable` surfaces the single, indistinguishable failure the
 * download route redirects back with. Dates use Western numerals; logical CSS only.
 *
 * Step 3 gates what each row OFFERS on the database's access verdict: `download`
 * (the default, and everything once the payments are settled), `view` for an
 * approved render while money is outstanding (a downscaled rendition — the
 * full-resolution file stays in the bucket), and a plain locked note for the BOQ,
 * which is not retrievable at all until settled. A withheld picture is never a
 * tile: it stays a locked row. The button is a REFLECTION of the rule, never the
 * rule: the document route re-reads the same verdict.
 *
 * Step 2 hangs a collapsed comment thread under each row (DocumentThread), and in
 * the lightbox under each picture, so a question about ONE drawing stays attached
 * to that drawing. Advisory: commenting moves no stage.
 */
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
  const listed = listedDocuments(documents);

  return (
    <section id="documents" className="scroll-mt-20 space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <div>
        <h2 className="text-body font-semibold">{t('title')}</h2>
        <p className="text-caption text-muted-foreground">{t('subtitle')}</p>
      </div>

      {documentUnavailable && (
        <p className="rounded-item bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
          {t('unavailable')}
        </p>
      )}

      {documents.length === 0 && <p className="text-caption text-muted-foreground">{t('empty')}</p>}
      <Gallery token={token} images={galleryImages(documents)} />
      {listed.length > 0 && (
        <ul className="space-y-2">
          {listed.map((releasedDocument) => (
            <li
              key={releasedDocument.id}
              className="flex flex-wrap items-center gap-2 rounded-item border p-3"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-body font-medium">
                  {t(`category.${releasedDocument.category}`)}
                </p>
                {releasedDocument.sharedAt && (
                  <p className="text-caption text-muted-foreground">
                    {t('sharedOn', {
                      date: bidiIsolate(formatDate(releasedDocument.sharedAt, locale)),
                    })}
                  </p>
                )}
              </div>
              <DocumentLinks
                token={token}
                documentId={releasedDocument.id}
                access={releasedDocument.access}
              />
              {/* Full-width, so the thread wraps onto its own line under the row. */}
              <DocumentThread
                token={token}
                documentId={releasedDocument.id}
                initialCount={releasedDocument.commentCount}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
