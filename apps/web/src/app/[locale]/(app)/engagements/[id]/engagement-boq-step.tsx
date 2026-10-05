'use client';

import { boqStepAction, type BoqStepData } from '@/lib/boqs/step';
import { BoqStepDone } from './boq-step-done';
import { BoqStepIssue } from './boq-step-issue';
import { BoqStepStart } from './boq-step-start';

/**
 * The BOQ step's lead action in the cockpit, one state at a time:
 *   start -> build the BOQ in the proposal builder (or upload a sheet instead);
 *   issue -> an uploaded sheet is waiting to be issued from the BOQ tab;
 *   done  -> the BOQ was sent, and whether the client can open it yet.
 *
 * It sits ABOVE the inline dropzone, which remains underneath as the escape
 * hatch: the cockpit's rule is one obvious next action, and this makes the
 * obvious one the priced schedule we built.
 */
export function EngagementBoqStep({
  engagementId,
  projectId,
  step,
}: {
  engagementId: string;
  projectId: string;
  step: BoqStepData;
}) {
  const action = boqStepAction(step.current);
  if (action === 'done' && step.current) {
    return <BoqStepDone projectId={projectId} step={step} current={step.current} />;
  }
  if (action === 'issue' && step.current) {
    return (
      <BoqStepIssue
        projectId={projectId}
        lineCount={step.current.lineCount}
        clientCanOpen={step.clientCanOpen}
      />
    );
  }
  return <BoqStepStart engagementId={engagementId} projectId={projectId} step={step} />;
}
