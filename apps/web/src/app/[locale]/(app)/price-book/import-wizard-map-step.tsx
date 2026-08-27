'use client';

import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ColumnMapping } from '@/lib/price-book/import';
import { FIELDS, NONE, REQUIRED, type FieldKey } from './import-wizard-fields';

// The wizard's second step: map spreadsheet columns onto cost-item fields. All
// state (`mapping`, `header`) and mutations (`setField`, `reset`, step change)
// live in the parent (ImportWizard); this child is presentational.
export function ImportWizardMapStep({
  t,
  mapping,
  header,
  setField,
  reset,
  onPreview,
  mappingReady,
}: {
  t: ReturnType<typeof useTranslations<'priceBook'>>;
  mapping: ColumnMapping;
  header: string[];
  setField: (field: FieldKey, col: number) => void;
  reset: () => void;
  onPreview: () => void;
  mappingReady: boolean;
}) {
  return (
    <div className="space-y-3">
      {FIELDS.map((field) => (
        <div key={field} className="grid grid-cols-2 items-center gap-2">
          <Label htmlFor={`map-${field}`}>
            {t(`import.fields.${field}`)}
            {REQUIRED.includes(field) && (
              <span className="text-destructive"> *</span>
            )}
          </Label>
          <Select
            value={String(mapping[field] ?? NONE)}
            onValueChange={(v) => setField(field, Number(v))}
          >
            <SelectTrigger id={`map-${field}`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={String(NONE)}>{t('import.none')}</SelectItem>
              {header.map((h, i) => (
                <SelectItem key={i} value={String(i)}>
                  {h || `#${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={reset}>
          {t('import.back')}
        </Button>
        <Button type="button" onClick={onPreview} disabled={!mappingReady}>
          {t('import.preview')}
        </Button>
      </div>
    </div>
  );
}
