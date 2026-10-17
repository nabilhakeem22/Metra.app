// The check pipeline, pure: merge the producer files, apply the owner's
// mapping and corrections, run every validator, and build staged.json. The CLI
// does the file and database IO around it.
import { finding, isBlocking, sortFindings, type Finding } from '../findings';
import { mergeProducerFiles, type ProducerFile } from '../merge';
import { guardCorrections, guardMapping } from '../overrides';
import { buildStaged, type StagedBulletin, type StagedProvenance } from '../stage';
import { resolveRows, type CheckContext, type PublishedHistory } from './context';
import { checkCoverage } from './coverage';
import { checkIdentity } from './identity';
import { checkNewItems } from './novelty';
import { checkPageNotes } from './page-notes';
import { checkReadings } from './readings';
import { checkSeries } from './series';
import { checkSlots } from './slots';
import { checkVerbatim } from './verbatim';
import { checkYearly } from './yearly';

export interface CheckInput {
  period: string;
  producerFiles: ProducerFile[];
  /** Parsed mapping.json / corrections.json, or undefined when absent. */
  mapping: unknown;
  corrections: unknown;
  history: PublishedHistory;
  /** The validators that need the published history (B6, B7, B11, F2, F3); none offline. */
  historyValidators: Array<(context: CheckContext) => Finding[]>;
  flagPct: number;
  /** sha256 of the source files as found on disk, when the operator passed them. */
  sourceHashes: { pdf: string | null; md: string | null };
  /** The gate's git commit, recorded in staged.json. */
  gateCommit: string | null;
}

export interface CheckOutcome {
  findings: Finding[];
  context: CheckContext | null;
  staged: StagedBulletin;
}

const VALIDATORS = [checkSlots, checkIdentity, checkCoverage, checkReadings, checkVerbatim, checkPageNotes, checkYearly, checkSeries, checkNewItems];

function provenanceOf(input: CheckInput): StagedProvenance {
  return {
    historyChecked: input.historyValidators.length > 0,
    gateCommit: input.gateCommit,
    sourcesVerified: { pdf: input.sourceHashes.pdf !== null, md: input.sourceHashes.md !== null },
  };
}

function sourceFindings(input: CheckInput, context: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const { source, period } = context.file;
  if (period !== input.period) findings.push(finding('B0', `the file is for ${period}, not --period ${input.period}`));
  if (input.sourceHashes.pdf !== null && input.sourceHashes.pdf !== source.pdfSha256) {
    findings.push(finding('B0', `source.pdfSha256 does not match the PDF on disk (${input.sourceHashes.pdf})`));
  }
  if (input.sourceHashes.md !== null && input.sourceHashes.md !== source.mdSha256) {
    findings.push(finding('B0', `source.mdSha256 does not match the MD on disk (${input.sourceHashes.md})`));
  }
  return findings;
}

export function runCheck(input: CheckInput): CheckOutcome {
  const merged = mergeProducerFiles(input.producerFiles);
  const mapping = guardMapping(input.mapping ?? {});
  const corrections = guardCorrections(input.corrections ?? []);
  const early = [...merged.findings, ...mapping.findings, ...corrections.findings];
  if (merged.file === null || early.length > 0) {
    const findings = sortFindings(early);
    return { findings, context: null, staged: buildStaged(input.period, provenanceOf(input), null, findings) };
  }
  const resolved = resolveRows(merged.file, mapping.mapping, corrections.corrections);
  const context: CheckContext = {
    file: merged.file,
    bulletinMonth: Number(merged.file.period.slice(5)),
    rows: resolved.rows,
    discontinueKeys: resolved.discontinueKeys,
    skippedRows: resolved.skippedRows,
    corrections: corrections.corrections,
    history: input.history,
    flagPct: input.flagPct,
  };
  const findings = sortFindings([
    ...resolved.findings,
    ...sourceFindings(input, context),
    ...[...VALIDATORS, ...input.historyValidators].flatMap((validate) => validate(context)),
  ]);
  return { findings, context, staged: buildStaged(input.period, provenanceOf(input), context, findings) };
}

export function blockingOf(findings: Finding[]): Finding[] {
  return findings.filter(isBlocking);
}
