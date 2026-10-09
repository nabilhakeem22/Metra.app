'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';

/**
 * Open the client-link dialog ONCE when the page was reached through the
 * dashboard's "Share with your client" step (`?share=1`), then drop the flag
 * from the address, so a refresh or Back does not open it again. The caller
 * renders only for a role that may share, so the flag never opens a dialog
 * the server would refuse.
 */
export function useOpenOnShareLink(open: () => void): void {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (searchParams?.get('share') !== '1') return;
    open();
    router.replace(pathname, { scroll: false });
  }, [searchParams, pathname, router, open]);
}
