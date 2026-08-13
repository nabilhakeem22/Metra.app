import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import type { ProposalListRow } from '@/lib/proposals/queries';

export async function ProposalsTab({
  projectId,
  proposals,
  canBuild,
}: {
  projectId: string;
  proposals: ProposalListRow[];
  canBuild: boolean;
}) {
  const t = await getTranslations('projects.profile.proposals');
  const tp = await getTranslations('proposals');
  const locale = await getLocale();

  return (
    <div className="space-y-4">
      {canBuild && (
        <div>
          <Link href={`/proposals/new?projectId=${projectId}`}>
            <Button type="button" variant="outline">
              <Plus className="size-4" aria-hidden />
              {t('newForProject')}
            </Button>
          </Link>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {proposals.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                      {formatProposalNumber(
                        p.number,
                        proposalYear(p.issueDate, new Date(p.createdAt)),
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/proposals/${p.id}/view`}
                        className="hover:underline"
                      >
                        {pickLocale(
                          { nameAr: p.titleAr, nameEn: p.titleEn },
                          'name',
                          locale,
                        ).value}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {tp(`statuses.${p.status}`)}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {formatMoney(p.total, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
