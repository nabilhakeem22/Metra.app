'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
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

/**
 * The "record an attested deliverable" form, opened from the Files tab header.
 *
 * It OWNS its fields now. They used to be lifted into the cockpit toolbar, which
 * made sense while one parent multiplexed four panels; with each action filed
 * beside the record it produces there is no shared parent left to lift into, and
 * a form that owns its own draft is the simpler object. Closing and reopening
 * therefore clears the draft — correct for an append-only record.
 */
export function ArtifactPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const ta = useTranslations('engagements.artifactKind');
  const [kind, setKind] = useState<EngagementArtifactKind>('survey');
  const [label, setLabel] = useState('');
  const [hash, setHash] = useState('');

  function save() {
    runAction(async () => {
      const res = await recordArtifact({
        engagementId,
        kind,
        label: label.trim() || null,
        contentHash: hash.trim() || null,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="art-kind">{t('kind')}</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as EngagementArtifactKind)}
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
        <div className="space-y-1.5">
          <Label htmlFor="art-label">{t('label')}</Label>
          <Input
            id="art-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="art-hash">{t('contentHash')}</Label>
        <Input
          id="art-hash"
          dir="ltr"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
        />
      </div>
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
