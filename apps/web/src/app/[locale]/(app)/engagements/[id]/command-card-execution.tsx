'use client';

import { useTranslations } from 'next-intl';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { SignOfflineDialog } from '@/components/contracts/sign-offline-dialog';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import {
  NEXT_ACTION_TARGET,
  STAGES_RECORDING_COSTS,
  STAGES_RECORDING_MEASUREMENTS,
  executionCardHref,
  type NextActionTarget,
} from '@/lib/execution/next-action-target';
import type { ExecutionNextActionKind } from '@/lib/execution/stage';

// The execution step card's CONTROLS: the one next action, and the costs and
// measurements links beside it. The card (execution-step-card.tsx) says what
// the action is; this file only offers it, or says who can take it, so the
// card never shows a dead button.

/** May this role take the step a link leads to? The BOQ needs nothing; a money step its capability (A18). */
function mayFollow(view: ExecutionCardView, target: Extract<NextActionTarget, { kind: 'link' }>): boolean {
  if (target.page === 'project_boq') return true;
  if ('needs' in target) return view.may[target.needs];
  return view.may.openContract;
}

/**
 * The one control for the next action, or null when this role cannot take it
 * here. A plain function, not a component: the caller needs to know it is null
 * to say who can take the action instead.
 */
function nextActionControl(view: ExecutionCardView, target: NextActionTarget, label: string) {
  if (target.kind === 'dialog') {
    if (target.dialog === 'generate_contract') {
      return view.may.generateContract && view.boqId ? <GenerateExecutionContract boqId={view.boqId} /> : null;
    }
    return view.may.signOffline && view.contract ? <SignOfflineDialog contractId={view.contract.id} /> : null;
  }
  const href = executionCardHref(target.page, { projectId: view.projectId, contractId: view.contract?.id ?? null });
  if (!href || !mayFollow(view, target)) return null;
  // A long label ("Send the payment request for Instalment 1") wraps inside
  // the card at 390 px instead of running past it: full width, several lines.
  return (
    <Button asChild variant="default" className="w-full whitespace-normal text-center">
      <Link href={href}>{label}</Link>
    </Button>
  );
}

/**
 * The next action's control, or who takes it. `label` is the action in words,
 * the same string the card's headline says.
 */
export function ExecutionNextAction({
  view,
  kind,
  label,
}: {
  view: ExecutionCardView;
  kind: ExecutionNextActionKind;
  label: string;
}) {
  const t = useTranslations('execution.card');
  const target = NEXT_ACTION_TARGET[kind];
  // Money is billed and recorded by the owner, an admin or the accountant (A18).
  const money = target.kind === 'link' && 'needs' in target;
  return (
    <div className="flex flex-wrap items-center gap-2" data-next-action={kind}>
      {nextActionControl(view, target, label) ?? (
        <p className="text-body text-muted-foreground">{t(money ? 'someoneElseMoney' : 'someoneElse')}</p>
      )}
    </div>
  );
}

/**
 * "Record costs" from works in progress on, and "Record measurements" while the
 * works are in progress, each to a role that records them: the site engineer
 * and the PM measure without opening the contract page (A5.1).
 */
export function ExecutionRecordLinks({ view }: { view: ExecutionCardView }) {
  const t = useTranslations('execution.card');
  const ids = { projectId: view.projectId, contractId: view.contract?.id ?? null };
  const costsHref =
    view.may.recordCosts && STAGES_RECORDING_COSTS.has(view.stage) ? executionCardHref('contract_costs', ids) : null;
  const measurementsHref =
    view.may.recordMeasurements && STAGES_RECORDING_MEASUREMENTS.has(view.stage)
      ? executionCardHref('contract_measurements', ids)
      : null;
  if (!costsHref && !measurementsHref) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {costsHref && (
        <Button asChild variant="secondary" size="sm">
          <Link href={costsHref}>{t('recordCosts')}</Link>
        </Button>
      )}
      {measurementsHref && (
        <Button asChild variant="secondary" size="sm">
          <Link href={measurementsHref}>{t('recordMeasurements')}</Link>
        </Button>
      )}
    </div>
  );
}
