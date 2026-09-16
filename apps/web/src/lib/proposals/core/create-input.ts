// Shape-checking what the builder posted, BEFORE the transaction opens.
//
// PURE — no db, no `server-only`, no `fail`: it RETURNS a code rather than
// throwing, because nothing has been opened yet and there is nothing to roll
// back.
import type { ActionCode } from '@/lib/actions/result';
import { isUuid } from '@/lib/uuid';
import { validIsoDate } from '@/lib/validation/iso-date';
import { clean } from '@/lib/validation/text';
import type { CreateProposalInput } from './types';

/** The input after trimming, with every id and date proved well-formed. */
export interface ValidatedCreateInput {
  clientId: string;
  projectId: string;
  issueDate: string | null;
  expiryDate: string | null;
}

/**
 * Shape-check the input BEFORE the transaction opens.
 *
 * A malformed client id answers `client_required` rather than `invalid`, because
 * "pick a client" is what the studio can actually do about it.
 */
export function validateCreateInput(
  input: CreateProposalInput,
): ValidatedCreateInput | ActionCode {
  const clientId = input.clientId?.trim();
  const projectId = input.projectId?.trim();
  if (!clientId || !isUuid(clientId)) return 'client_required';
  if (!projectId || !isUuid(projectId)) return 'invalid';
  const issueDate = clean(input.issueDate);
  const expiryDate = clean(input.expiryDate);
  if (issueDate && !validIsoDate(issueDate)) return 'invalid_date';
  if (expiryDate && !validIsoDate(expiryDate)) return 'invalid_date';
  return { clientId, projectId, issueDate, expiryDate };
}
