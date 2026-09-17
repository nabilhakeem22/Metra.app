'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { BoqStepSummary } from '@/lib/boqs/step';
import type { CommandCardCtas } from '@/lib/engagements/command-card-ctas';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { DesignState } from '@/lib/engagements/states';
import type { CommandCardCopy } from './command-card-copy';
import { EngagementBoqStep } from './engagement-boq-step';
import { EngagementHeroChecklist } from './engagement-hero-checklist';
import { EngagementInlineDropzone } from './engagement-inline-dropzone';

// What stands between the headline and the button: the BOQ step at the `boq`
// stage, the inline attachment dropzone where one exists, and the guard checklist.

export function CommandCardSteps({
  engagementId,
  project,
  ctas,
  copy,
  canUpload,
  checklist,
}: {
  engagementId: string;
  project: { id: string; state: DesignState; boqSummary: BoqStepSummary | null };
  ctas: Pick<CommandCardCtas, 'dropzoneCategory' | 'dropzoneAtCapacity'>;
  copy: CommandCardCopy;
  canUpload: boolean;
  checklist: {
    items: EngagementGatePreview['items'];
    showNudgePill: boolean;
    onNudge: () => void;
  };
}) {
  const th = useTranslations('engagements.hero');
  const tg = useTranslations('engagements.guard');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  return (
    <>
      {project.state === 'boq' && (
        <EngagementBoqStep projectId={project.id} summary={project.boqSummary} />
      )}

      {ctas.dropzoneCategory && (
        <EngagementInlineDropzone
          engagementId={engagementId}
          category={ctas.dropzoneCategory}
          canUpload={canUpload}
          atCapacity={ctas.dropzoneAtCapacity}
          // The headline and the control say the SAME sentence. If they ever
          // disagree, the registry row is wrong -- that is the check.
          label={copy.actor === 'studio' ? copy.headline : undefined}
        />
      )}

      {checklist.items.length > 0 && (
        <EngagementHeroChecklist
          th={th}
          tg={tg}
          locale={locale}
          items={checklist.items}
          showNudgePill={checklist.showNudgePill}
          nudgeLabel={tcmd('nudge')}
          onNudge={checklist.onNudge}
        />
      )}
    </>
  );
}
