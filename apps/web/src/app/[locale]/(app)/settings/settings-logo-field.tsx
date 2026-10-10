'use client';

import { Loader2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type RefObject } from 'react';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { LOGO_ACCEPT } from '@/lib/org/logo-rules';
import { ownLogoPath } from '@/lib/org/own-logo-path';
import { uploadOrgLogo } from '@/lib/org/upload-org-logo';

/** A picked file's local preview, and the saved logo it was picked over. */
interface PickedLogo {
  url: string;
  over: string | null;
}

/**
 * The studio's logo in Settings: the SAVED logo (the /settings/logo route) by
 * default, the picked file's local preview while it uploads, then, once the
 * upload is attached, the page refreshes and the new saved logo takes over (a
 * new `savedLogoId`, which also retires the preview). A failed upload drops the
 * preview back to the saved logo. A saved logo that fails to load (not an
 * image after all, a Storage blip) shows the upload icon instead, including a
 * failure before hydration, when `onError` had no listener yet.
 */
export function SettingsLogoField({ savedLogoId, disabled }: { savedLogoId: string | null; disabled: boolean }) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const [uploading, startUpload] = useTransition();
  const [picked, setPicked] = useState<PickedLogo | null>(null);
  const [failedLogoId, setFailedLogoId] = useState<string | null>(null);
  const savedImage = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = savedImage.current;
    if (image?.complete && image.naturalWidth === 0) setFailedLogoId(savedLogoId);
  }, [savedLogoId]);
  // A preview's object URL is released once another pick, a failure or leaving
  // the page replaces it.
  useEffect(() => {
    if (!picked) return undefined;
    return () => URL.revokeObjectURL(picked.url);
  }, [picked]);

  function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so the same file can be picked again after a failure.
    event.target.value = '';
    if (!file) return;
    setPicked({ url: URL.createObjectURL(file), over: savedLogoId });
    startUpload(async () => {
      if (await uploadOrgLogo(file)) {
        toast({ title: t('logoUpdated') });
        router.refresh();
      } else {
        setPicked(null);
        toast({ title: t('errorGeneric'), variant: 'destructive' });
      }
    });
  }

  const previewUrl = picked && picked.over === savedLogoId ? picked.url : null;
  const savedUrl = savedLogoId && failedLogoId !== savedLogoId ? ownLogoPath(locale, savedLogoId) : null;

  return (
    <div className="flex items-center gap-3">
      <LogoThumbnail
        previewUrl={previewUrl}
        savedUrl={savedUrl}
        savedImage={savedImage}
        onSavedError={() => setFailedLogoId(savedLogoId)}
      />
      <input
        id="logo"
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        onChange={pickLogo}
        disabled={disabled || uploading}
      />
      <Label
        htmlFor="logo"
        className="inline-flex h-9 cursor-pointer items-center rounded-pill border border-input px-3 text-body font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
        aria-disabled={disabled || uploading}
      >
        {uploading && <Loader2 className="me-2 size-4 animate-spin" aria-hidden />}
        {t('changeLogo')}
      </Label>
    </div>
  );
}

const THUMBNAIL_CLASS = 'size-12 rounded-item border object-contain';

/** The preview if one is showing, else the saved logo, else the upload icon. */
function LogoThumbnail({
  previewUrl,
  savedUrl,
  savedImage,
  onSavedError,
}: {
  previewUrl: string | null;
  savedUrl: string | null;
  savedImage: RefObject<HTMLImageElement | null>;
  onSavedError: () => void;
}) {
  if (previewUrl) return <img src={previewUrl} alt="" className={THUMBNAIL_CLASS} />;
  if (savedUrl) {
    return <img ref={savedImage} src={savedUrl} alt="" className={THUMBNAIL_CLASS} onError={onSavedError} />;
  }
  return (
    <div className="flex size-12 items-center justify-center rounded-item bg-muted text-muted-foreground">
      <Upload className="size-5" aria-hidden />
    </div>
  );
}
