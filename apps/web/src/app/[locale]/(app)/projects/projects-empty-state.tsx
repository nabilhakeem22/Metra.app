'use client';

import { FolderKanban, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';

/**
 * No projects yet. With no client either, it says a project needs one and
 * links to adding the client (for a role that may); otherwise it offers the
 * new-project form.
 */
export function ProjectsEmptyState({
  hasClients,
  canManage,
  canAddClient,
  onNew,
}: {
  hasClients: boolean;
  canManage: boolean;
  canAddClient: boolean;
  onNew: () => void;
}) {
  const t = useTranslations('projects');
  let action;
  if (canManage && hasClients) {
    action = (
      <Button data-tour="projects-new" onClick={onNew}>
        <Plus className="size-4" aria-hidden />
        {t('actions.new')}
      </Button>
    );
  } else if (!hasClients && canAddClient) {
    action = (
      <Button asChild>
        <Link href="/clients?new=1">{t('empty.addClient')}</Link>
      </Button>
    );
  }
  return (
    <Card>
      <CardContent className="py-4">
        <EmptyState
          icon={<FolderKanban className="size-6" aria-hidden />}
          title={t('empty.title')}
          description={t('empty.description')}
          hint={hasClients ? undefined : t('empty.needClient')}
          action={action}
        />
      </CardContent>
    </Card>
  );
}
