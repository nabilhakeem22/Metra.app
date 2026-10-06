// The "Start delivery" form's rules, as plain functions (no React, no
// 'use client') so they can be tested without a sheet: which field a server
// refusal belongs under, and when the form may submit at all.
import type { ActionCode } from '@/lib/actions/result';

/** A project the form may start a delivery on, with the client it belongs to. */
export interface ProjectOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
}

/** A project's names, which the delivery title defaults to. */
export type ProjectNames = { nameEn: string | null; nameAr: string | null };

/** Where a refusal is shown: under its field, or above the form. */
export type DeliveryFormField = 'title' | 'client' | 'project' | 'form';

const FIELD_OF: Partial<Record<ActionCode, DeliveryFormField>> = {
  engagement_title_required: 'title',
  engagement_client_required: 'client',
  engagement_project_required: 'project',
  project_delivery_exists: 'project',
  project_delivery_limit_reached: 'project',
};

export function deliveryFieldFor(code: ActionCode): DeliveryFormField {
  return FIELD_OF[code] ?? 'form';
}

/** A delivery needs both a client and a project; the title may default to the project's. */
export function canSubmitDelivery(selection: { clientId: string; projectId: string }): boolean {
  return selection.clientId !== '' && selection.projectId !== '';
}
