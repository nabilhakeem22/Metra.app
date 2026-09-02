/** Serialized client passed from the server page to the client component. */
export interface ClientRow {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  taxRegistrationNumber: string | null;
  notes: string | null;
  active: boolean;
  /** Client type (company / individual / government ...) — a table column. */
  type: string;
  /** How many projects this client has — a table column, counted in one query. */
  projectCount: number;
}
