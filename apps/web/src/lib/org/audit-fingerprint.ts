import 'server-only';
// The keyed fingerprint the masked audit tags each value with (Round C, C8 fix
// round F4, S2). HMAC-SHA256 under a key DERIVED from the Worker secret
// SHARE_LINK_SECRET with its own label, so it is a different key from the one
// that derives client links, and the database alone (or the audit log) cannot
// test a guessed account number against it. With no secret configured the
// audit keeps its masks without tags: nothing fails, the log just cannot tell
// two values apart (docs/DEPLOY.md, "SHARE_LINK_SECRET").
import { createHmac } from 'node:crypto';
import { runtimeSecret } from '@/lib/cf/secrets';
import type { Fingerprint } from './client-page-change';

/** Versioned, so the tags of a future scheme never collide with these. */
const FINGERPRINT_LABEL = 'metra.audit-fingerprint.v1';

/** The same floor the link derivation applies: shorter is a placeholder, not a key. */
const MIN_SECRET_LENGTH = 32;

/** Hex characters kept: enough that two values of one studio never share a tag by chance. */
const TAG_LENGTH = 8;

/** The fingerprint for this deployment, or undefined when no usable secret is set. */
export function auditFingerprint(): Fingerprint | undefined {
  const secret = runtimeSecret('SHARE_LINK_SECRET');
  if (!secret || secret.length < MIN_SECRET_LENGTH) return undefined;
  const key = createHmac('sha256', secret).update(FINGERPRINT_LABEL).digest();
  return (field, value) => createHmac('sha256', key).update(`${field}:${value}`).digest('hex').slice(0, TAG_LENGTH);
}
