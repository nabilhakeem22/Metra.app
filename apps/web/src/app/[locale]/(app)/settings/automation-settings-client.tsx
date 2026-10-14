'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { AutomationSettingsInput } from '@/lib/automation/settings-actions';
import { AUTOMATION_DAY_BOUNDS, type AutomationField } from '@/lib/automation/settings-field-rules';
import { useAutomationForm } from './use-automation-form';

export type AutomationInitial = AutomationSettingsInput;

export function AutomationSettingsClient({ canManage, initial }: { canManage: boolean; initial: AutomationInitial }) {
  const t = useTranslations('automation');
  const ts = useTranslations('settings');
  const form = useAutomationForm(initial);
  const { draft, set } = form;
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(cardRef, form.errors.invalidAttempt);
  const disabled = !canManage;

  const check = (key: 'expireEnabled' | 'expireNudgeEnabled' | 'followupEnabled' | 'digestEnabled' | 'stageRemindersEnabled', label: string, desc: string) => (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={draft[key]}
        onChange={(e) => set(key, e.target.checked)}
        disabled={disabled}
      />
      <span>
        <span className="block text-body font-medium">{label}</span>
        <span className="block text-caption text-muted-foreground">{desc}</span>
      </span>
    </label>
  );

  const dayBox = (field: AutomationField, label: string, enabled: boolean) => (
    <div className="max-w-40 ps-7">
      <FormField id={field} label={label} {...form.errors.bind(field)}>
        <Input
          type="number"
          inputMode="numeric"
          min={AUTOMATION_DAY_BOUNDS[field].min}
          max={AUTOMATION_DAY_BOUNDS[field].max}
          dir="ltr"
          value={draft[field]}
          onChange={(e) => set(field, e.target.value)}
          disabled={disabled || !enabled}
        />
      </FormField>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent ref={cardRef} className="space-y-5">
        {check('expireEnabled', t('expireLabel'), t('expireDesc'))}

        {check('expireNudgeEnabled', t('expireNudgeLabel'), t('expireNudgeDesc'))}
        {dayBox('expireNudgeLeadDays', t('leadDaysLabel'), draft.expireNudgeEnabled)}

        {check('followupEnabled', t('followupLabel'), t('followupDesc'))}
        {dayBox('followupThresholdDays', t('thresholdLabel'), draft.followupEnabled)}

        {check('digestEnabled', t('digestLabel'), t('digestDesc'))}
        <div className="max-w-40 space-y-2 ps-7">
          <Label htmlFor="digestCadence">{t('cadenceLabel')}</Label>
          <Select
            value={draft.digestCadence}
            onValueChange={(value) => set('digestCadence', value)}
            disabled={disabled || !draft.digestEnabled}
          >
            <SelectTrigger id="digestCadence" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t('cadenceDaily')}</SelectItem>
              <SelectItem value="weekly">{t('cadenceWeekly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {check('stageRemindersEnabled', t('stageLabel'), t('stageDesc'))}

        {form.errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {form.errors.formError}
          </p>
        )}
        {canManage && (
          <Button variant="secondary" onClick={form.save} disabled={form.saving}>
            {form.saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {ts('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
