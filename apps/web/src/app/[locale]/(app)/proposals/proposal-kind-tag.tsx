import { useTranslations } from 'next-intl';

/**
 * The "BOQ" tag a delivery's BOQ working copy shows IN PLACE OF its Q- number,
 * which is never rendered for one. No directive: it renders inside both the
 * client register and the server-rendered project tab.
 */
export function ProposalKindTag() {
  const t = useTranslations('proposals.kindTag');
  return (
    <span className="inline-flex rounded-pill bg-[color:var(--brand-tint)] px-2 py-0.5 text-caption font-medium text-[color:var(--brand-ink)]">
      {t('boq')}
    </span>
  );
}
