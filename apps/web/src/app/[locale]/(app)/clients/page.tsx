import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { listClientsWithCounts } from '@/lib/clients/queries';
import { can } from '@/lib/permissions/can';
import { ClientsClient } from './clients-client';
import type { ClientRow } from './types';

export default async function ClientsPage() {
  const ctx = await requireOrg();
  // Read gate: the client role has no `clients` access -> 404.
  if (!can(ctx.role, 'clients', 'read')) notFound();

  const t = await getTranslations('clients');
  const rows = await listClientsWithCounts(ctx, {});
  const items: ClientRow[] = rows.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    city: c.city,
    country: c.country,
    address: c.address,
    taxRegistrationNumber: c.taxRegistrationNumber,
    notes: c.notes,
    active: c.active,
    type: c.type,
    projectCount: c.projectCount,
  }));
  const canManage = can(ctx.role, 'clients', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ClientsClient items={items} canManage={canManage} />
    </div>
  );
}
