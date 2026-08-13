'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { useRouter } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { createProposal } from '@/lib/proposals/actions';

interface Option {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  code?: string;
  clientId?: string;
}

export function ProposalCreateForm({
  clients,
  projects,
  defaultProjectId,
}: {
  clients: Option[];
  projects: Option[];
  /** Preselect this project (e.g. arriving from a project profile). */
  defaultProjectId?: string;
}) {
  const t = useTranslations('proposals');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Arriving from a project's "new proposal" CTA: preselect that project (and
  // its client), else fall back to the first option.
  const preselected =
    defaultProjectId && projects.some((p) => p.id === defaultProjectId)
      ? projects.find((p) => p.id === defaultProjectId)
      : undefined;
  const [clientId, setClientId] = useState(
    preselected?.clientId ?? clients[0]?.id ?? '',
  );
  const [projectId, setProjectId] = useState(
    preselected?.id ?? projects[0]?.id ?? '',
  );
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const label = (o: Option) =>
    pickLocale({ nameAr: o.nameAr, nameEn: o.nameEn }, 'name', locale).value ||
    o.code ||
    o.id;

  const missing = clients.length === 0 || projects.length === 0;
  const selectClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

  function submit() {
    startTransition(async () => {
      const res = await createProposal({
        clientId,
        projectId,
        titleEn: titleEn || null,
        titleAr: titleAr || null,
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
      });
      if (res.ok && res.data) {
        toast({ title: t('toast.created') });
        router.push(`/proposals/${res.data}`);
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        {missing ? (
          <p className="text-sm text-muted-foreground">{t('create.needFirst')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="np-client">{t('create.client')}</Label>
                <select
                  id="np-client"
                  className={selectClass}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {label(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-project">{t('create.project')}</Label>
                <select
                  id="np-project"
                  className={selectClass}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `${p.code} · ` : ''}
                      {label(p)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="np-titleEn">{t('create.titleEn')}</Label>
                <Input id="np-titleEn" dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-titleAr">{t('create.titleAr')}</Label>
                <Input id="np-titleAr" dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="np-issue">{t('create.issueDate')}</Label>
                <Input id="np-issue" type="date" dir="ltr" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-expiry">{t('create.expiryDate')}</Label>
                <Input id="np-expiry" type="date" dir="ltr" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => router.push('/proposals')} disabled={pending}>
                {t('create.cancel')}
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('create.submit')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
