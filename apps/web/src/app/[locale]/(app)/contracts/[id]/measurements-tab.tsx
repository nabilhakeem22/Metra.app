'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { STACKED_BODY, STACKED_HEAD, STACKED_TABLE } from '@/components/ui/stacked-table';
import type { MeasurementContractView } from '@/lib/execution/measurements/contract-view';
import type { MeasurableLine } from '@/lib/execution/measurements/queries';
import { measurableLineLabel, MeasurementRow } from './measurement-row';
import { RecordMeasurementDialog, type RecordedLine } from './record-measurement-dialog';
import { useMeasurableLines, type MeasurementsFilter } from './use-measurable-lines';

/** Why no reading can be recorded now, or null when one can. */
function closedReason(contract: MeasurementContractView): 'notSigned' | 'terminated' | 'finalAccountIssued' | null {
  if (contract.status === 'terminated') return 'terminated';
  if (contract.status !== 'signed') return 'notSigned';
  return contract.finalAccountIssued ? 'finalAccountIssued' : null;
}

/**
 * The contract's lines with their FINAL measured quantities (plan A5.1): 50 at
 * a time in document order, provisional lines only on request, searched by
 * code, description or section. A role that records gets "Record" on each line
 * while the contract is signed and its final account not issued. Read on
 * demand every time it is shown (the contract page and the measurements page
 * both mount it); a saved reading is shown on its line in place.
 */
export function MeasurementsTab({ contractId, canRecord }: { contractId: string; canRecord: boolean }) {
  const t = useTranslations('contracts.execution.measurements');
  const locale = useLocale();
  const data = useMeasurableLines(contractId);
  const { reload } = data;
  const [filter, setFilter] = useState<MeasurementsFilter>({ provisionalOnly: false, query: '' });
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<RecordedLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void reload(filter);
  }, [reload, filter]);

  const closed = data.contract && closedReason(data.contract);
  const mayRecord = canRecord && data.contract !== null && closed === null;
  const openRecording = (line: MeasurableLine) => {
    setNotice(null);
    setRecording({ id: line.id, label: measurableLineLabel(line, locale), qty: line.qty, unit: line.unit });
  };

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="space-y-1">
          <h2 className="text-body font-semibold">{t('title')}</h2>
          <p className="text-caption text-muted-foreground">{t('intro')}</p>
        </div>
        {data.error && <p className="text-body text-destructive" role="alert">{data.error}</p>}
        {notice && <p className="text-body" role="status">{notice}</p>}
        {closed && <p className="text-body text-muted-foreground">{t(`closed.${closed}`)}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter((current) => ({ ...current, query }));
            }}
          >
            <Input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} />
          </form>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={filter.provisionalOnly}
              onChange={(event) => setFilter((current) => ({ ...current, provisionalOnly: event.target.checked }))}
            />
            {t('provisionalOnly')}
          </label>
        </div>
        {data.contract === null && data.loading && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />}
        {data.contract && data.lines.length === 0 && !data.loading && <p className="text-body text-muted-foreground">{t('empty')}</p>}
        {data.lines.length > 0 && (
          <table className={STACKED_TABLE}>
            <thead className={STACKED_HEAD}>
              <tr className="border-b">
                <th className="py-2 pe-3 text-start font-medium">{t('line')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('contractQty')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('ordered')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('measured')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className={STACKED_BODY}>
              {data.lines.map((line) => (
                <MeasurementRow key={line.id} line={line} onRecord={mayRecord ? () => openRecording(line) : null} />
              ))}
            </tbody>
          </table>
        )}
        {data.nextCursor && (
          <Button variant="secondary" size="sm" disabled={data.loading} onClick={() => void data.showMore()}>
            {data.loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('more')}
          </Button>
        )}
        {recording && data.contract && (
          <RecordMeasurementDialog
            contractId={contractId}
            contractIssuedOn={data.contract.issuedOn}
            line={recording}
            onSaved={(reading, already) => {
              data.showReading(recording.id, reading);
              setRecording(null);
              setNotice(t(already ? 'record.already' : 'record.saved'));
            }}
            onClose={() => setRecording(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
