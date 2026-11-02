import { notFound } from 'next/navigation';

// Any path under a locale that no route matches: the localized 404
// (../not-found.tsx), inside the locale's own layout, so it gets the page's
// lang and dir and the site's bar instead of Next's bare English page.
export default function UnknownPage(): never {
  notFound();
}
