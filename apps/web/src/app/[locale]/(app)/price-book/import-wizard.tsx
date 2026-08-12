'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Label } from '@/components/ui/label';
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

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCodes: string[];
}

type Step = 'upload' | 'map' | 'preview';
type FieldKey = keyof ColumnMapping;

const REQUIRED: FieldKey[] = ['code', 'category', 'unit', 'cost', 'price'];
const FIELDS: FieldKey[] = [
  'code',
  'nameEn',
  'nameAr',
  'category',
  'unit',
  'cost',
  'price',
];

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

const NONE = -1;

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
    return validateImportRows(data, mapping, existing);
  }, [step, mapping, data, existing]);

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

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

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
            <div className="space-y-2">
              <Label htmlFor="import-file" className="flex items-center">
                {t('import.chooseFile')}
                <FieldHint id="import-file-hint" hint={th('importFile')} />
              </Label>
              <input
                id="import-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                aria-describedby="import-file-hint"
                disabled={pending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
                className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
              />
              {pending && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                </p>
              )}
            </div>
          )}

          {step === 'map' && mapping && (
            <div className="space-y-3">
              {FIELDS.map((field) => (
                <div
                  key={field}
                  className="grid grid-cols-2 items-center gap-2"
                >
                  <Label htmlFor={`map-${field}`}>
                    {t(`import.fields.${field}`)}
                    {REQUIRED.includes(field) && (
                      <span className="text-destructive"> *</span>
                    )}
                  </Label>
                  <select
                    id={`map-${field}`}
                    className={selectClass}
                    value={mapping[field] ?? NONE}
                    onChange={(e) => setField(field, Number(e.target.value))}
                  >
                    <option value={NONE}>{t('import.none')}</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={reset}>
                  {t('import.back')}
                </Button>
                <Button
                  type="button"
                  onClick={() => setStep('preview')}
                  disabled={!mappingReady}
                >
                  {t('import.preview')}
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-start">
                        {t('import.rowColumn')}
                      </th>
                      <th className="px-2 py-1.5 text-start">
                        {t('table.code')}
                      </th>
                      <th className="px-2 py-1.5 text-start">
                        {t('import.statusColumn')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.index} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {r.index + 1}
                        </td>
                        <td className="px-2 py-1.5" dir="ltr">
                          {r.code || '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.ok ? (
                            <span className="text-emerald-600">
                              {t('import.willImport')}
                            </span>
                          ) : (
                            <span className="text-destructive">
                              {t(`import.errors.${r.error}`)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('map')}
                  disabled={pending}
                >
                  {t('import.back')}
                </Button>
                <Button
                  type="button"
                  onClick={runImport}
                  disabled={pending || validCount === 0}
                >
                  {pending && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  {t('import.importNow', { count: validCount })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
