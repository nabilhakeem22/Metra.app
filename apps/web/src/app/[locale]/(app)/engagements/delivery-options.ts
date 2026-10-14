// What the "Start delivery" form picks from. Types only, so the form, its
// fields and its hook share them without a runtime import.

/** A project the form may start a delivery on, with the client it belongs to. */
export interface ProjectOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
}

export type { ProjectNames } from '@/lib/engagements/create-fields';
