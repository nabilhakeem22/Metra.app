'use client';

import type { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { setEngagementRom } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

// The "set ROM range" panel of the cockpit toolbar. All state lives in the parent
// and arrives via props (verbatim JSX); `after` closes the panel on success.
export function RomPanel({
  t,
  pending,
  engagementId,
  romLow,
  setRomLow,
  romHigh,
  setRomHigh,
  after,
  onCancel,
}: {
  t: ReturnType<typeof useTranslations<'engagements.controls'>>;
  pending: boolean;
  engagementId: string;
  romLow: string;
  setRomLow: (value: string) => void;
  romHigh: string;
  setRomHigh: (value: string) => void;
  after: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rom-low">{t('low')}</Label>
          <Input
            id="rom-low"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={romLow}
            onChange={(e) => setRomLow(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rom-high">{t('high')}</Label>
          <Input
            id="rom-high"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={romHigh}
            onChange={(e) => setRomHigh(e.target.value)}
          />
        </div>
      </div>
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={() =>
          after(() =>
            setEngagementRom({
              engagementId,
              romLow: romLow.trim(),
              romHigh: romHigh.trim(),
            }),
          )
        }
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
