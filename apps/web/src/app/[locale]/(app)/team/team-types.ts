// Shared view-model types for the team screen (server-safe: types only).
import type { MemberRole } from '@/lib/permissions/roles';

export interface Member {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  createdAt: string;
}

export interface Pending {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}
