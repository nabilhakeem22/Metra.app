'use client';

import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/format/date';
import type { MemberRole } from '@/lib/permissions/roles';
import type { Pending } from './team-types';

export function TeamPendingList({
  pending,
  canManage,
  isPending,
  onResend,
  onRevoke,
}: {
  pending: Pending[];
  canManage: boolean;
  isPending: boolean;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const t = useTranslations('team');
  const roles = useTranslations('roles');
  const locale = useLocale();
  const roleLabel = (role: MemberRole) => roles(`${role}.label`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pendingTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.length === 0 ? (
          <EmptyState title={t('noPending')} />
        ) : (
          pending.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span dir="ltr" className="truncate">
                    {p.email}
                  </span>
                  {p.expired && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t('expired')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {roleLabel(p.role)} · {t('expiresOn')}{' '}
                  {formatDate(p.expiresAt, locale)}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  {!p.expired && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onResend(p.id)}
                      disabled={isPending}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      {t('resend')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(p.id)}
                    disabled={isPending}
                  >
                    {t('revoke')}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
