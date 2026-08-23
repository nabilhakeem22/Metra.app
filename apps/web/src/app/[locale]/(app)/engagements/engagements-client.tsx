'use client';

import { Compass, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ClientOption } from '@/lib/clients/queries';
import type { EngagementListRow } from '@/lib/engagements/queries';
import {
  EngagementCreateForm,
  type ProjectOption,
} from './engagement-create-form';
import { StateBadge } from './state-badge';

export function EngagementsClient({
  items,
  clientOptions,
  projectOptions,
  canCreate,
}: {
  items: EngagementListRow[];
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
  canCreate: boolean;
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const [creating, setCreating] = useState(false);

  const newButton = canCreate && (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden />
      {t('new')}
    </Button>
  );

  return (
    <div className="space-y-4">
      {newButton && <div className="flex"><div className="ms-auto">{newButton}</div></div>}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<Compass className="size-6" aria-hidden />}
              title={t('title')}
              description={t('empty')}
              action={newButton || undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-start font-medium">{t('number')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('engagement')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('client')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('project')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('state.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                        <Link
                          href={`/engagements/${e.id}`}
                          className="text-primary hover:underline"
                        >
                          {formatDocNumber('DE', e.number, docYear(null, e.createdAt))}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        {pickLocale({ nameAr: e.titleAr, nameEn: e.titleEn }, 'name', locale)
                          .value || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {pickLocale(
                          { nameAr: e.clientNameAr, nameEn: e.clientNameEn },
                          'name',
                          locale,
                        ).value || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {pickLocale(
                          { nameAr: e.projectNameAr, nameEn: e.projectNameEn },
                          'name',
                          locale,
                        ).value || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <StateBadge state={e.state} showStage />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {canCreate && (
        <EngagementCreateForm
          open={creating}
          onOpenChange={setCreating}
          clientOptions={clientOptions}
          projectOptions={projectOptions}
        />
      )}
    </div>
  );
}
