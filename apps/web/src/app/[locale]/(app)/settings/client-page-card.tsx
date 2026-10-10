'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-label';
import { CLIENT_PAGE_FIELD_SPECS, type ClientPageDraft } from './client-page-fields';
import { ClientPageSheet } from './client-page-sheet';

/**
 * "What your clients see" (Round C, C8): the phone, WhatsApp and payment
 * details the client's delivery page shows. Every member who can open Settings
 * reads them; only an owner or admin (`canManage`) gets Edit, which opens the
 * form sheet. `id="client-page"` is the setup checklist's and the
 * payment-details alert's anchor.
 */
export function ClientPageCard({
  canManage,
  details,
  revision,
}: {
  canManage: boolean;
  details: ClientPageDraft;
  /** The stored values' revision, for the sheet's stale-save check. */
  revision: string;
}) {
  const t = useTranslations('settings.clientPage');
  const [editing, setEditing] = useState(false);

  return (
    <Card id="client-page" className="scroll-mt-24">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </div>
        {canManage && (
          <Button variant="secondary" className="min-h-11 shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
            {t('edit')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        {(['contact', 'payment'] as const).map((group) => (
          <div key={group} className="space-y-3">
            <SectionLabel as="h3">{t(group === 'contact' ? 'contactHeading' : 'paymentHeading')}</SectionLabel>
            <dl className="space-y-2">
              {CLIENT_PAGE_FIELD_SPECS.filter((spec) => spec.group === group).map((spec) => (
                <div key={spec.field} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="text-body text-muted-foreground">{t(`fields.${spec.field}`)}</dt>
                  <dd className="text-body font-medium">
                    {details[spec.field] ? (
                      <bdi dir={spec.ltr ? 'ltr' : 'auto'} className={spec.ltr ? 'tabular-nums' : undefined}>
                        {details[spec.field]}
                      </bdi>
                    ) : (
                      <span className="text-muted-foreground">{t('notSet')}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </CardContent>
      {canManage && <ClientPageSheet open={editing} onOpenChange={setEditing} initial={details} revision={revision} />}
    </Card>
  );
}
