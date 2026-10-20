'use client';

import { useLocale, useTranslations } from 'next-intl';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { SignOfflineDialog } from '@/components/contracts/sign-offline-dialog';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { pickLocale } from '@/lib/i18n/pick-locale';
import {
  NEXT_ACTION_TARGET,
  STAGES_RECORDING_MEASUREMENTS,
  STAGES_WAITING_ON_CLIENT,
  executionCardHref,
  type NextActionTarget,
} from '@/lib/execution/next-action-target';
import type { ExecutionNextActionKind } from '@/lib/execution/stage';

/** May this role take the step a link leads to? The BOQ needs nothing; a money step its capability (A18). */
function mayFollow(view: ExecutionCardView, target: Extract<NextActionTarget, { kind: 'link' }>): boolean {
  if (target.page === 'project_boq') return true;
  if ('needs' in target) return view.may[target.needs];
  return view.may.openContract;
}

/**
 * The one control for the next action, or null when this role cannot take it
 * here. A plain function, not a component: the card needs to know it is null to
 * say who can take the action instead.
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
  return (
    <Button asChild variant="default">
      <Link href={href}>{label}</Link>
    </Button>
  );
}

/**
 * The delivery's EXECUTION card, under the closed headline at `execution`:
 * the stage derived from the BOQ contract (lib/execution/stage.ts) and its ONE
 * next action (lib/execution/next-action-target.ts). A role that cannot take
 * that action is told who can, so the card never shows a dead button. While
 * the works are in progress, a role that records measurements also gets
 * "Record measurements": the site engineer and the PM measure without opening
 * the contract page (A5.1).
 */
export function CommandCardExecution({ view }: { view: ExecutionCardView }) {
  const t = useTranslations('execution.card');
  const next = view.next;
  const measurementsHref =
    view.may.recordMeasurements && STAGES_RECORDING_MEASUREMENTS.has(view.stage)
      ? executionCardHref('contract_measurements', { projectId: view.projectId, contractId: view.contract?.id ?? null })
      : null;

  return (
    <div className="space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4" data-execution-stage={view.stage}>
      <div className="space-y-1">
        <p className="text-caption font-medium text-muted-foreground">
          {t('title')}
          {view.contract && (
            <>
              {' · '}
              <span dir="ltr">{view.contract.documentNumber}</span>
            </>
          )}
        </p>
        <p className="text-body font-semibold">{t(`stage.${view.stage}`)}</p>
        {STAGES_WAITING_ON_CLIENT.has(view.stage) && <p className="text-body text-muted-foreground">{t('waitingOnClient')}</p>}
      </div>
      {next && (
        <div className="flex flex-wrap items-center gap-2" data-next-action={next.kind}>
          <NextAction view={view} kind={next.kind} />
        </div>
      )}
      {measurementsHref && (
        <Button asChild variant="secondary" size="sm">
          <Link href={measurementsHref}>{t('recordMeasurements')}</Link>
        </Button>
      )}
    </div>
  );
}

/** The next action: its control, or who takes it. */
function NextAction({ view, kind }: { view: ExecutionCardView; kind: ExecutionNextActionKind }) {
  const t = useTranslations('execution.card');
  const locale = useLocale();
  const named = view.nextInstalment && pickLocale(view.nextInstalment, 'label', locale).value;
  const label = t(`next.${kind}`, { instalment: named || t('anInstalment') });
  const target = NEXT_ACTION_TARGET[kind];
  const control = nextActionControl(view, target, label);
  // Money is billed and recorded by the owner, an admin or the accountant (A18).
  const money = target.kind === 'link' && 'needs' in target;
  return (
    control ?? (
      <p className="text-body">
        {label} <span className="text-muted-foreground">{t(money ? 'someoneElseMoney' : 'someoneElse')}</span>
      </p>
    )
  );
}
