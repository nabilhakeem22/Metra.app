'use client';

import { Banknote, FileUp, Ruler, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EngagementArtifactKind } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';
import { ArtifactPanel } from './engagement-artifact-panel';
import { PaymentPanel } from './engagement-payment-panel';
import { RomAckPanel } from './engagement-rom-ack-panel';
import { RomPanel } from './engagement-rom-panel';

type Panel = 'payment' | 'artifact' | 'rom' | 'romAck';

export interface ToolbarCapabilities {
  recordPayment: boolean;
  recordArtifact: boolean;
  setRom: boolean;
  recordRomAck: boolean;
}

// The cockpit TOOLBAR (refactor of the old data-entry controls) — capability-gated
// tiles for the supporting, non-lifecycle records. Each tile (icon + name +
// purpose) opens the SAME existing panel unchanged. "Record on client's behalf"
// (ROM acknowledgement) is rendered visually SUBORDINATE below a divider — it is a
// stand-in for a client action, not studio work. A tile the role lacks is hidden;
// the whole toolbar is hidden when the role has no capability. Logical CSS only.
export function EngagementToolbar({
  engagementId,
  capabilities,
  pending,
  runAction,
}: {
  engagementId: string;
  capabilities: ToolbarCapabilities;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements.controls');
  const tt = useTranslations('engagements.toolbar');
  const ta = useTranslations('engagements.artifactKind');
  const [panel, setPanel] = useState<Panel | null>(null);

  const [artKind, setArtKind] = useState<EngagementArtifactKind>('survey');
  const [artLabel, setArtLabel] = useState('');
  const [artHash, setArtHash] = useState('');
  const [romLow, setRomLow] = useState('');
  const [romHigh, setRomHigh] = useState('');
  const [ackNote, setAckNote] = useState('');

  function after(fn: () => Promise<ActionResult>) {
    runAction(async () => {
      const res = await fn();
      if (res.ok) setPanel(null);
      return res;
    });
  }

  const studioTiles = (
    [
      capabilities.recordPayment && {
        key: 'payment' as const,
        icon: Banknote,
        group: 'payment' as const,
      },
      capabilities.recordArtifact && {
        key: 'artifact' as const,
        icon: FileUp,
        group: 'deliverable' as const,
      },
      capabilities.setRom && {
        key: 'rom' as const,
        icon: Ruler,
        group: 'budget' as const,
      },
    ] as const
  ).filter(Boolean) as {
    key: Panel;
    icon: typeof Banknote;
    group: 'payment' | 'deliverable' | 'budget';
  }[];

  const anyCapability =
    capabilities.recordPayment ||
    capabilities.recordArtifact ||
    capabilities.setRom ||
    capabilities.recordRomAck;
  if (!anyCapability) return null;

  return (
    <section className="space-y-3 rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card p-4 text-[color:var(--text)] shadow-sm">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
        {t('title')}
      </p>

      {studioTiles.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {studioTiles.map((tile) => (
            <Tile
              key={tile.key}
              icon={tile.icon}
              name={tt(`${tile.group}.name`)}
              purpose={tt(`${tile.group}.purpose`)}
              active={panel === tile.key}
              onClick={() => setPanel((p) => (p === tile.key ? null : tile.key))}
            />
          ))}
        </div>
      )}

      {capabilities.recordRomAck && (
        <div className="border-t border-dashed border-[color:var(--rule)] pt-3">
          <Tile
            icon={UserCheck}
            name={tt('onBehalf.name')}
            purpose={tt('onBehalf.purpose')}
            subordinate
            active={panel === 'romAck'}
            onClick={() => setPanel((p) => (p === 'romAck' ? null : 'romAck'))}
          />
        </div>
      )}

      {panel === 'payment' && (
        <PaymentPanel
          engagementId={engagementId}
          pending={pending}
          runAction={runAction}
          onDone={() => setPanel(null)}
        />
      )}

      {panel === 'artifact' && (
        <ArtifactPanel
          t={t}
          ta={ta}
          pending={pending}
          engagementId={engagementId}
          artKind={artKind}
          setArtKind={setArtKind}
          artLabel={artLabel}
          setArtLabel={setArtLabel}
          artHash={artHash}
          setArtHash={setArtHash}
          after={after}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === 'rom' && (
        <RomPanel
          t={t}
          pending={pending}
          engagementId={engagementId}
          romLow={romLow}
          setRomLow={setRomLow}
          romHigh={romHigh}
          setRomHigh={setRomHigh}
          after={after}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === 'romAck' && (
        <RomAckPanel
          t={t}
          pending={pending}
          engagementId={engagementId}
          ackNote={ackNote}
          setAckNote={setAckNote}
          after={after}
          onCancel={() => setPanel(null)}
        />
      )}
    </section>
  );
}

function Tile({
  icon: Icon,
  name,
  purpose,
  active,
  subordinate = false,
  onClick,
}: {
  icon: typeof Banknote;
  name: string;
  purpose: string;
  active: boolean;
  subordinate?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2.5 rounded-[var(--r-item)] border p-3 text-start transition-colors ${
        active
          ? 'border-[color:var(--brand-tint-border)] bg-[color:var(--track)]'
          : 'border-[color:var(--rule)] hover:bg-[color:var(--track)]'
      } ${subordinate ? 'opacity-90' : ''}`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-icon)] ${
          subordinate
            ? 'bg-[color:var(--track)] text-[color:var(--text-muted)]'
            : 'bg-brand-tint text-brand-ink'
        }`}
        aria-hidden
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold leading-tight">{name}</span>
        <span className="mt-0.5 block text-[12px] text-[color:var(--text-muted)]">
          {purpose}
        </span>
      </span>
    </button>
  );
}
