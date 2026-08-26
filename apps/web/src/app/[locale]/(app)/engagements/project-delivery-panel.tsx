'use client';

import { ArrowRight, Compass, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { ProjectDeliverySummary } from '@/lib/engagements/queries';
import { isTerminal } from '@/lib/engagements/states';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { EngagementCreateForm } from './engagement-create-form';
import { StateBadge } from './state-badge';

/**
 * The through-project entry point to a Delivery (Slice C2 + C2-hardening). Rendered
 * on the project overview; renders four states from the serialized `delivery`
 * summary + `deliveryCount` (the project's NON-abandoned delivery count):
 *   (a) an ACTIVE delivery -> "Open delivery" (its DE number + stage badge), no CTA
 *       (a project holds at most one in-flight delivery);
 *   (b) no delivery -> "Start delivery" (opens the locked create form);
 *   (c) a TERMINAL delivery below the lifetime cap (`deliveryCount < 2`) ->
 *       "Open delivery" (the terminal one) + a "Start extension" CTA (the SAME
 *       locked create form — original + one extension);
 *   (d) a TERMINAL delivery at the cap (`deliveryCount >= 2`) -> "Open delivery",
 *       no CTA, and the at-limit note.
 * `clientId`/`projectId` fix the locked form; the create path is the SAME
 * `createEngagement` action, so the interior entitlement + capability gates still
 * fire server-side and the cap is re-checked atomically there.
 */
export function ProjectDeliveryPanel({
  delivery,
  deliveryCount,
  clientId,
  projectId,
  canStartDelivery,
}: {
  delivery: ProjectDeliverySummary | null;
  deliveryCount: number;
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

  const terminal = delivery ? isTerminal(delivery.state) : false;
  // A terminal delivery below the cap may start the project's ONE extension;
  // at/above the cap it is locked (owner rule: at most two NON-abandoned deliveries).
  const canExtend = terminal && deliveryCount < 2;
  const atLimit = terminal && deliveryCount >= 2;
  // The locked create form powers both "Start delivery" (no delivery yet) and
  // "Start extension" (a terminal delivery below the cap) — one C2 create path.
  const canCreate = canStartDelivery && (!delivery || canExtend);

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
            {atLimit && (
              <p className="mt-1 text-xs text-muted-foreground">{t('atLimit')}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {delivery && (
            <Button asChild variant="outline">
              <Link href={`/engagements/${delivery.id}`}>
                {t('open')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {delivery ? t('extend') : t('start')}
            </Button>
          )}
        </div>
      </CardContent>

      {canCreate && (
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
