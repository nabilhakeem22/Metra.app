'use client';

import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ImportWizardMapStep } from './import-wizard-map-step';
import { ImportWizardPreviewStep } from './import-wizard-preview-step';
import { ImportWizardUploadStep } from './import-wizard-upload-step';
import type { SectionOption } from './types';
import { useImportWizard } from './use-import-wizard';

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionOption[];
}

/** The price-book import: upload, map, preview, import (use-import-wizard.ts). */
export function ImportWizard({ open, onOpenChange, sections }: ImportWizardProps) {
  const t = useTranslations('priceBook');
  const th = useTranslations('hints.priceBook');
  const wizard = useImportWizard({ sections });

  function close() {
    onOpenChange(false);
    // Defer reset so it doesn't flash during the close animation.
    setTimeout(wizard.reset, 200);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetTitle>{t('import.title')}</SheetTitle>
        <SheetDescription>
          {wizard.step === 'upload'
            ? t('import.chooseFile')
            : wizard.step === 'map'
              ? t('import.mapDescription')
              : t('import.previewSummary', { valid: wizard.validCount, total: wizard.preview.length })}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          {wizard.step === 'upload' && (
            <ImportWizardUploadStep
              t={t}
              th={th}
              pending={wizard.pending}
              onFile={wizard.onFile}
              errors={wizard.fileErrors}
            />
          )}

          {wizard.step === 'map' && wizard.mapping && (
            <ImportWizardMapStep
              t={t}
              mapping={wizard.mapping}
              header={wizard.header}
              setField={wizard.setField}
              reset={wizard.reset}
              onPreview={wizard.onPreview}
              pending={wizard.pending}
              errors={wizard.mapErrors}
            />
          )}

          {wizard.step === 'preview' && (
            <ImportWizardPreviewStep
              t={t}
              preview={wizard.preview}
              pending={wizard.pending}
              validCount={wizard.validCount}
              formError={wizard.mapErrors.formError}
              onBack={() => wizard.setStep('map')}
              runImport={() => wizard.runImport(close)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
