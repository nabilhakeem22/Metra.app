'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { CostSectionsApi } from './use-cost-sections';

/** "More sections": the next page of the contract's sections, for the costs filter and the entry form. Nothing once all are shown. */
export function MoreSectionsButton({ sections, className }: { sections: CostSectionsApi; className?: string }) {
  const t = useTranslations('contracts.costs');
  if (!sections.hasMore) return null;
  return (
    <Button type="button" size="sm" variant="secondary" className={className} disabled={sections.pending} onClick={sections.loadMore}>
      {sections.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {t('moreSections')}
    </Button>
  );
}
