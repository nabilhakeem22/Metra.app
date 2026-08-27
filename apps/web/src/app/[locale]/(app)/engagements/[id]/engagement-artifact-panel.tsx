'use client';

import type { useTranslations } from 'next-intl';
import type { EngagementArtifactKind } from '@metra/db';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionResult } from '@/lib/actions/result';
import { recordArtifact } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const ARTIFACT_KINDS: EngagementArtifactKind[] = [
  'survey',
  'autocad',
  'concept_option',
  'approved_render',
  'shop_drawing',
  'boq',
];

// The "record an artifact" panel of the cockpit toolbar. All state lives in the
// parent and arrives via props (verbatim JSX); `after` closes the panel on success.
export function ArtifactPanel({
  t,
  ta,
  pending,
  engagementId,
  artKind,
  setArtKind,
  artLabel,
  setArtLabel,
  artHash,
  setArtHash,
  after,
  onCancel,
}: {
  t: ReturnType<typeof useTranslations<'engagements.controls'>>;
  ta: ReturnType<typeof useTranslations<'engagements.artifactKind'>>;
  pending: boolean;
  engagementId: string;
  artKind: EngagementArtifactKind;
  setArtKind: (kind: EngagementArtifactKind) => void;
  artLabel: string;
  setArtLabel: (value: string) => void;
  artHash: string;
  setArtHash: (value: string) => void;
  after: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="art-kind">{t('kind')}</Label>
          <Select
            value={artKind}
            onValueChange={(v) => setArtKind(v as EngagementArtifactKind)}
          >
            <SelectTrigger id="art-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTIFACT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {ta(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="art-label">{t('label')}</Label>
          <Input id="art-label" value={artLabel} onChange={(e) => setArtLabel(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="art-hash">{t('contentHash')}</Label>
        <Input
          id="art-hash"
          dir="ltr"
          value={artHash}
          onChange={(e) => setArtHash(e.target.value)}
        />
      </div>
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={() =>
          after(() =>
            recordArtifact({
              engagementId,
              kind: artKind,
              label: artLabel.trim() || null,
              contentHash: artHash.trim() || null,
            }),
          )
        }
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
