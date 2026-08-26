'use client';

import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EngagementCreateForm } from '../../engagements/engagement-create-form';

/**
 * The project -> delivery hand-off (Slice C3). After `createProject` redirects to
 * `/projects/{id}?created=1`, this offers the next step (start the delivery) as a
 * dismissible glass panel. On mount it reads the one-shot `created` flag, then
 * ALWAYS strips the query param via `replaceState` so refresh/Back can't re-fire;
 * a ref guard keeps it single-shot within the mount. Starting delivery reuses
 * C2's locked `EngagementCreateForm` (same wiring as `project-delivery-panel`),
 * so the interior entitlement + capability gates still fire on submit. Renders
 * nothing unless invited AND the viewer may start a delivery.
 */
export function ProjectCreatedHandoff({
  clientId,
  projectId,
  canStartDelivery,
}: {
  clientId: string;
  projectId: string;
  canStartDelivery: boolean;
}) {
  const t = useTranslations('projects.handoff');
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (searchParams.get('created') === '1' && canStartDelivery) {
      setVisible(true);
    }
    // Strip the param regardless, so refresh/Back can't re-show the panel.
    window.history.replaceState(null, '', window.location.pathname);
  }, [searchParams, canStartDelivery]);

  if (!visible) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Compass className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-sm font-medium">{t('project.title')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setCreating(true)}>
            {t('project.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setVisible(false)}>
            {t('dismiss')}
          </Button>
        </div>
      </CardContent>

      <EngagementCreateForm
        open={creating}
        onOpenChange={setCreating}
        clientOptions={[]}
        projectOptions={[]}
        lockedClientId={clientId}
        lockedProjectId={projectId}
      />
    </Card>
  );
}
