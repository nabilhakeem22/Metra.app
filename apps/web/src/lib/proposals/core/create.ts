// Creating a proposal: the client/project usability guard and the first row.
// The server recomputes EVERY total from the money engine and never trusts a
// client-supplied subtotal/total, so nothing numeric enters here.
//
// This file was `lib/proposals/core.ts`, which also re-exported the SHARED
// kernels — the one habit that made contracts, variations, boqs and both PDF
// routes import the PROPOSALS module to reach a percentage check or a chunked
// insert. The kernels now live in lib/{lines,money,validation,share}.
import { clients, projects, proposals, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import { allocateNumber } from '@/lib/db/allocate-number';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { clean } from '@/lib/validation/text';
import {
  validateCreateInput,
  type ValidatedCreateInput,
} from './create-input';
import type { CreateProposalInput } from './types';

export type { CreateProposalInput } from './types';

/** Both parents must exist IN THIS ORG and be active before a proposal names them. */
async function assertClientProjectUsable(
  tx: MetraDb,
  clientId: string,
  projectId: string,
): Promise<void> {
  const [client] = await tx
    .select({ active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || !client.active) fail('client_required');
  const [project] = await tx
    .select({ active: projects.active })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || !project.active) fail('invalid');
}

/**
 * The stored title. The database requires one, and a studio may legitimately
 * create a proposal before it has decided what to call it, so an untitled one is
 * named after its own display number rather than refused.
 */
function defaultedTitles(
  input: CreateProposalInput,
  number: number,
  issueDate: string | null,
): { titleAr: string | null; titleEn: string | null } {
  const titleAr = clean(input.titleAr);
  const titleEn = clean(input.titleEn);
  if (titleEn || titleAr) return { titleAr, titleEn };
  return {
    titleAr,
    titleEn: formatProposalNumber(number, proposalYear(issueDate, new Date())),
  };
}

/** Per-org numbering, serialized by a transaction-scoped advisory lock. */
function allocateProposalNumber(tx: MetraDb, orgId: string): Promise<number> {
  return allocateNumber(tx, orgId, 'proposals', 'proposals', 'number');
}

/** Insert the proposal row and return its id. No money enters here. */
async function persistNewProposal(
  tx: MetraDb,
  orgId: string,
  number: number,
  validated: ValidatedCreateInput,
  input: CreateProposalInput,
): Promise<string> {
  const [row] = await tx
    .insert(proposals)
    .values({
      orgId,
      number,
      ...defaultedTitles(input, number, validated.issueDate),
      clientId: validated.clientId,
      projectId: validated.projectId,
      issueDate: validated.issueDate,
      expiryDate: validated.expiryDate,
    })
    .returning({ id: proposals.id });
  return row.id;
}

/** The ledger entry a new proposal leaves: which number, for whom, on what. */
function auditProposalCreated(
  audit: (entry: AuditEntry) => Promise<void>,
  proposalId: string,
  number: number,
  validated: ValidatedCreateInput,
): Promise<void> {
  return audit({
    entity: 'proposal',
    entityId: proposalId,
    action: 'create',
    before: null,
    after: {
      number,
      client_id: validated.clientId,
      project_id: validated.projectId,
    },
  });
}

export async function createProposalCore(
  ctx: OrgContext,
  input: CreateProposalInput,
): Promise<ActionResult> {
  const validated = validateCreateInput(input);
  if (typeof validated === 'string') return err(validated);

  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      await assertClientProjectUsable(tx, validated.clientId, validated.projectId);
      const number = await allocateProposalNumber(tx, ctx.orgId);
      const proposalId = await persistNewProposal(
        tx,
        ctx.orgId,
        number,
        validated,
        input,
      );
      await auditProposalCreated(audit, proposalId, number, validated);
      return proposalId;
    },
  );
}
