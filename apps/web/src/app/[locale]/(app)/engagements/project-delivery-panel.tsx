'use client';

import { ArrowRight, Compass, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { projectDeliveryOffer } from '@/lib/engagements/project-delivery-offer';
import type { ProjectDeliverySummary } from '@/lib/engagements/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { EngagementCreateForm } from './engagement-create-form';
import { StateBadge } from './state-badge';

/**
 * The through-project entry point to a Delivery (Slice C2 + C2-hardening). Rendered
 * on the project overview from the serialized `delivery` summary, and what it
 * offers is lib/engagements/project-delivery-offer.ts:
 *   (a) a delivery of this client that is not abandoned -> "Open delivery" (its DE
 *       number + stage badge), no CTA: a client on a project has one delivery;
 *   (b) none, an abandoned one, or a finished one of another client -> "Start
 *       delivery" (opens the locked create form).
 * A light delivery is headed as the client page of the execution contract,
 * never as a design delivery.
 * `clientId`/`projectId` fix the locked form; the create path is the SAME
 * `createEngagement` action, so the interior entitlement + capability gates still
 * fire server-side and the one-delivery rule is re-checked there.
 */
export function ProjectDeliveryPanel({
  delivery,
  clientId,
  projectId,
  projectName,
  canStartDelivery,
  highlighted = false,
}: {
  delivery: ProjectDeliverySummary | null;
  clientId: string;
  projectId: string;
  /** The project's names: an untitled delivery takes them (the form prefills them). */
  projectName: { nameEn: string | null; nameAr: string | null };
  canStartDelivery: boolean;
  /** Spec: on the project page this panel sits above the tabs as THE entry point to
   *  the design process, so it is given brand emphasis. Elsewhere it stays a plain
   *  card. Emphasis only — the affordances are identical either way. */
  highlighted?: boolean;
}) {
  const t = useTranslations('engagements.projectPanel');
  const tStart = useTranslations('engagements');
  const locale = useLocale();
  const [creating, setCreating] = useState(false);

  const title = delivery
    ? pickLocale(
        { nameAr: delivery.titleAr, nameEn: delivery.titleEn },
        'name',
        locale,
      ).value
    : '';

  const offer = projectDeliveryOffer(delivery, clientId);
  const canCreate = canStartDelivery && offer.create !== null;

  return (
    <Card
      className={
        highlighted
          ? 'border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)]'
          : undefined
      }
    >
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Compass
            className={`size-5 shrink-0 ${highlighted ? 'text-brand-ink' : 'text-muted-foreground'}`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">{t(offer.heading)}</p>
            {delivery ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-body" dir="ltr">
                  {formatDocNumber('DE', delivery.number, docYear(null, delivery.createdAt))}
                </span>
                {title && <span className="truncate text-body">{title}</span>}
                <StateBadge state={delivery.state} showStage />
              </div>
            ) : (
              <p className="mt-1 text-body text-muted-foreground">{t('none')}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {delivery && (
            <Button asChild variant={highlighted ? 'default' : 'secondary'}>
              <Link href={`/engagements/${delivery.id}`}>
                {t('open')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </Button>
          )}
          {canCreate && (
            <Button variant={delivery ? 'secondary' : 'default'} onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {tStart('startDelivery')}
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
          lockedProjectName={projectName}
        />
      )}
    </Card>
  );
}
