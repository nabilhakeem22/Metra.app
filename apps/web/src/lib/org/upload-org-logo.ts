import { err, ok, type ActionResult } from '@/lib/actions/result';
import { createLogoUpload, setOrgLogo } from './logo-actions';

/**
 * Uploads a new logo for the caller's studio: sign, PUT the bytes, attach.
 * Answers why it failed (a refused file, a role that may not, Storage that did
 * not take the bytes); a network failure rejects, and the caller describes it.
 */
export async function uploadOrgLogo(file: File): Promise<ActionResult> {
  const signed = await createLogoUpload({ contentType: file.type, originalName: file.name, size: file.size });
  // A refused signing (a demoted user, a type or size the rule refuses) answers an ActionResult.
  if ('ok' in signed) return signed;
  const uploaded = await fetch(signed.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type, 'x-upsert': 'true' },
    body: file,
  });
  if (!uploaded.ok) return err('storage_unavailable');
  const attached = await setOrgLogo(signed.fileId);
  return attached.ok ? ok() : attached;
}
