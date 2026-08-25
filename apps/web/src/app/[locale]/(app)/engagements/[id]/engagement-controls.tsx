'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EngagementArtifactKind, PaymentEventKind } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import {
  recordArtifact,
  recordPayment,
  recordRomAcknowledgement,
  setEngagementRom,
} from '@/lib/engagements/actions';

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const PAYMENT_KINDS: PaymentEventKind[] = [
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
  'revision_co',
];
const ARTIFACT_KINDS: EngagementArtifactKind[] = [
  'survey',
  'autocad',
  'concept_option',
  'approved_render',
  'shop_drawing',
  'boq',
];

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

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
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="art-kind">{t('kind')}</Label>
                <select
                  id="art-kind"
                  className={selectClass}
                  value={artKind}
                  onChange={(e) => setArtKind(e.target.value as EngagementArtifactKind)}
                >
                  {ARTIFACT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ta(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="art-label">{t('label')}</Label>
                <Input id="art-label" value={artLabel} onChange={(e) => setArtLabel(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="art-hash">{t('contentHash')}</Label>
              <Input
                id="art-hash"
                dir="ltr"
                value={artHash}
                onChange={(e) => setArtHash(e.target.value)}
              />
            </div>
            <FormActions
              pending={pending}
              onCancel={() => setPanel(null)}
              onSave={() =>
                after(() =>
                  recordArtifact({
                    engagementId,
                    kind: artKind,
                    label: artLabel.trim() || null,
                    contentHash: artHash.trim() || null,
                  }),
                )
              }
              saveLabel={t('save')}
              cancelLabel={t('cancel')}
            />
          </div>
        )}

        {panel === 'rom' && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rom-low">{t('low')}</Label>
                <Input
                  id="rom-low"
                  dir="ltr"
                  inputMode="decimal"
                  value={romLow}
                  onChange={(e) => setRomLow(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rom-high">{t('high')}</Label>
                <Input
                  id="rom-high"
                  dir="ltr"
                  inputMode="decimal"
                  value={romHigh}
                  onChange={(e) => setRomHigh(e.target.value)}
                />
              </div>
            </div>
            <FormActions
              pending={pending}
              onCancel={() => setPanel(null)}
              onSave={() =>
                after(() =>
                  setEngagementRom({
                    engagementId,
                    romLow: romLow.trim(),
                    romHigh: romHigh.trim(),
                  }),
                )
              }
              saveLabel={t('save')}
              cancelLabel={t('cancel')}
            />
          </div>
        )}

        {panel === 'romAck' && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="ack-note">{t('note')}</Label>
              <Input id="ack-note" value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
            </div>
            <FormActions
              pending={pending}
              onCancel={() => setPanel(null)}
              onSave={() =>
                after(() =>
                  recordRomAcknowledgement({
                    engagementId,
                    note: ackNote.trim() || null,
                  }),
                )
              }
              saveLabel={t('save')}
              cancelLabel={t('cancel')}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Standalone "record a payment" panel. Owns its own kind/amount state and — one
 * per mount — an idempotency key: a fresh mount per panel-open means one key per
 * open, so a double-click within a single open records the payment exactly once
 * (the partial unique index dedups the retry). Closing + reopening the panel is a
 * new mount = a new key = a genuinely new payment.
 */
function PaymentPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const tk = useTranslations('engagements.paymentKind');
  const [payKind, setPayKind] = useState<PaymentEventKind>('deposit');
  const [payAmount, setPayAmount] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function save() {
    runAction(async () => {
      const res = await recordPayment({
        engagementId,
        kind: payKind,
        amount: payAmount.trim(),
        idempotencyKey,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pay-kind">{t('kind')}</Label>
          <select
            id="pay-kind"
            className={selectClass}
            value={payKind}
            onChange={(e) => setPayKind(e.target.value as PaymentEventKind)}
          >
            {PAYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-amount">{t('amount')}</Label>
          <Input
            id="pay-amount"
            dir="ltr"
            inputMode="decimal"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
          />
        </div>
      </div>
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}

function FormActions({
  pending,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {saveLabel}
      </Button>
    </div>
  );
}
