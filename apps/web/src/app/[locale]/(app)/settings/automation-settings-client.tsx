'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { updateAutomationSettings } from '@/lib/automation/settings-actions';

export interface AutomationInitial {
  expireEnabled: boolean;
  expireNudgeEnabled: boolean;
  expireNudgeLeadDays: number;
  followupEnabled: boolean;
  followupThresholdDays: number;
  digestEnabled: boolean;
  digestCadence: string;
  stageRemindersEnabled: boolean;
}

export function AutomationSettingsClient({
  canManage,
  initial,
}: {
  canManage: boolean;
  initial: AutomationInitial;
}) {
  const t = useTranslations('automation');
  const ts = useTranslations('settings');
  const te = useTranslations('errors');
  const [saving, start] = useTransition();

  const [expireEnabled, setExpireEnabled] = useState(initial.expireEnabled);
  const [expireNudgeEnabled, setExpireNudgeEnabled] = useState(
    initial.expireNudgeEnabled,
  );
  const [expireNudgeLeadDays, setLead] = useState(
    String(initial.expireNudgeLeadDays),
  );
  const [followupEnabled, setFollowupEnabled] = useState(
    initial.followupEnabled,
  );
  const [followupThresholdDays, setThreshold] = useState(
    String(initial.followupThresholdDays),
  );
  const [digestEnabled, setDigestEnabled] = useState(initial.digestEnabled);
  const [digestCadence, setCadence] = useState(initial.digestCadence);
  const [stageRemindersEnabled, setStageEnabled] = useState(
    initial.stageRemindersEnabled,
  );

  const disabled = !canManage;
  const errorMessage = (code?: ActionCode) => resolveActionError(code, te);

  function save() {
    start(async () => {
      const res = await updateAutomationSettings({
        expireEnabled,
        expireNudgeEnabled,
        expireNudgeLeadDays: Number(expireNudgeLeadDays),
        followupEnabled,
        followupThresholdDays: Number(followupThresholdDays),
        digestEnabled,
        digestCadence,
        stageRemindersEnabled,
      });
      toast(
        res.ok
          ? { title: ts('saved') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
    });
  }

  const check = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    desc: string,
  ) => (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {check(
          expireEnabled,
          setExpireEnabled,
          t('expireLabel'),
          t('expireDesc'),
        )}

        {check(
          expireNudgeEnabled,
          setExpireNudgeEnabled,
          t('expireNudgeLabel'),
          t('expireNudgeDesc'),
        )}
        <div className="max-w-40 space-y-2 ps-7">
          <Label htmlFor="expireNudgeLeadDays">{t('leadDaysLabel')}</Label>
          <Input
            id="expireNudgeLeadDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            dir="ltr"
            value={expireNudgeLeadDays}
            onChange={(e) => setLead(e.target.value)}
            disabled={disabled || !expireNudgeEnabled}
          />
        </div>

        {check(
          followupEnabled,
          setFollowupEnabled,
          t('followupLabel'),
          t('followupDesc'),
        )}
        <div className="max-w-40 space-y-2 ps-7">
          <Label htmlFor="followupThresholdDays">{t('thresholdLabel')}</Label>
          <Input
            id="followupThresholdDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            dir="ltr"
            value={followupThresholdDays}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={disabled || !followupEnabled}
          />
        </div>

        {check(
          digestEnabled,
          setDigestEnabled,
          t('digestLabel'),
          t('digestDesc'),
        )}
        <div className="max-w-40 space-y-2 ps-7">
          <Label htmlFor="digestCadence">{t('cadenceLabel')}</Label>
          <select
            id="digestCadence"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={digestCadence}
            onChange={(e) => setCadence(e.target.value)}
            disabled={disabled || !digestEnabled}
          >
            <option value="daily">{t('cadenceDaily')}</option>
            <option value="weekly">{t('cadenceWeekly')}</option>
          </select>
        </div>

        {check(
          stageRemindersEnabled,
          setStageEnabled,
          t('stageLabel'),
          t('stageDesc'),
        )}

        {canManage && (
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {ts('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
