'use client';

import { useTranslations } from 'next-intl';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { SignOfflineDialog } from '@/components/contracts/sign-offline-dialog';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import {
  NEXT_ACTION_TARGET,
  STAGES_WAITING_ON_CLIENT,
  executionCardHref,
  type NextActionTarget,
} from '@/lib/execution/next-action-target';

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
  const opens = target.page === 'project_boq' || view.may.openContract;
  if (!href || !opens) return null;
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
 * that action is told who can, so the card never shows a dead button.
 */
export function CommandCardExecution({ view }: { view: ExecutionCardView }) {
  const t = useTranslations('execution.card');
  const next = view.next;
  const target = next ? NEXT_ACTION_TARGET[next.kind] : null;
  const label = next ? t(`next.${next.kind}`) : null;
  const control = target && label ? nextActionControl(view, target, label) : null;

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
      {label && (
        <div className="flex flex-wrap items-center gap-2" data-next-action={next?.kind}>
          {control ?? (
            <p className="text-body">
              {label} <span className="text-muted-foreground">{t('someoneElse')}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
