'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FormActions({
  pending,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {saveLabel}
      </Button>
    </div>
  );
}
