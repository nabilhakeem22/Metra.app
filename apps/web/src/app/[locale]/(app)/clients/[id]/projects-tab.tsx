import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ProjectRow } from '@/lib/projects/queries';

export async function ProjectsTab({
  clientId,
  projects,
  canManage,
}: {
  clientId: string;
  projects: ProjectRow[];
  canManage: boolean;
}) {
  const t = await getTranslations('clients.profile.projects');
  const tp = await getTranslations('projects');
  const locale = await getLocale();

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          <Link href={`/projects?newFor=${clientId}`}>
            <Button type="button" variant="outline">
              <Plus className="size-4" aria-hidden />
              {t('newForClient')}
            </Button>
          </Link>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                      {p.code}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/projects`}
                        className="hover:underline"
                      >
                        {pickLocale(
                          { nameAr: p.nameAr, nameEn: p.nameEn },
                          'name',
                          locale,
                        ).value}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {tp(`statuses.${p.status}`)}
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
