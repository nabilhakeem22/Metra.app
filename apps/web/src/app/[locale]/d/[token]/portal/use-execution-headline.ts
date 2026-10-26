'use client';

import { useTranslations } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { heroRequest } from '@/lib/client-home/hero';
import type { HomeExecution } from '@/lib/client-home/types';
import type { ClientExecutionReason } from '@/lib/flow/locate/execution-client';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { pluralParams } from '@/lib/format/plural-params';
import { DocumentNumber } from './document-number';
import { formatPortalMoney } from './portal-money';

type Values = Record<string, string | number>;

/** The headline's message key under `delivery.home.hero`, and the values it names. */
type Headline = { key: string; values?: Values };

/** A document number inside the sentence: left to right, never broken across lines (B4 F5). */
const num = (chunks: ReactNode) => createElement(DocumentNumber, null, chunks);

/**
 * The ONE sentence the Execution tab's hero says, per client reason (the plan's
 * "Execution tab, per state" table), with the studio's name, the document
 * number, the amount or the date it names. When the payload lacks the figure a
 * sentence names (a request beyond the card's newest 60, a contract without an
 * end date) the same sentence is said without it. فصحى copy, Latin digits,
 * every figure isolated left to right.
 */
export function useExecutionHeadline(execution: HomeExecution, firmName: string, locale: string): ReactNode {
  const t = useTranslations('delivery.home.hero');
  const studio = { studio: firmName };
  const day = (date: string) => bidiIsolate(formatDate(date, locale));
  const money = (amount: string) => bidiIsolate(formatPortalMoney(amount, locale));
  const { contract } = execution;
  const request = heroRequest(execution);

  const HEADLINE: Readonly<Record<ClientExecutionReason, () => Headline>> = {
    preparing_contract: () => ({ key: 'preparing_contract', values: studio }),
    sign_contract: () => ({ key: 'sign_contract', values: { number: contract?.documentNumber ?? '' } }),
    signing_closed: () => ({ key: 'signing_closed', values: studio }),
    decide_change_order: () => ({
      key: 'decide_change_order',
      values: pluralParams('count', 'countText', execution.openVariationCount, locale),
    }),
    pay_request: () =>
      request
        ? { key: 'pay_request', values: { number: request.documentNumber, amount: money(request.outstanding) } }
        : { key: 'pay_request_unnamed' },
    payment_being_confirmed: () =>
      request
        ? { key: 'payment_being_confirmed', values: { number: request.documentNumber, ...studio } }
        : { key: 'payment_being_confirmed_unnamed', values: studio },
    works_in_progress: () =>
      contract?.revisedFinish ? { key: 'works_in_progress', values: { date: day(contract.revisedFinish) } } : { key: 'works_in_progress_undated' },
    final_account_due: () =>
      request ? { key: 'final_account_due', values: { amount: money(request.outstanding) } } : { key: 'final_account_due_unnamed' },
    final_account_in_review: () => ({ key: 'final_account_in_review', values: studio }),
    settled: () => ({ key: 'settled' }),
    terminated: () =>
      contract?.terminatedAt ? { key: 'terminated', values: { date: day(contract.terminatedAt) } } : { key: 'terminated_undated' },
  };

  const { key, values } = HEADLINE[execution.location.reason]();
  return t.rich(key, { ...values, num });
}
