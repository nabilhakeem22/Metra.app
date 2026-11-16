'use client';

import type { ComponentProps } from 'react';
import { ChangeOrderChargeRows } from '@/components/client-change-order/charge-rows';
import { Card, CardContent } from '@/components/ui/card';

/** What the order costs the client and the time it adds, as /v's own card. */
export function VariationChargeCard(props: ComponentProps<typeof ChangeOrderChargeRows>) {
  return (
    <Card>
      <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
        <ChangeOrderChargeRows {...props} />
      </CardContent>
    </Card>
  );
}
