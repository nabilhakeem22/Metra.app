'use client';

import { useTranslations } from 'next-intl';
import type { ContractTab } from './tabs';

/** Each tab's label: its namespace and key. */
const TAB_LABEL: Record<ContractTab, { namespace: 'contracts' | 'variations'; key: string }> = {
  overview: { namespace: 'contracts', key: 'contract' },
  schedule: { namespace: 'contracts', key: 'execution.schedule.tab' },
  payments: { namespace: 'contracts', key: 'execution.payments.tab' },
  variations: { namespace: 'variations', key: 'register' },
};

/** The contract page's tabs: the ones this contract has, the open one marked. */
export function ContractTabStrip({
  tabs,
  current,
  onSelect,
}: {
  tabs: readonly ContractTab[];
  current: ContractTab;
  onSelect: (tab: ContractTab) => void;
}) {
  const t = useTranslations('contracts');
  const tv = useTranslations('variations');
  return (
    <div className="flex gap-2 border-b">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          className={`border-b-2 px-3 py-2 text-body ${
            tab === current ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'
          }`}
        >
          {(TAB_LABEL[tab].namespace === 'contracts' ? t : tv)(TAB_LABEL[tab].key)}
        </button>
      ))}
    </div>
  );
}
