// PURE core for org creation (no next/*, no getSessionUser, no cookies). The
// 'use server' createOrg wrapper does the session/existing-check/redirect and
// delegates here. Exercised directly by tests/actions/createOrg.dbtest.ts.
import { fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { FLOWS } from '@/lib/entitlements/flows';
import { firmTypeDef, type FirmTypeKey } from '@/lib/entitlements/firm-types';
import { foundStudio, provisionWorkspace, seedStudioDefaults } from './founding-writes';
import { readOrgProfile, type OrgProfileText } from './profile-field-rules';

export interface OrgProfileInput extends OrgProfileText {
  // The chosen firm-type preset (Epic B1). Resolves server-side to the
  // workspace's enabled_flows set — the client NEVER supplies a raw flow array.
  // Defaults to 'interior' so existing callers keep their behaviour.
  firmType?: FirmTypeKey;
}

/**
 * Creates the org + owner membership + audit atomically. `ctx` must carry the
 * NEW orgId + the founding user (role owner). Returns a coded ActionResult.
 */
export async function createOrgCore(
  ctx: OrgContext,
  input: OrgProfileInput,
): Promise<ActionResult> {
  // Every text cap and the either-or name, each under its own field.
  const profile = readOrgProfile(input);
  if (!profile.ok) return fieldsFailed(profile.errors);
  const { nameEn, nameAr, city, taxRegistrationNumber } = profile.values;

  // Resolve + validate the firm type SERVER-SIDE (defense-in-depth: the action is
  // directly invokable, so a hidden/disabled UI option is not a gate). We only
  // ever accept the firmType KEY — never a raw client-supplied flow array — and
  // map it to enabled_flows here. Runs BEFORE mutateInOrg, so a rejected type
  // opens no transaction and writes zero rows.
  const firmType: FirmTypeKey = input.firmType ?? 'interior';
  const firmTypeDefinition = firmTypeDef(firmType);
  if (!firmTypeDefinition || !firmTypeDefinition.available) {
    return err('firm_type_unavailable');
  }
  const flows = firmTypeDefinition.enabledFlows;
  if (flows.length === 0 || !flows.every((flow) => FLOWS.includes(flow))) {
    return err('firm_type_unavailable');
  }

  return mutateInOrg(ctx, {}, async (tx, audit) => {
    await foundStudio(tx, ctx, { nameEn, nameAr, city, taxRegistrationNumber });
    await provisionWorkspace(tx, ctx, flows);
    await seedStudioDefaults(tx, ctx);
    await audit({
      entity: 'organization',
      entityId: ctx.orgId,
      action: 'create',
      before: null,
      // camelCase to match updateOrgProfile's audit shape — one key path for
      // the organization entity's history.
      after: { nameEn, nameAr, city, taxRegistrationNumber },
    });
  });
}
