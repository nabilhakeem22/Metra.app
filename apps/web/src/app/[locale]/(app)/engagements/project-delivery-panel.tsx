'use client';

import { ArrowRight, Compass, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { ProjectDeliverySummary } from '@/lib/engagements/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { EngagementCreateForm } from './engagement-create-form';
import { StateBadge } from './state-badge';

/**
 * The through-project entry point to a Delivery (Slice C2). Rendered on the project
 * overview: when the project already has a current Delivery it offers "Open delivery"
 * (its DE number + stage badge, linking to the cockpit); otherwise it offers "Start
 * delivery", which opens the locked create form (client + project fixed to this
 * project). `delivery` is the serialized summary the server page loaded; `clientId`
 * and `projectId` fix the locked form. The create path is the SAME `createEngagement`
 * action — the interior entitlement + capability gates still fire server-side.
 */
export function ProjectDeliveryPanel({
  delivery,
  clientId,
  projectId,
  canStartDelivery,
}: {
  delivery: ProjectDeliverySummary | null;
  clientId: string;
  projectId: string;
  canStartDelivery: boolean;
}) {
  const t = useTranslations('engagements.projectPanel');
  const locale = useLocale();
  const [creating, setCreating] = useState(false);

  const title = delivery
    ? pickLocale(
        { nameAr: delivery.titleAr, nameEn: delivery.titleEn },
        'name',
        locale,
      ).value
    : '';

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Compass className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t('heading')}</p>
            {delivery ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm" dir="ltr">
                  {formatDocNumber('DE', delivery.number, docYear(null, delivery.createdAt))}
                </span>
                {title && <span className="truncate text-sm">{title}</span>}
                <StateBadge state={delivery.state} showStage />
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t('none')}</p>
            )}
          </div>
        </div>

        {delivery ? (
          <Button asChild variant="outline">
            <Link href={`/engagements/${delivery.id}`}>
              {t('open')}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        ) : (
          canStartDelivery && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('start')}
            </Button>
          )
        )}
      </CardContent>

      {!delivery && canStartDelivery && (
        <EngagementCreateForm
          open={creating}
          onOpenChange={setCreating}
          clientOptions={[]}
          projectOptions={[]}
          lockedClientId={clientId}
          lockedProjectId={projectId}
        />
      )}
    </Card>
  );
}
