'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createEngagement } from '@/lib/engagements/actions';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ClientOption } from '@/lib/clients/queries';

export interface ProjectOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
}

export function EngagementCreateForm({
  open,
  onOpenChange,
  clientOptions,
  projectOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
}) {
  const t = useTranslations('engagements.form');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [clientId, setClientId] = useState(clientOptions[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [offPlan, setOffPlan] = useState(false);

  // Only projects belonging to the chosen client are selectable.
  const projectsForClient = useMemo(
    () => projectOptions.filter((p) => p.clientId === clientId),
    [projectOptions, clientId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitleEn('');
    setTitleAr('');
    setOffPlan(false);
    const firstClient = clientOptions[0]?.id ?? '';
    setClientId(firstClient);
  }, [open, clientOptions]);

  useEffect(() => {
    setProjectId(projectsForClient[0]?.id ?? '');
  }, [projectsForClient]);

  const noData = clientOptions.length === 0 || projectOptions.length === 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createEngagement({
        titleEn: titleEn || null,
        titleAr: titleAr || null,
        clientId,
        projectId,
        offPlan,
      });
      if (res.ok && res.data) {
        onOpenChange(false);
        router.push(`/engagements/${res.data}`);
      } else {
        setError((res.error as ActionCode) ?? 'generic');
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t('newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">{t('newTitle')}</SheetDescription>

        {noData ? (
          <p className="mt-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            {t('noClients')}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {resolveActionError(error, te)}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eng-titleEn">{t('titleEn')}</Label>
                <Input
                  id="eng-titleEn"
                  dir="ltr"
                  value={titleEn}
                  onChange={(e) => setTitleEn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eng-titleAr">{t('titleAr')}</Label>
                <Input
                  id="eng-titleAr"
                  dir="rtl"
                  value={titleAr}
                  onChange={(e) => setTitleAr(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eng-client">{t('client')}</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="eng-client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clientOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale)
                        .value || c.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eng-project">{t('project')}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="eng-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectsForClient.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {pickLocale({ nameAr: p.nameAr, nameEn: p.nameEn }, 'name', locale)
                        .value || p.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={offPlan}
                onChange={(e) => setOffPlan(e.target.checked)}
              />
              {t('offPlan')}
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={pending || !clientId || !projectId}
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('create')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
