// What a new delivery's choices must be before anything is sent. Pure and
// client-safe: the form runs it on Save and the core runs it on arrival. The
// title has no rule here: when both titles are empty the project lends its
// names, and only the server knows whether it has any.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import type { EngagementCreateField } from './create-fields';

export function engagementCreateFieldErrors(input: {
  clientId?: string | null;
  projectId?: string | null;
}): FieldErrors<EngagementCreateField> {
  return collectFieldErrors({
    clientId: clean(input.clientId) ? null : { code: 'engagement_client_required' },
    projectId: clean(input.projectId) ? null : { code: 'engagement_project_required' },
  });
}
