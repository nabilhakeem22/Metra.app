// The project form's state and rules, as plain functions (no React, no
// 'use client') so each rule is testable: what a NEW project starts with, how
// picking a client fills the location, and when Save is allowed.
import type { ProjectStatus } from '@metra/db';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectFormState {
  code: string;
  country: string;
  nameEn: string;
  nameAr: string;
  clientId: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  city: string;
  address: string;
  notes: string;
  /** The studio typed a city or country itself: a later client change keeps it. */
  locationEdited: boolean;
}

/** Today in the BROWSER's calendar, as the `YYYY-MM-DD` a date input holds. */
export function todayIsoLocal(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Where a project for this client is, by default: the client's city and country. */
export function locationFromClient(
  option: ClientOption | undefined,
  defaultCountry: string,
): { city: string; country: string } {
  return { city: option?.city ?? '', country: option?.country || defaultCountry };
}

/**
 * A NEW project: today's start date, no end date, and no client unless the
 * caller named one that exists (no silent first-client preselect). The status
 * is `active`; the create form does not ask for it.
 */
export function emptyProjectForm(
  clientOptions: ClientOption[],
  defaultClientId: string | undefined,
  todayIso: string,
  defaultCountry: string,
): ProjectFormState {
  const client = clientOptions.find((option) => option.id === defaultClientId);
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    clientId: client?.id ?? '',
    status: 'active',
    startDate: todayIso,
    endDate: '',
    ...locationFromClient(client, defaultCountry),
    address: '',
    notes: '',
    locationEdited: false,
  };
}

/** An EXISTING project, as the edit form holds it. */
export function projectFormOf(item: ProjectListItem): ProjectFormState {
  return {
    code: item.code,
    country: item.country ?? '',
    nameEn: item.nameEn ?? '',
    nameAr: item.nameAr ?? '',
    clientId: item.clientId,
    status: item.status,
    startDate: item.startDate ?? '',
    endDate: item.endDate ?? '',
    city: item.city ?? '',
    address: item.address ?? '',
    notes: item.notes ?? '',
    // An existing project's location is its own: never overwrite it from the client.
    locationEdited: true,
  };
}

/** Pick a client; its location follows until the studio has edited the location. */
export function withClient(
  form: ProjectFormState,
  clientId: string,
  clientOptions: ClientOption[],
  defaultCountry: string,
): ProjectFormState {
  if (form.locationEdited) return { ...form, clientId };
  const client = clientOptions.find((option) => option.id === clientId);
  return { ...form, clientId, ...locationFromClient(client, defaultCountry) };
}

/** Save needs a name, a client and, on create, a start date (the server agrees). */
export function canSaveProject(form: ProjectFormState, isCreate: boolean): boolean {
  const hasName = form.nameEn.trim() !== '' || form.nameAr.trim() !== '';
  return hasName && form.clientId !== '' && (!isCreate || form.startDate !== '');
}
