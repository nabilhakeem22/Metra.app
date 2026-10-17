// Where each sub-category's seeded items go in a studio's one-level sections:
// a section an earlier seed made (sections.key = market.<leaf>), else a new one
// named as the sub-category, qualified with its category when that name is
// taken; and when even the qualified name is a studio section's, that section.
// Names compare in the one comparison form (./compare.ts).
import { comparisonForm } from './compare';
import { SECTION_KEY_PREFIX, sectionKey } from './naming';
import type { ItemToCreate, MarketSeedItem, SectionToCreate, StudioBook } from './types';

type Target = ItemToCreate['section'];

/** Where one sub-category's items go: decided once per sub-category. */
export class SectionPlanner {
  readonly created = new Map<string, SectionToCreate>();
  readonly reused = new Set<string>();
  private readonly byKey = new Map<string, string>();
  private readonly studioIdByName = new Map<string, string>();
  private readonly takenNames = new Set<string>();
  private readonly decided = new Map<string, Target>();

  constructor(book: StudioBook) {
    for (const section of book.sections) {
      if (section.key) this.byKey.set(section.key, section.id);
      for (const name of [section.nameAr, section.nameEn]) {
        const form = comparisonForm(name);
        if (form === '') continue;
        this.takenNames.add(form);
        if (!this.studioIdByName.has(form)) this.studioIdByName.set(form, section.id);
      }
    }
    for (const key of this.byKey.keys()) if (key.startsWith(SECTION_KEY_PREFIX)) this.reused.add(this.byKey.get(key) as string);
  }

  private taken(nameAr: string, nameEn: string): boolean {
    return this.takenNames.has(comparisonForm(nameAr)) || this.takenNames.has(comparisonForm(nameEn));
  }

  private decide(item: MarketSeedItem): Target {
    const key = sectionKey(item.leafKey);
    const seeded = this.byKey.get(key);
    if (seeded) return { id: seeded };
    const plain = { key, nameAr: item.leafNameAr, nameEn: item.leafNameEn, qualified: false };
    const qualified = { key, nameAr: `${item.leafNameAr} (${item.topNameAr})`, nameEn: `${item.leafNameEn} (${item.topNameEn})`, qualified: true };
    const chosen = this.taken(plain.nameAr, plain.nameEn) ? qualified : plain;
    const sameName = this.studioIdByName.get(comparisonForm(chosen.nameAr)) ?? this.studioIdByName.get(comparisonForm(chosen.nameEn));
    if (chosen.qualified && sameName) {
      this.reused.add(sameName);
      return { id: sameName };
    }
    this.created.set(key, chosen);
    this.takenNames.add(comparisonForm(chosen.nameAr)).add(comparisonForm(chosen.nameEn));
    return { key };
  }

  target(item: MarketSeedItem): Target {
    const known = this.decided.get(item.leafKey);
    if (known) return known;
    const target = this.decide(item);
    this.decided.set(item.leafKey, target);
    return target;
  }
}
