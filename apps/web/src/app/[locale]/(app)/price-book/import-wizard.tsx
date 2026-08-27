'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { importCostItems, parseCostImport } from '@/lib/price-book/actions';
import {
  validateImportRows,
  type ColumnMapping,
  type ValidatedRow,
} from '@/lib/price-book/import';
import { REQUIRED, type FieldKey } from './import-wizard-fields';
import { ImportWizardMapStep } from './import-wizard-map-step';
import { ImportWizardPreviewStep } from './import-wizard-preview-step';
import { ImportWizardUploadStep } from './import-wizard-upload-step';
import type { SectionOption } from './types';

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCodes: string[];
  sections: SectionOption[];
}

type Step = 'upload' | 'map' | 'preview';

const GUESS: Record<FieldKey, string[]> = {
  code: ['code', 'كود', 'الكود'],
  nameEn: ['name (en', 'english', 'name_en', 'nameen', 'name'],
  nameAr: ['name (ar', 'arabic', 'name_ar', 'namear', 'الاسم'],
  category: ['category', 'الفئة', 'فئة'],
  unit: ['unit', 'الوحدة', 'وحدة'],
  cost: ['cost', 'التكلفة', 'تكلفة'],
  price: ['price', 'السعر', 'سعر'],
  taxCode: ['tax', 'ضريبة'],
  etaItemCode: ['eta item', 'eta_item'],
  etaCodeType: ['eta type', 'eta_code'],
};

function guessMapping(header: string[]): ColumnMapping {
  const find = (aliases: string[]): number => {
    const idx = header.findIndex((h) => {
      const n = h.trim().toLowerCase();
      return aliases.some((a) => n.includes(a));
    });
    return idx;
  };
  return {
    code: find(GUESS.code),
    nameEn: find(GUESS.nameEn),
    nameAr: find(GUESS.nameAr),
    category: find(GUESS.category),
    unit: find(GUESS.unit),
    cost: find(GUESS.cost),
    price: find(GUESS.price),
  };
}

export function ImportWizard({
  open,
  onOpenChange,
  existingCodes,
  sections,
}: ImportWizardProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.priceBook');
  const [step, setStep] = useState<Step>('upload');
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pending, startTransition] = useTransition();

  // Case-SENSITIVE, matching the DB unique(org_id, code).
  const existing = useMemo(() => new Set(existingCodes), [existingCodes]);

  const preview: ValidatedRow[] = useMemo(() => {
    if (step !== 'preview' || !mapping) return [];
    return validateImportRows(data, mapping, existing, sections);
  }, [step, mapping, data, existing, sections]);

  const validCount = preview.filter((r) => r.ok).length;

  function reset() {
    setStep('upload');
    setHeader([]);
    setData([]);
    setMapping(null);
  }

  function close() {
    onOpenChange(false);
    // Defer reset so it doesn't flash during the close animation.
    setTimeout(reset, 200);
  }

  function onFile(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    startTransition(async () => {
      const res = await parseCostImport(fd);
      if (!res.ok || !res.data) {
        toast({ title: t('toast.importFailed'), variant: 'destructive' });
        return;
      }
      setHeader(res.data.header);
      setData(res.data.data);
      setMapping(guessMapping(res.data.header));
      setStep('map');
    });
  }

  function setField(field: FieldKey, col: number) {
    setMapping((m) => (m ? { ...m, [field]: col < 0 ? undefined : col } : m));
  }

  const mappingReady =
    mapping !== null &&
    REQUIRED.every((f) => mapping[f] !== undefined && mapping[f]! >= 0);

  function runImport() {
    if (!mapping) return;
    startTransition(async () => {
      const res = await importCostItems({ rows: data, mapping });
      if (res.ok && res.data) {
        toast({
          title: t('import.done', {
            imported: res.data.imported,
            skipped: res.data.skipped,
          }),
        });
        close();
      } else {
        toast({ title: t('toast.importFailed'), variant: 'destructive' });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetTitle>{t('import.title')}</SheetTitle>
        <SheetDescription>
          {step === 'upload'
            ? t('import.chooseFile')
            : step === 'map'
              ? t('import.mapDescription')
              : t('import.previewSummary', {
                  valid: validCount,
                  total: preview.length,
                })}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          {step === 'upload' && (
            <ImportWizardUploadStep
              t={t}
              th={th}
              pending={pending}
              onFile={onFile}
            />
          )}

          {step === 'map' && mapping && (
            <ImportWizardMapStep
              t={t}
              mapping={mapping}
              header={header}
              setField={setField}
              reset={reset}
              onPreview={() => setStep('preview')}
              mappingReady={mappingReady}
            />
          )}

          {step === 'preview' && (
            <ImportWizardPreviewStep
              t={t}
              preview={preview}
              pending={pending}
              validCount={validCount}
              onBack={() => setStep('map')}
              runImport={runImport}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
