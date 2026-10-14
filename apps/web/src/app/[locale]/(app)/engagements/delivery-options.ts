// What the "Start delivery" form picks from. Types only, so the form, its
// fields and its hook share them without a runtime import.

/** A project the form may start a delivery on, with the client it belongs to. */
export interface ProjectOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
}

/** A project's names, which the delivery title defaults to. */
export type ProjectNames = { nameEn: string | null; nameAr: string | null };
