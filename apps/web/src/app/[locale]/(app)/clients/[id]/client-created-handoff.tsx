'use client';

import { FolderPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProjectForm } from '../../projects/project-form';
import type { ClientOption } from '../../projects/types';

/**
 * The client -> project hand-off (Slice C3). After `createClient` redirects to
 * `/clients/{id}?created=1`, this offers the next step (create a project for the
 * new client) as a dismissible glass panel, and opens the project form RIGHT
 * HERE with this client preselected (no detour through the projects list). On mount it reads the one-shot
 * `created` flag, then ALWAYS strips the query param via `replaceState` so a
 * refresh or Back never re-fires the panel; a ref guard keeps it single-shot
 * within the mount. Renders nothing unless it was invited AND the viewer may
 * create projects.
 */
export function ClientCreatedHandoff({
  client,
  clientName,
  canCreateProject,
}: {
  /** The new client, as the project form's one option (its location prefills the project). */
  client: ClientOption;
  clientName: string;
  canCreateProject: boolean;
}) {
  const t = useTranslations('clients.handoff');
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (searchParams.get('created') === '1' && canCreateProject) {
      setVisible(true);
    }
    // Strip the param regardless, so refresh/Back can't re-show the panel.
    window.history.replaceState(null, '', window.location.pathname);
  }, [searchParams, canCreateProject]);

  if (!visible) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <FolderPlus className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-sm font-medium">
            {t('client.title', { name: clientName })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setCreating(true)}>
            {t('client.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setVisible(false)}>
            {t('dismiss')}
          </Button>
        </div>
      </CardContent>
      <ProjectForm
        open={creating}
        onOpenChange={setCreating}
        clientOptions={[client]}
        defaultClientId={client.id}
      />
    </Card>
  );
}
