// The "Start delivery" form's fields. A plain module, so the client form, the
// pure rules and the server core share it. `title` is the Arabic/English pair:
// one of them is enough, and the project lends its names when both are empty.
import { clean } from '@/lib/validation/text';

export const ENGAGEMENT_CREATE_FIELDS = ['title', 'clientId', 'projectId'] as const;

export type EngagementCreateField = (typeof ENGAGEMENT_CREATE_FIELDS)[number];

/** A project's names, which a delivery's title defaults to. */
export type ProjectNames = { nameEn: string | null; nameAr: string | null };

/** A new delivery's titles: the typed ones, or the project's names when neither was typed. */
export function titlesForNewEngagement(
  typedTitleAr: string | null,
  typedTitleEn: string | null,
  project: ProjectNames,
): { titleAr: string | null; titleEn: string | null } {
  const typedAnyTitle = Boolean(typedTitleAr || typedTitleEn);
  const titleAr = typedAnyTitle ? typedTitleAr : clean(project.nameAr);
  const titleEn = typedAnyTitle ? typedTitleEn : clean(project.nameEn);
  return { titleAr, titleEn };
}
