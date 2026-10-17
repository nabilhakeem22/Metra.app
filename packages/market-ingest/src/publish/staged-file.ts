// Reading staged.json for publish: the bytes must hash to the owner's approved
// value, and the file must carry no blocking finding. Nothing touches the
// database until both hold.
import { readFileSync } from 'node:fs';
import { FINDING_TITLES } from '../findings';
import { STAGED_FORMAT, type StagedBulletin } from '../stage';
import { sha256Hex } from '../staging';

export interface ApprovedStaged {
  staged: StagedBulletin;
  sha256: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function readApprovedStaged(path: string, period: string, approve: string): ApprovedStaged {
  if (!SHA256.test(approve)) throw new Error('--approve takes the 64-character extraction_sha256 that market:review printed');
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`no staged.json at ${path}; run market:check first`);
  }
  const sha256 = sha256Hex(bytes);
  if (sha256 !== approve) {
    throw new Error(`staged.json hashes to ${sha256}, not the approved ${approve}: it changed since it was reviewed; run market:review again and approve the hash it prints`);
  }
  const staged = JSON.parse(bytes.toString('utf8')) as StagedBulletin;
  if (staged.format !== STAGED_FORMAT || staged.period !== period) {
    throw new Error(`staged.json is not a ${STAGED_FORMAT} file for ${period}`);
  }
  if (staged.blocking.length > 0) {
    const lines = staged.blocking.map(
      (item) => `  ${item.code} ${FINDING_TITLES[item.code]} page ${item.page ?? '-'} ${item.rowId ?? ''} ${item.month ? `month ${item.month} ` : ''}${item.message}`,
    );
    throw new Error(`staged.json carries ${staged.blocking.length} blocking finding(s); nothing was written:\n${lines.join('\n')}`);
  }
  if (staged.readFrom === null || staged.source === null || staged.items.length === 0) {
    throw new Error('staged.json carries no items; nothing to publish');
  }
  return { staged, sha256 };
}
