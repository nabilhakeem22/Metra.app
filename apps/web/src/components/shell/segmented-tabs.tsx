'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Segmented } from '@/components/ui/segmented';

// Leading-side segmented control on the top bar. The tabs are shell chrome; the
// content they scope is wired in a later slice, so selection is local state and
// the first tab is active by default. Built on the reusable <Segmented> primitive.
const TAB_KEYS = ['overview', 'activity'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function SegmentedTabs() {
  const shell = useTranslations('shell');
  const [active, setActive] = useState<TabKey>('overview');

  return (
    <Segmented
      ariaLabel={shell('viewTabs')}
      value={active}
      onValueChange={setActive}
      options={TAB_KEYS.map((key) => ({ value: key, label: shell(key) }))}
    />
  );
}
