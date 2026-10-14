'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Centered, Row } from '@/components/share/link-page-parts';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { formatMoney } from '@/lib/format/money';
import { formatPercent, formatQuantity } from '@/lib/format/number';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';
import type { PublicProposal } from '@/lib/proposals/public';
import { unansweredFailure, type ShownPortalFailure } from '@/lib/share/portal-failure';
import { respondToProposal } from './actions';
import { proposalDecidedKey, proposalOutcomeOf, type ProposalOutcome } from './proposal-outcome';

export function PublicProposalView({
  token,
  proposal,
}: {
  token: string;
  proposal: PublicProposal | null;
}) {
  const t = useTranslations('proposals.p');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ProposalOutcome>(null);
  // An answer that never landed: the decision stays open, the buttons stay.
  const [failure, setFailure] = useState<ShownPortalFailure | null>(null);
  const [name, setName] = useState('');

  if (!proposal) {
    return <Centered>{t('invalid')}</Centered>;
  }

  const m = (v: string) => formatMoney(v, locale);
  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const num = formatProposalNumber(
    proposal.number,
    proposalYear(proposal.issue_date, new Date()),
  );

  function respond(decision: 'accept' | 'reject') {
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await respondToProposal(token, decision, name);
        const failed = unansweredFailure(res);
        if (failed) setFailure(failed);
        else setOutcome(proposalOutcomeOf(res, decision));
      } catch (rejection) {
        setFailure({ rejection });
      }
    });
  }

  const decided = proposal.status !== 'sent' || outcome !== null;
  const decidedMessage = t(proposalDecidedKey(proposal.status, outcome));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-heading font-semibold">
          {pick(proposal.org.name_ar, proposal.org.name_en) || 'Metra'}
        </h1>
        <p className="text-body text-muted-foreground">
          {t('quotation')} · <span dir="ltr">{num}</span>
        </p>
        <p className="font-medium">{pick(proposal.title_ar, proposal.title_en)}</p>
      </header>

      {proposal.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-body font-semibold">{pick(s.title_ar, s.title_en)}</h2>
              <span className="text-body" dir="ltr">{m(s.section_subtotal)}</span>
            </div>
            <table className="w-full text-body">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(l.description_ar, l.description_en)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {formatQuantity(l.qty, locale)} {l.unit}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">{m(l.unit_price)}</td>
                    <td className="px-4 py-2 text-end" dir="ltr">{m(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
          <Row label={t('subtotal')} value={m(proposal.subtotal)} />
          <Row label={t('discount')} value={m(proposal.discount_amount)} />
          <Row label={`${t('tax')} (${formatPercent(proposal.tax_rate, locale)})`} value={m(proposal.tax_amount)} />
          <Row label={t('total')} value={m(proposal.total)} bold />
        </CardContent>
      </Card>

      {decided ? (
        <Card>
          <CardContent className="py-6 text-center font-medium">
            {decidedMessage}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 py-4">
            <Input
              placeholder={t('yourName')}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <PortalFailureAlert failure={failure} />
            <div className="flex justify-center gap-3">
              <Button variant="default" onClick={() => respond('accept')} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t('accept')}
              </Button>
              <Button variant="secondary" onClick={() => respond('reject')} disabled={pending}>
                <X className="size-4" aria-hidden />
                {t('reject')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
