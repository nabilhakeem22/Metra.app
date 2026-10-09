import { createLogoUpload, setOrgLogo } from '@/lib/org/logo-actions';

/**
 * Best-effort logo upload for the studio just created: sign, PUT the bytes,
 * attach. Answers false on any failure and never throws, because the studio
 * exists either way; the caller says so in a toast rather than failing the
 * onboarding.
 */
export async function uploadOnboardingLogo(file: File): Promise<boolean> {
  try {
    const signed = await createLogoUpload({ contentType: file.type, originalName: file.name, size: file.size });
    // A refused signing (a demoted user, a type or size the rule refuses) answers an ActionResult.
    if ('ok' in signed) return false;
    const uploaded = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type, 'x-upsert': 'true' },
      body: file,
    });
    if (!uploaded.ok) return false;
    return (await setOrgLogo(signed.fileId)).ok;
  } catch {
    return false;
  }
}
