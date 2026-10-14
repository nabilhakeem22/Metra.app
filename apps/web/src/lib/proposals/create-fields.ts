// What a new proposal must name, checked BEFORE the transaction opens.
//
// PURE and client-safe: the create form runs `proposalCreateFieldErrors` on
// Submit and the core runs it again. It RETURNS rather than throwing, because
// nothing has been opened yet and there is nothing to roll back.
import { fieldsFailed, hasFieldErrors, type FieldError, type FieldErrors } from '@/lib/actions/field-errors';
import { err, type ActionResult } from '@/lib/actions/result';
import { isUuid } from '@/lib/uuid';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { validIsoDate } from '@/lib/validation/iso-date';
import { clean } from '@/lib/validation/text';
import type { CreateProposalInput } from './core/types';

export const PROPOSAL_CREATE_FIELDS = ['clientId', 'projectId', 'issueDate', 'expiryDate'] as const;
export type ProposalCreateField = (typeof PROPOSAL_CREATE_FIELDS)[number];

/** The input after trimming, with every id and date proved well-formed. */
export interface ValidatedCreateInput {
  clientId: string;
  projectId: string;
  issueDate: string | null;
  expiryDate: string | null;
}

const dateRefusal = (date: string | null): FieldError | null =>
  date && !validIsoDate(date) ? { code: 'invalid_date' } : null;

/** A client and a project chosen, and each date (optional) a real day. */
export function proposalCreateFieldErrors(input: CreateProposalInput): FieldErrors<ProposalCreateField> {
  return collectFieldErrors({
    clientId: clean(input.clientId) ? null : { code: 'client_required' },
    projectId: clean(input.projectId) ? null : { code: 'required' },
    issueDate: dateRefusal(clean(input.issueDate)),
    expiryDate: dateRefusal(clean(input.expiryDate)),
  });
}

/** The validated input, or the answer that refuses it: every field at once,
 *  then an id no select can send (`malformed`). */
export function validateCreateInput(
  input: CreateProposalInput,
): { ok: true; value: ValidatedCreateInput } | { ok: false; refusal: ActionResult } {
  const errors = proposalCreateFieldErrors(input);
  if (hasFieldErrors(errors)) return { ok: false, refusal: fieldsFailed(errors) };
  const clientId = input.clientId.trim();
  const projectId = input.projectId.trim();
  if (!isUuid(clientId) || !isUuid(projectId)) return { ok: false, refusal: err('malformed') };
  return {
    ok: true,
    value: {
      clientId,
      projectId,
      issueDate: clean(input.issueDate),
      expiryDate: clean(input.expiryDate),
    },
  };
}
