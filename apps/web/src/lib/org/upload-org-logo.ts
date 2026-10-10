import { createLogoUpload, setOrgLogo } from './logo-actions';

/**
 * Uploads a new logo for the caller's studio: sign, PUT the bytes, attach.
 * Answers whether the logo is now the studio's, and never throws: the caller
 * (Settings, the onboarding) says so in a toast rather than failing its page.
 */
export async function uploadOrgLogo(file: File): Promise<boolean> {
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
