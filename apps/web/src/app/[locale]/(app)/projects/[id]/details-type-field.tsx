'use client';

import { Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DetailsOption } from './details-tab';

// The project-type picker cell: a type Select plus the inline "add new type"
// control. All state/handlers live in the parent (DetailsTab); this child is
// presentational, driven by the passed value + callbacks.
export function DetailsTypeField({
  t,
  tp,
  th,
  typeId,
  onTypeIdChange,
  projectTypes,
  label,
  canManage,
  pending,
  newType,
  setNewType,
  onAddType,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  tp: ReturnType<typeof useTranslations<'projects.profile.details'>>;
  th: ReturnType<typeof useTranslations<'hints.project'>>;
  typeId: string;
  onTypeIdChange: (value: string) => void;
  projectTypes: DetailsOption[];
  label: (o: DetailsOption) => string;
  canManage: boolean;
  pending: boolean;
  newType: string;
  setNewType: (value: string) => void;
  onAddType: () => void;
}) {
  // Radix Select forbids an empty-string item value, so "no type" (persisted as
  // '') rides a sentinel mapped back to '' when writing form state.
  const NO_TYPE = '__no_type__';

  return (
    <div className="space-y-2">
      <Label htmlFor="p-type" className="flex items-center">
        {tp('type')}
        <FieldHint id="p-type-hint" hint={th('type')} />
      </Label>
      <Select
        value={typeId || NO_TYPE}
        onValueChange={(v) => onTypeIdChange(v === NO_TYPE ? '' : v)}
        disabled={!canManage || pending}
      >
        <SelectTrigger id="p-type" aria-describedby="p-type-hint">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TYPE}>{t('profile.noType')}</SelectItem>
          {projectTypes.map((ty) => (
            <SelectItem key={ty.id} value={ty.id}>
              {label(ty)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canManage && (
        <div className="flex items-center gap-1">
          <Input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddType();
              }
            }}
            placeholder={tp('addTypePlaceholder')}
            aria-label={tp('addType')}
            className="h-9"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddType}
            disabled={pending || newType.trim() === ''}
          >
            <Plus className="size-4" aria-hidden />
            {tp('addType')}
          </Button>
        </div>
      )}
    </div>
  );
}
