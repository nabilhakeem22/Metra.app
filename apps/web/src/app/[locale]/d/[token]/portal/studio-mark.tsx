'use client';

import { useEffect, useRef, useState } from 'react';
import { tokenPathSegment } from '@/lib/engagements/portal-path';

/**
 * The studio's mark on the client page's bar: its logo when it has one, else
 * the first letter of its name. The logo is the logo route's streamed
 * rendition (never a storage URL); if it fails to load (no image logo after
 * all, a revoked link, a Storage blip) the initial takes its place, including
 * a failure that happened before hydration, when `onError` had no listener
 * yet. Decorative: the studio's name is written right beside it.
 */
export function StudioMark({
  firmName,
  hasLogo,
  token,
  locale,
}: {
  firmName: string;
  hasLogo: boolean;
  token: string;
  locale: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = logo.current;
    if (image?.complete && image.naturalWidth === 0) setLogoFailed(true);
  }, []);
  if (hasLogo && !logoFailed) {
    return (
      <img
        ref={logo}
        src={`/${locale}/d/${tokenPathSegment(token)}/logo`}
        width={40}
        height={40}
        alt=""
        className="size-10 shrink-0 rounded-item object-contain"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-item bg-primary/10 text-title font-bold text-primary"
      aria-hidden
    >
      {firmName.trim().charAt(0) || 'M'}
    </div>
  );
}
