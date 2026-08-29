'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  attachDeliverable,
  createDeliverableUpload,
  getDeliverableUrl,
} from '@/lib/engagements/actions';
import { validateDeliverableFile } from '@/lib/engagements/deliverable-files';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';

// Storage PUT deadline. A hung upload (dead Storage / lost network) must not leave
// the tray/dropzone spinner stuck forever: the AbortController below aborts the
// PUT after this, the fetch rejects, and the shared catch ends the transition +
// toasts. 60s is generous headroom for the 100MB deliverable cap.
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The shared deliverable-upload flow, extracted verbatim from the working-files
 * tray so the tray AND the command-card inline dropzone drive the SAME path with
 * NO behaviour change: friendly client pre-flight (`validateDeliverableFile`) →
 * `createDeliverableUpload` (signed URL) → PUT to Storage → `attachDeliverable`
 * (records + attests the category's artifact) → success toast → `router.refresh`.
 * No new server action. `pending` is a single shared transition flag; `upload`
 * takes an already-picked File (the caller clears its own input); `download`
 * opens a short-lived signed URL. Every failure surfaces a localized toast — the
 * caller never has to translate a code.
 */
export function useDeliverableUpload(engagementId: string): {
  pending: boolean;
  upload: (category: WorkingFileCategory, file: File) => void;
  download: (fileId: string) => void;
} {
  const t = useTranslations('engagements.files');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function upload(category: WorkingFileCategory, file: File) {
    // Friendly client-side pre-flight before we ever request a signed URL.
    const localError = validateDeliverableFile(category, file.name, file.size);
    if (localError) {
      toast({
        title: localError === 'file_too_large' ? t('tooLarge') : t('wrongType'),
        variant: 'destructive',
      });
      return;
    }

    startTransition(async () => {
      try {
        const signed = await createDeliverableUpload({
          engagementId,
          category,
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        if ('ok' in signed) {
          toast({
            title: resolveActionError(signed.error as ActionCode, te),
            variant: 'destructive',
          });
          return;
        }
        // Bound the PUT so a hung Storage origin can't wedge the spinner: abort
        // after UPLOAD_TIMEOUT_MS. The rejection (AbortError) falls into the catch
        // below, which ends the transition and toasts.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        let put: Response;
        try {
          put = await fetch(signed.signedUrl, {
            method: 'PUT',
            headers: { 'content-type': file.type, 'x-upsert': 'true' },
            body: file,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!put.ok) throw new Error('put_failed');
        const attached = await attachDeliverable({
          engagementId,
          category,
          fileId: signed.fileId,
          label: file.name,
        });
        if (!attached.ok) {
          toast({
            title: resolveActionError(attached.error as ActionCode, te),
            variant: 'destructive',
          });
          return;
        }
        toast({ title: t('uploaded') });
        router.refresh();
      } catch {
        toast({ title: te('generic'), variant: 'destructive' });
      }
    });
  }

  function download(fileId: string) {
    startTransition(async () => {
      const res = await getDeliverableUrl(fileId);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  return { pending, upload, download };
}
