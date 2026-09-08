import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqStart } from './boq-start';
import { BoqIssue } from './boq-issue';

/**
 * The project's Bill of Quantities — the priced schedule of works that the
 * execution phase measures against.
 *
 * Read-only for now: this slice gets the BOQ into the app and gives the studio
 * the two ways in (build it, or fill the template and upload it). Editing lines
 * in place is the next slice.
 */
export function BoqTab({
  projectId,
  boq,
  canBuild,
  locale,
}: {
  projectId: string;
  boq: BoqDetail | null;
  canBuild: boolean;
  locale: string;
}) {
  const t = useTranslations('projects.profile.boq');

  if (!boq) {
    return (
      <div className="space-y-4">
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        {canBuild && <BoqStart projectId={projectId} />}
      </div>
    );
  }

  const money = (v: string) => formatMoney(v, locale);

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-widest text-[color:var(--text-faint)]">
            {t('documentLabel', { number: String(boq.number) })}
          </p>
          <p className="text-lg font-bold text-[color:var(--text)]" dir="auto">
            {boq.title}
          </p>
          <p className="text-sm text-[color:var(--text-muted)]">
            {t('lineCount', { count: String(boq.lineCount) })}
            {boq.status === 'issued' && (
              <span
                className="ms-2 rounded-pill px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: 'var(--success-tint)', color: 'var(--success)' }}
              >
                {t('statusIssued')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {canBuild && boq.status === 'draft' && (
            <BoqIssue boqId={boq.id} disabled={boq.lineCount === 0} />
          )}
          <div className="text-end">
          <p className="text-xs uppercase tracking-widest text-[color:var(--text-faint)]">
            {t('total')}
          </p>
          <p
            className="text-xl font-bold tabular-nums text-[color:var(--text)]"
            dir="ltr"
          >
            {/* formatMoney already carries the currency — appending boq.currency
                here printed "212,900.00 EGP EGP". */}
            {money(boq.total)}
          </p>
          </div>
        </div>
      </div>

      {boq.sections.map((section) => (
        <div key={section.id} className="glass overflow-hidden p-0">
          <div className="flex items-center justify-between gap-4 border-b border-[color:var(--rule)] px-5 py-3">
            <p className="font-semibold text-[color:var(--text)]" dir="auto">
              {section.title}
            </p>
            <p className="tabular-nums text-sm font-semibold" dir="ltr">
              {money(section.sectionSubtotal)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[color:var(--text-faint)]">
                  <th className="px-5 py-2 text-start text-xs font-semibold uppercase tracking-wider">
                    {t('col.description')}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider">
                    {t('col.unit')}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider">
                    {t('col.qty')}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider">
                    {t('col.rate')}
                  </th>
                  <th className="px-5 py-2 text-end text-xs font-semibold uppercase tracking-wider">
                    {t('col.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.lines.map((line) => (
                  <tr
                    key={line.id}
                    className="border-t border-[color:var(--rule-soft)]"
                  >
                    <td className="px-5 py-2.5" dir="auto">
                      {line.itemCode && (
                        <span className="me-2 font-mono text-xs text-[color:var(--text-faint)]">
                          {line.itemCode}
                        </span>
                      )}
                      {line.description}
                      {line.provisional && (
                        <span
                          className="ms-2 rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: 'var(--warn-tint)',
                            color: 'var(--warn)',
                          }}
                        >
                          {t('provisional')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[color:var(--text-muted)]">
                      {t(`unit.${line.unit}`)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                      {formatQuantity(line.qty, locale)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                      {money(line.unitPrice)}
                    </td>
                    <td className="px-5 py-2.5 text-end font-medium tabular-nums" dir="ltr">
                      {money(line.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
