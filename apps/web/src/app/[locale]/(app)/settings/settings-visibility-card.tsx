'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';

// The visibility settings card (hide-margin · restrict-dashboard toggles). All
// state and mutations live in the parent (SettingsClient); this child is
// presentational, driven by the passed values + callbacks.
export function SettingsVisibilityCard({
  t,
  th,
  hideMargin,
  setHideMargin,
  restrictDash,
  setRestrictDash,
  disabled,
  canManage,
  saveSettings,
  savingSettings,
}: {
  t: ReturnType<typeof useTranslations<'settings'>>;
  th: ReturnType<typeof useTranslations<'hints.org'>>;
  hideMargin: boolean;
  setHideMargin: (value: boolean) => void;
  restrictDash: boolean;
  setRestrictDash: (value: boolean) => void;
  disabled: boolean;
  canManage: boolean;
  saveSettings: () => void;
  savingSettings: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('visibilityTitle')}</CardTitle>
        <CardDescription>{t('visibilitySubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={hideMargin}
            onChange={(e) => setHideMargin(e.target.checked)}
            disabled={disabled}
          />
          <span>
            <span className="flex items-center text-sm font-medium">
              {t('hideMarginLabel')}
              <FieldHint hint={th('hideMarginFromPm')} />
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('hideMarginDesc')}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={restrictDash}
            onChange={(e) => setRestrictDash(e.target.checked)}
            disabled={disabled}
          />
          <span>
            <span className="block text-sm font-medium">
              {t('restrictDashLabel')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('restrictDashDesc')}
            </span>
          </span>
        </label>

        {canManage && (
          <Button onClick={saveSettings} disabled={savingSettings}>
            {savingSettings && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {t('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
