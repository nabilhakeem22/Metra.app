'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EngagementArtifactKind } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ActionResult } from '@/lib/actions/result';
import { ArtifactPanel } from './engagement-artifact-panel';
import { PaymentPanel } from './engagement-payment-panel';
import { RomAckPanel } from './engagement-rom-ack-panel';
import { RomPanel } from './engagement-rom-panel';

type Panel = 'payment' | 'artifact' | 'rom' | 'romAck';

export interface ControlCapabilities {
  recordPayment: boolean;
  recordArtifact: boolean;
  setRom: boolean;
  recordRomAck: boolean;
}

export function EngagementControls({
  engagementId,
  capabilities,
  pending,
  runAction,
}: {
  engagementId: string;
  capabilities: ControlCapabilities;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements.controls');
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

  const anyCapability =
    capabilities.recordPayment ||
    capabilities.recordArtifact ||
    capabilities.setRom ||
    capabilities.recordRomAck;
  if (!anyCapability) return null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium">{t('title')}</p>
        <div className="flex flex-wrap gap-2">
          {capabilities.recordPayment && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel('payment')}>
              {t('recordPayment')}
            </Button>
          )}
          {capabilities.recordArtifact && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel('artifact')}>
              {t('recordArtifact')}
            </Button>
          )}
          {capabilities.setRom && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel('rom')}>
              {t('setRom')}
            </Button>
          )}
          {capabilities.recordRomAck && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel('romAck')}>
              {t('recordRomAck')}
            </Button>
          )}
        </div>

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
      </CardContent>
    </Card>
  );
}
