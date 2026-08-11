import type { ProjectStatus } from '@metra/db';

export interface ProjectListItem {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  clientNameEn: string | null;
  clientNameAr: string | null;
}

export interface ClientOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}
