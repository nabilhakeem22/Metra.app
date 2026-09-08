import 'server-only';
import {
  boqs,
  clients,
  designEngagements,
  engagementArtifacts,
  organizations,
  projects,
} from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { buildBoqHtml, formatBoqNumber } from '@/lib/pdf/boq-template';
import { renderPdf } from '@/lib/pdf/render';
import { storeGeneratedFile } from '@/lib/storage';
import { getProjectBoq } from './queries';

/**
 * Issue a BOQ — the single action that joins the structured document to the
 * delivery flow.
 *
 * It does four things, and the ORDER matters:
 *   1. renders the CLIENT PDF from the frozen line data,
 *   2. stores it as a file,
 *   3. freezes the BOQ (draft -> issued) and stamps the issue date,
 *   4. records that file as the engagement's `boq` artifact.
 *
 * Step 4 is what makes everything downstream work UNCHANGED. `boqPresent` counts
 * boq artifacts, so the guard is satisfied without touching it;
 * `app_document_access` withholds a `boq` from the client until the balance
 * clears, so the payment rule holds without touching it either. The structured
 * BOQ is the source and the PDF is its rendition, rather than two competing
 * notions of "the BOQ".
 *
 * FREEZING IS LOAD-BEARING. Once issued, the PDF in the client's hands and the
 * rows in the database must never drift apart; a later change becomes a new
 * version that supersedes, producing its own artifact.
 *
 * The render happens OUTSIDE the write transaction. Chromium takes seconds and a
 * transaction held open across it would hold row locks for that whole time — so
 * the bytes are produced first and the database work is short.
 */
export async function issueBoqCore(
  ctx: OrgContext,
  input: { boqId: string; locale: string },
): Promise<ActionResult & { data?: string }> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: boqs.id,
        status: boqs.status,
        projectId: boqs.projectId,
        engagementId: boqs.engagementId,
        clientId: boqs.clientId,
        createdAt: boqs.createdAt,
      })
      .from(boqs)
      .where(eq(boqs.id, input.boqId))
      .limit(1),
  );
  if (!row) return err('boq_not_found');
  if (row.status !== 'draft') return err('boq_not_draft');

  // Read it through the same query the screen uses, with cost included: the
  // INTERNAL copy needs it, and the client copy strips it in the template.
  const detail = await getProjectBoq(ctx, row.projectId, { showCost: true });
  if (!detail || detail.id !== row.id) return err('boq_not_found');
  if (detail.lineCount === 0) return err('invalid');

  // An engagement is required: the artifact hangs off one, and it is how the
  // client ever sees this document. Resolved here rather than at creation so a
  // BOQ built before the engagement existed can still be issued.
  const engagementId =
    row.engagementId ?? (await soleActiveEngagement(ctx, row.projectId));
  if (!engagementId) return err('engagement_not_found');

  const [meta] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        orgAr: organizations.nameAr,
        orgEn: organizations.nameEn,
        clientAr: clients.nameAr,
        clientEn: clients.nameEn,
        projectAr: projects.nameAr,
        projectEn: projects.nameEn,
      })
      .from(boqs)
      .innerJoin(organizations, eq(organizations.id, boqs.orgId))
      .innerJoin(clients, eq(clients.id, boqs.clientId))
      .innerJoin(projects, eq(projects.id, boqs.projectId))
      .where(eq(boqs.id, input.boqId))
      .limit(1),
  );
  if (!meta) return err('boq_not_found');

  const ar = input.locale.startsWith('ar');
  const pick = (a: string | null, e: string | null) =>
    (ar ? (a ?? e) : (e ?? a)) ?? '';

  const html = await buildBoqHtml(detail, {
    locale: input.locale,
    // The DELIVERED copy is always the client one. An internal costed copy is a
    // separate on-demand download, never the thing that reaches the portal.
    variant: 'client',
    orgName: pick(meta.orgAr, meta.orgEn),
    clientName: pick(meta.clientAr, meta.clientEn),
    projectName: pick(meta.projectAr, meta.projectEn),
    year: new Date(row.createdAt).getUTCFullYear(),
  });

  const pdf = await renderPdf(html);
  const name = `${formatBoqNumber(detail.number, new Date(row.createdAt).getUTCFullYear())}.pdf`;

  const stored = await storeGeneratedFile(ctx, 'engagement', pdf, {
    originalName: name,
    contentType: 'application/pdf',
    entityId: engagementId,
  });

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      // Re-check under the write lock: two clicks must not produce two artifacts.
      const [fresh] = await tx
        .select({ status: boqs.status })
        .from(boqs)
        .where(eq(boqs.id, input.boqId))
        .limit(1);
      if (!fresh) fail('boq_not_found');
      if (fresh.status !== 'draft') fail('boq_not_draft');

      await tx
        .update(boqs)
        .set({
          status: 'issued',
          issueDate: new Date().toISOString().slice(0, 10),
          engagementId,
        })
        .where(and(eq(boqs.id, input.boqId), eq(boqs.status, 'draft')));

      const [artifact] = await tx
        .insert(engagementArtifacts)
        .values({
          orgId: ctx.orgId,
          engagementId,
          kind: 'boq',
          fileId: stored.fileId,
          label: name,
          attestedBy: ctx.userId,
        })
        .returning({ id: engagementArtifacts.id });

      return artifact?.id;
    },
  );
}

/**
 * The project's one active engagement, or null when there is none — or more than
 * one, because guessing between two is worse than asking.
 */
async function soleActiveEngagement(
  ctx: OrgContext,
  projectId: string,
): Promise<string | null> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: designEngagements.id })
      .from(designEngagements)
      .where(
        and(
          eq(designEngagements.projectId, projectId),
          ne(designEngagements.state, 'abandoned'),
        ),
      )
      .limit(2),
  );
  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}
