'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ContractLineRow } from '@/components/client-contract/line-row';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { cn } from '@/lib/utils';
import { useChangeOrderLines } from './use-change-order-lines';

/**
 * One change order's items, under its figures: closed with the page (which ships
 * none of them), read on the client's tap and shown as a contract's lines are.
 * فصحى copy, Latin digits.
 */
export function ChangeOrderLines({ token, variationId, lineCount }: { token: string; variationId: string; lineCount: number }) {
  const t = useTranslations('delivery.changeOrders.lines');
  const { lines, open, problem, pending, toggle } = useChangeOrderLines(token, variationId);
  const listId = `variation-lines-${variationId}`;
  if (lineCount === 0) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-expanded={open}
        aria-controls={lines ? listId : undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-caption font-semibold outline-none focus-ring-brand hover:bg-muted disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        )}
        {open ? t('hide') : t('show', { count: lineCount })}
      </button>
      {problem &&
        ('failure' in problem ? (
          <PortalFailureAlert failure={problem.failure} />
        ) : (
          <p role="alert" className="text-body text-destructive">
            {t(problem.own)}
          </p>
        ))}
      {lines && (
        // The width the line rows measure (components/client-contract/line-row.tsx).
        <div id={listId} hidden={!open} className="rounded-item border [container-type:inline-size]">
          <table className="block w-full text-body [@container(min-width:36rem)]:table">
            <tbody className="block [@container(min-width:36rem)]:table-row-group">
              {lines.map((line) => (
                <ContractLineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
