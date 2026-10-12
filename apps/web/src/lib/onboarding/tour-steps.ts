// Guided-tour step registry. Anchors are explicit `data-tour="<id>"` attributes
// on real elements — locale- and DOM-order-independent. A missing anchor makes
// the coachmark self-skip (never throws). Pure + client-safe.

export interface TourStep {
  id: string;
  /** Locale-stripped route the step lives on (matches next-intl usePathname). */
  page: string;
  /** The `data-tour` value of the element to spotlight. */
  anchor: string;
  /** Keys under the `tour` namespace (the coachmark reads only that one). */
  titleKey: string;
  bodyKey: string;
  placement?: 'top' | 'bottom' | 'start' | 'end';
  order: number;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', page: '/dashboard', anchor: 'dashboard-checklist', titleKey: 'welcome.title', bodyKey: 'welcome.body', placement: 'bottom', order: 1 },
  { id: 'clients', page: '/clients', anchor: 'clients-new', titleKey: 'clients.title', bodyKey: 'clients.body', placement: 'bottom', order: 2 },
  { id: 'projects', page: '/projects', anchor: 'projects-new', titleKey: 'projects.title', bodyKey: 'projects.body', placement: 'bottom', order: 3 },
  { id: 'deliveries', page: '/engagements', anchor: 'engagements-new', titleKey: 'deliveries.title', bodyKey: 'deliveries.body', placement: 'bottom', order: 4 },
];

function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Steps anchored on the given (locale-stripped) pathname. */
export function stepsForPage(pathname: string): TourStep[] {
  const norm = normalizePath(pathname);
  return TOUR_STEPS.filter((s) => s.page === norm).sort((a, b) => a.order - b.order);
}
