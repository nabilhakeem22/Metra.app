// The client and project a new delivery is started on, read in the caller's
// transaction (RLS scopes both to the org). One that is gone, or belongs to
// another workspace, is refused under its own select.
import { clients, projects, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields } from '@/lib/actions/field-errors';
import type { ProjectNames } from './create-fields';

export async function requireChosenClient(tx: MetraDb, clientId: string): Promise<void> {
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) failFields({ clientId: { code: 'no_longer_exists' } });
}

/** The chosen project's names, which an untitled delivery takes. */
export async function requireChosenProject(tx: MetraDb, projectId: string): Promise<ProjectNames> {
  const [project] = await tx
    .select({ nameAr: projects.nameAr, nameEn: projects.nameEn })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) failFields({ projectId: { code: 'no_longer_exists' } });
  return project;
}
