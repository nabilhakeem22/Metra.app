import { Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/** Placeholder — activates with project roles (next slice). No demo data. */
export async function TeamTab() {
  const t = await getTranslations('projects.profile.team');
  return (
    <Card>
      <CardContent className="py-4">
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('lockedTitle')}
          description={t('lockedBody')}
        />
      </CardContent>
    </Card>
  );
}
