'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadMeasurements } from '@/lib/execution/measurements/actions';
import type { MeasurementContractView } from '@/lib/execution/measurements/contract-view';
import type { MeasurableLine } from '@/lib/execution/measurements/queries';

export interface MeasurementsFilter {
  provisionalOnly: boolean;
  query: string;
}

export interface MeasurableLines {
  contract: MeasurementContractView | null;
  lines: MeasurableLine[];
  nextCursor: string | null;
  error: string | null;
  loading: boolean;
  /** The first page under `filter`, replacing what is shown. */
  reload: (filter: MeasurementsFilter) => Promise<void>;
  /** The next 50 lines under the filter last loaded. */
  showMore: () => Promise<void>;
  /** Show a reading the server just saved on its line, where it is, without reading the tab again. */
  showReading: (lineId: string, latest: NonNullable<MeasurableLine['latest']>) => void;
}

/**
 * The measurements tab's data, held BY THE TAB and read on demand through its
 * action: the page never carries the lines, so it costs the same however long
 * the contract is. Each read also says the contract's state (signed, final
 * account issued), so the tab never offers a reading the server would refuse.
 * An answer to an older read (a filter changed while it ran) is dropped. A
 * saved reading is shown on its line in place, so recording line after line
 * on page 3 never sends the studio back to page 1.
 */
export function useMeasurableLines(contractId: string): MeasurableLines {
  const te = useTranslations('errors');
  const [contract, setContract] = useState<MeasurementContractView | null>(null);
  const [lines, setLines] = useState<MeasurableLine[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filterShown = useRef<MeasurementsFilter>({ provisionalOnly: false, query: '' });
  const latestRead = useRef(0);

  const read = useCallback(
    async (filter: MeasurementsFilter, afterLineId: string | null) => {
      const readNumber = ++latestRead.current;
      setLoading(true);
      setError(null);
      try {
        const res = await loadMeasurements({ contractId, afterLineId, ...filter });
        if (readNumber !== latestRead.current) return;
        if (res.ok && res.data) {
          const page = res.data.page;
          setContract(res.data.contract);
          setLines((current) => (afterLineId ? [...current, ...page.lines] : page.lines));
          setNextCursor(page.nextCursor);
        } else {
          setError(describeFailure(res, te));
        }
      } catch (rejection) {
        if (readNumber === latestRead.current) setError(describeRejection(rejection, te));
      } finally {
        if (readNumber === latestRead.current) setLoading(false);
      }
    },
    [contractId, te],
  );

  const reload = useCallback(
    (filter: MeasurementsFilter) => {
      filterShown.current = filter;
      return read(filter, null);
    },
    [read],
  );

  const showMore = useCallback(
    () => (nextCursor ? read(filterShown.current, nextCursor) : Promise.resolve()),
    [nextCursor, read],
  );

  const showReading = useCallback((lineId: string, latest: NonNullable<MeasurableLine['latest']>) => {
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, latest } : line)));
  }, []);

  return { contract, lines, nextCursor, error, loading, reload, showMore, showReading };
}
