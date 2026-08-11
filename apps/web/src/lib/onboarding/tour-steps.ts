// Guided-tour step registry. Anchors are explicit `data-tour="<id>"` attributes
// on real elements — locale- and DOM-order-independent. A missing anchor makes
// the coachmark self-skip (never throws). Pure + client-safe.

export interface TourStep {
  id: string;
  /** Locale-stripped route the step lives on (matches next-intl usePathname). */
  page: string;
  /** The `data-tour` value of the element to spotlight. */
  anchor: string;
  titleKey: string;
  bodyKey: string;
  placement?: 'top' | 'bottom' | 'start' | 'end';
  order: number;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', page: '/dashboard', anchor: 'dashboard-checklist', titleKey: 'tour.welcome.title', bodyKey: 'tour.welcome.body', placement: 'bottom', order: 1 },
  { id: 'clients', page: '/clients', anchor: 'clients-new', titleKey: 'tour.clients.title', bodyKey: 'tour.clients.body', placement: 'bottom', order: 2 },
  { id: 'projects', page: '/projects', anchor: 'projects-new', titleKey: 'tour.projects.title', bodyKey: 'tour.projects.body', placement: 'bottom', order: 3 },
  { id: 'priceBook', page: '/price-book', anchor: 'price-book-new', titleKey: 'tour.priceBook.title', bodyKey: 'tour.priceBook.body', placement: 'bottom', order: 4 },
  { id: 'proposals', page: '/proposals', anchor: 'proposals-new', titleKey: 'tour.proposals.title', bodyKey: 'tour.proposals.body', placement: 'bottom', order: 5 },
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

export function stepById(id: string | null | undefined): TourStep | undefined {
  if (!id) return undefined;
  return TOUR_STEPS.find((s) => s.id === id);
}
