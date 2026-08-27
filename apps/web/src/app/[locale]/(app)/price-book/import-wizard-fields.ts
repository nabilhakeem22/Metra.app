import type { ColumnMapping } from '@/lib/price-book/import';

// Column-mapping field config for the import wizard. Kept in a plain (non-client)
// module so both the wizard orchestrator and the extracted map step share one
// source of truth (the wizard reads REQUIRED for its `mappingReady` gate; the map
// step renders FIELDS / REQUIRED / NONE). Server-safe constants pattern.
export type FieldKey = keyof ColumnMapping;

export const REQUIRED: FieldKey[] = ['code', 'category', 'unit', 'cost', 'price'];

export const FIELDS: FieldKey[] = [
  'code',
  'nameEn',
  'nameAr',
  'category',
  'unit',
  'cost',
  'price',
];

export const NONE = -1;
