import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { LandingNav } from '@/components/landing/landing-nav';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import '../landing.css';

// The (auth) OTP steps are an internal sign-in surface — never index them.
export const metadata: Metadata = PRIVATE_METADATA;

/**
 * The sign-in route, with the site's own top bar above it — so someone who
 * landed on the form can get back out to the site, and the wordmark returns them
 * home in one click.
 *
 * WHY HERE AND NOT IN `AuthShell`. That shell is shared with onboarding and the
 * invite-acceptance page. Onboarding happens AFTER sign-in, and somebody already
 * inside the product does not want a marketing nav offering them the pricing
 * page. Scoping the bar to this route group puts it on the sign-in screen and
 * nowhere else.
 *
 * The `.landing` wrapper is load-bearing, not decorative: the nav's rules read
 * `--l-line`, `--l-muted` and `--l-ink`, which are declared on that class rather
 * than on `:root`. Without it the bar renders with no colours at all.
 *
 * `--auth-chrome` tells the shell below how much vertical room the bar took, so
 * the card still centres in what is left instead of pushing a scrollbar onto a
 * page that should be exactly one screen tall.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="landing" style={{ '--auth-chrome': '64px' } as CSSProperties}>
      <LandingNav variant="return" />
      {children}
    </div>
  );
}
