'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format/money';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';
import type { PublicProposal } from '@/lib/proposals/public';
import { respondToProposal } from './actions';

export function PublicProposalView({
  token,
  proposal,
}: {
  token: string;
  proposal: PublicProposal | null;
}) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    'accepted' | 'rejected' | 'already' | 'expired' | null
  >(null);
  const [name, setName] = useState('');

  if (!proposal) {
    return <Centered>{t('p.invalid')}</Centered>;
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
    startTransition(async () => {
      const res = await respondToProposal(token, decision, name);
      if (res.ok) setOutcome(decision === 'accept' ? 'accepted' : 'rejected');
      else if (res.error === 'token_expired') setOutcome('expired');
      else setOutcome('already');
    });
  }

  const decided = proposal.status !== 'sent' || outcome !== null;
  const decidedMessage =
    outcome === 'accepted' || proposal.status === 'accepted'
      ? t('p.decisionAccepted')
      : outcome === 'rejected' || proposal.status === 'rejected'
        ? t('p.decisionRejected')
        : outcome === 'expired'
          ? t('p.expired')
          : t('p.alreadyResponded');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {pick(proposal.org.name_ar, proposal.org.name_en) || 'Metra'}
        </h1>
        <p className="text-sm text-muted-foreground" dir="ltr">
          {t('p.quotation')} · {num}
        </p>
        <p className="font-medium">{pick(proposal.title_ar, proposal.title_en)}</p>
      </header>

      {proposal.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">{pick(s.title_ar, s.title_en)}</h2>
              <span className="num text-sm">{m(s.section_subtotal)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(l.description_ar, l.description_en)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {l.qty} {l.unit}
                    </td>
                    <td className="px-4 py-2 num text-end" dir="ltr">{m(l.unit_price)}</td>
                    <td className="px-4 py-2 num text-end" dir="ltr">{m(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-sm" dir="ltr">
          <Row label={t('p.subtotal')} value={m(proposal.subtotal)} />
          <Row label={t('p.discount')} value={m(proposal.discount_amount)} />
          <Row label={`${t('p.tax')} (${proposal.tax_rate}%)`} value={m(proposal.tax_amount)} />
          <Row label={t('p.total')} value={m(proposal.total)} bold />
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
              placeholder={t('p.yourName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex justify-center gap-3">
              <Button onClick={() => respond('accept')} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {t('p.accept')}
              </Button>
              <Button variant="outline" onClick={() => respond('reject')} disabled={pending}>
                <X className="size-4" aria-hidden />
                {t('p.reject')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
