'use client';

import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  commitBoqImport,
  createBoq,
  previewBoqImport,
  type ImportPreview,
} from '@/lib/boqs/actions';

/**
 * The two ways a BOQ starts: download the template and upload it back, or create
 * an empty one and price it in the app.
 *
 * The template is generated from the studio's price book, so the returned file
 * already carries codes, units and rates — the studio types quantities. Rows
 * left without a quantity are items this project does not use and are skipped,
 * which is what makes a catalogue-sized sheet workable.
 */
export function BoqStart({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.profile.boq');
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [boqId, setBoqId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(file: File): void {
    start(async () => {
      try {
        const text = await file.text();
        const res = await previewBoqImport(text);
        if (!res.ok) {
          toast({ title: t('importFailed'), variant: 'destructive' });
          return;
        }
        setPreview(res);
      } catch {
        toast({ title: t('importFailed'), variant: 'destructive' });
      }
    });
  }

  function onCommit(): void {
    if (!preview?.lines?.length) return;
    start(async () => {
      try {
        // Create the document only once the studio has seen what will land in
        // it — an abandoned preview should not leave an empty BOQ behind.
        let id = boqId;
        if (!id) {
          const created = await createBoq({ projectId, titleEn: 'Bill of Quantities' });
          if (!created.ok || !created.data) {
            toast({ title: t('importFailed'), variant: 'destructive' });
            return;
          }
          id = created.data;
          setBoqId(id);
        }
        const res = await commitBoqImport({ boqId: id, lines: preview.lines ?? [] });
        if (!res.ok) {
          toast({ title: t('importFailed'), variant: 'destructive' });
          return;
        }
        toast({ title: t('imported', { count: String(res.data ?? 0) }) });
        setPreview(null);
      } catch {
        toast({ title: t('importFailed'), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="glass space-y-4 p-5">
      <div>
        <p className="font-semibold text-[color:var(--text)]">{t('startTitle')}</p>
        <p className="text-sm text-[color:var(--text-muted)]">{t('startBody')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href="/boq/template" download>
            <Download className="size-4" aria-hidden />
            {t('downloadTemplate')}
          </a>
        </Button>

        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {t('uploadSheet')}
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so choosing the SAME file twice still fires a change event —
            // which is exactly what happens after a failed import is corrected.
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>

      {preview && (
        <div className="space-y-3 rounded-item border border-[color:var(--rule)] p-4">
          <p className="text-sm font-semibold text-[color:var(--text)]">
            {t('previewTitle', { count: String(preview.lines?.length ?? 0) })}
          </p>

          {preview.notes?.map((note) => (
            <p key={note} className="text-xs text-[color:var(--text-muted)]">
              {note}
            </p>
          ))}

          {preview.problems && preview.problems.length > 0 && (
            <div className="space-y-1">
              <p
                className="text-xs font-semibold"
                style={{ color: 'var(--danger)' }}
              >
                {t('previewProblems', { count: String(preview.problems.length) })}
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-[color:var(--text-muted)]">
                {preview.problems.slice(0, 20).map((p) => (
                  <li key={p.rowNumber}>
                    {t('rowLabel', { row: String(p.rowNumber) })} — {p.errors.join('; ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={onCommit} disabled={pending || !preview.lines?.length}>
              {t('commitImport')}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={pending}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
